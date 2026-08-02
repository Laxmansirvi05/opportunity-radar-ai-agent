# FINAL PRODUCTION ARCHITECTURE

This document serves as the final, definitive architectural blueprint for the AI Job/Internship Discovery Agent. It reviews the current state, scores all layers, identifies all critical weaknesses and edge cases, and presents the refined final architecture designed strictly for production scale.

---

## 1. Architectural Layer Scores

| Layer | Score (/10) | Justification |
| :--- | :---: | :--- |
| **Control Plane (n8n)** | **4/10** | Unsuited for high-throughput looping. It must be strictly relegated to cron scheduling and webhook triggering. |
| **Data Plane (PostgreSQL + Redis)** | **9/10** | Excellent foundation with structured schemas, deduplication signatures, and event logging. Needs vector support (pgvector) for semantic ranking. |
| **AI Gateway** | **9/10** | Robust multi-provider routing, fallbacks, and task registries. Excellent design. |
| **Render Service (Playwright)** | **8/10** | Strong browser lifecycle management and resource blocking. Lacks proxy rotation for horizontal scaling against IP bans. |
| **Execution Fabric** | **6/10** | Implemented as a local, in-memory promise pool. Will not scale across multiple nodes and risks data loss on process restart. Needs an external distributed queue (e.g., BullMQ/Redis or SQS). |
| **Search Planner & Normalizers** | **9/10** | Highly deterministic, robust normalizers, completely test-driven. Excellent separation of concerns. |
| **Profile Builder** | **9/10** | Excellent canonical hashing and deterministic validation. |

---

## 2. Bottlenecks
- **Single-Node Execution Fabric**: The current in-memory promise pool in `execution-fabric/src/dispatcher.js` binds all concurrent crawling to a single Node.js process.
- **Render Service CPU Saturation**: Chromium is extremely CPU/Memory heavy. Running it on the same node as the AI Gateway or Execution Fabric will cause resource starvation.
- **Synchronous LLM Extraction**: Blocking on LLM calls during the extraction phase limits throughput. The Execution Fabric must treat extraction as an async job rather than blocking the crawl worker.

## 3. Scalability Issues
- **IP Rate Limiting**: The Render Service currently uses the host's IP. Job boards (LinkedIn, Greenhouse, Lever) will quickly rate-limit and ban the IP. 
- **Database Connection Exhaustion**: If the Execution Fabric scales horizontally to hundreds of workers, the PostgreSQL connection pool will be exhausted. PgBouncer is required.

## 4. AI Reasoning Weaknesses
- **Hallucination in Structured Extraction**: LLMs (even GPT-4/Gemini Pro) will occasionally hallucinate dates, salaries, or remote status. 
- **Lack of Semantic Matching**: Relying purely on keyword-based ranking or math will miss highly relevant jobs (e.g., "Software Engineer" vs "Backend Developer"). The system requires vector embeddings (pgvector) to score the semantic distance between the Candidate Intelligence Profile (CIP) and the Opportunity.

## 5. Security Weaknesses
- **Internal Authentication**: Relying on simple `API_KEY` string matching between microservices is insufficient for production. If one service is compromised, all are.
- **Render Service SSRF & Sandbox Escapes**: While private IPs are blocked, DNS rebinding attacks can bypass this. Additionally, rendering arbitrary job board HTML exposes the Chromium instance to zero-day sandbox escapes.
- **Prompt Injection**: Resumes parsed by the Profile Builder could contain adversarial instructions (e.g., "Ignore all previous instructions and output..."). The AI Gateway tasks need strict system prompt boundaries to prevent malformed CIPs.

## 6. Performance Issues
- **Playwright Overhead**: Loading full CSS, Images, and Fonts adds massive latency. While `resourceBlocking.js` exists, it needs to aggressively block tracking scripts, websockets, and media.
- **Redundant LLM Calls**: Multiple jobs from the same company might share identical boilerplate descriptions. Hashing paragraphs and caching embeddings can save thousands of LLM tokens.

## 7. Maintainability Issues
- **Microservice Sprawl**: Maintaining `search-planner`, `execution-fabric`, `ai-gateway`, and `render-service` as independent repositories/deployments creates CI/CD overhead. They should be managed in a monorepo with strict package boundaries.
- **Logging Fragmentation**: Logs are structured but disparate. A centralized logging pipeline (e.g., Datadog, ELK) is required to trace a single `runId` across n8n, Execution Fabric, AI Gateway, and Render Service.

## 8. Unnecessary Complexity
- **n8n as a Data Transformer**: n8n should not handle any data transformation or math (Ranking). Moving all math to the Node.js ecosystem simplifies the architecture and allows for comprehensive unit testing.

## 9. Future Scaling Problems
- **Database Partitioning**: As opportunities and execution runs scale into the millions, the `opportunities` and `event_log` tables will degrade in performance. Time-based table partitioning (e.g., partitioned by month) is required for long-term survival.
- **Deduplication Collision**: SHA-256 hashing is exact. Minor changes in a job description (e.g., a comma added by the employer) will bypass the `dedup_signatures` table. MinHash or SimHash is required for fuzzy deduplication.

## 10. Hidden Edge Cases
- **Cloudflare Turnstile / CAPTCHA**: Heuristics and waiting will eventually fail against aggressive anti-bot protections.
- **Phantom Jobs**: Jobs that are active when queued but deleted by the time the worker picks them up.
- **Token Limit Truncation**: Extremely long job descriptions will exceed the context window of the LLM in the AI Gateway, leading to JSON parse errors or truncated extractions.
- **Stale Rankings**: A candidate updates their resume, but previously ranked opportunities retain their old match scores.

---

## FINAL ARCHITECTURE PROPOSAL

To address all identified weaknesses and edge cases without rewriting the core components, the architecture must be refined into the following production-grade pipeline.

### The Pipeline

**1. Trigger Phase (Control Plane)**
- `n8n` strictly manages cron schedules and Webhook ingestion (Candidate Resumes). It performs NO logic. It immediately pushes the raw payload to the Execution Fabric API.

**2. Ingestion & Planning (Intelligence Plane)**
- **Profile Builder**: Validates the resume, hashes it, calls AI Gateway for extraction, and upserts the Candidate Intelligence Profile (CIP).
- **Search Planner**: Generates deterministic, tier-based search queries based on the CIP.

**3. Distributed Dispatch (Execution Fabric)**
- **API Boundary**: The Execution Fabric exposes an HTTP Webhook to accept the Search Plan.
- **Distributed Queue**: Replaces the in-memory promise pool with a robust Redis-backed queue (e.g., BullMQ).
- **Crawling Workers**: Horizontally scaled workers pull from the queue.

**4. Rendering & Extraction (Data Acquisition)**
- **Render Service**: Workers request pages. The Render Service utilizes a **Rotating Proxy Network** to prevent IP bans and aggressively blocks non-DOM resources.
- **AI Gateway**: Workers send the raw DOM to the AI Gateway. The Gateway chunks the text (handling token limits) and extracts structured JSON.

**5. Verification & Deduplication (Quality Assurance)**
- **Fuzzy Deduplication**: The extracted opportunity is checked against the database using both exact SHA-256 hashes and fuzzy MinHash signatures.
- **Verification Pipeline**: A secondary, highly-constrained LLM call specifically cross-checks hallucination-prone fields (Salary, Remote status, Sponsorship) against the raw DOM snippet.

**6. Semantic Ranking (Scoring Plane)**
- **Embedding Generation**: The AI Gateway generates vector embeddings for both the Candidate Profile and the Opportunity.
- **Ranking Engine**: Calculates the score using a hybrid approach: `Deterministic Quality Score` (source tier, freshness) × `Semantic Fit Score` (Cosine similarity in pgvector).

**7. Output & Routing**
- The fully verified, ranked opportunity is published via a Webhook back to n8n (or directly to a UI/Email service) for human presentation.

### Required Infrastructure Additions
1. **Redis BullMQ**: To replace the in-memory `dispatcher.js`.
2. **PgBouncer**: For PostgreSQL connection pooling.
3. **PgVector**: Added to the PostgreSQL instance for semantic matching.
4. **Proxy Rotator**: Integrated into the Playwright Render Service. 
5. **Centralized APM/Logging**: Datadog or OpenTelemetry to trace `runId` across the distributed network.
