# IMPLEMENTATION_PLAN.md
## Implementation Audit and Roadmap

## 1. Executive Summary
- **Overall repository health**: The current repository exhibits excellent foundational health. The existing microservices (`ai-gateway` and `render-service`) are robust, stateless, and handle failure gracefully.
- **Overall architecture compatibility**: The repository is fundamentally compatible with `FINAL_ARCHITECTURE.md`. The design philosophy of "Preserve -> Improve -> Extend" applies perfectly here. The current system provides a strong Platform Services layer, but lacks the Execution, Intelligence, and Data planes.
- **Estimated completion percentage**: ~35%. The hardest infrastructure problems (headless browsing, AI provider abstraction, schema validation) are solved. The remaining 65% involves building the reasoning layer and distributed execution plane.
- **Major strengths**: Stable `render-service` with Cloudflare bypass, reliable `ai-gateway` with provider fallbacks, and strict JSON schema validation.
- **Major risks**: The current `n8n` implementation conflates control and execution, creating a massive bottleneck. Uncontrolled LLM costs without a Domain Classifier and Deduplication pipeline.

---

## 2. Repository Audit

### AI Gateway
- **Current Status**: ✅ Complete
- **Purpose**: Abstracts LLM providers, enforces JSON schema validation, and handles retries.
- **Current implementation**: Express.js server routing requests to Gemini/OpenAI with fallback logic and task-specific endpoints.
- **Differences from FINAL_ARCHITECTURE.md**: Lacks model tiering (cheap models for classification) and structured-data bypass routing.
- **Recommendation**: KEEP. Extend to support a fast pre-classification endpoint.
- **Files involved**: `ai-gateway/src/gateway-service.js`, `ai-gateway/src/app.js`
- **Dependencies**: `@google/genai`, `openai`
- **Estimated work**: 1 day

### Playwright Render Service
- **Current Status**: ✅ Complete
- **Purpose**: Renders JS-heavy pages and bypasses anti-bot challenges.
- **Current implementation**: Express.js server managing a singleton Chromium browser with in-memory request queues.
- **Differences from FINAL_ARCHITECTURE.md**: None functionally. It perfectly satisfies the architecture's requirements for a rendering service.
- **Recommendation**: KEEP.
- **Files involved**: `render-service/src/browserManager.js`, `render-service/src/requestQueue.js`
- **Dependencies**: `playwright`, `playwright-extra`
- **Estimated work**: 0 days

### n8n Orchestrator
- **Current Status**: 🟡 Partial
- **Purpose**: Controls workflow triggers, execution, and data flow.
- **Current implementation**: Monolithic SQLite-backed orchestration handling fan-out, API calls, and ranking inside UI nodes.
- **Differences from FINAL_ARCHITECTURE.md**: Violates the separation of Control Plane and Execution Plane. It executes high-fan-out tasks sequentially or via memory-heavy batch nodes.
- **Recommendation**: MODIFY. Narrow scope to triggers, scheduling, and human-in-the-loop review.
- **Files involved**: `workflows.json`
- **Dependencies**: `n8n`
- **Estimated work**: 5 days

### Resume Parser
- **Current Status**: ✅ Complete
- **Purpose**: Extracts literal facts from resumes.
- **Current implementation**: Uses Ollama/AI Gateway to extract text into a Candidate schema.
- **Differences from FINAL_ARCHITECTURE.md**: Currently attempts to infer keywords. Needs to be restricted to literal extraction only.
- **Recommendation**: MODIFY. Remove inference prompts.
- **Files involved**: `workflows.json` (Resume parsing node)
- **Dependencies**: AI Gateway
- **Estimated work**: 1 day

### Ranking Engine
- **Current Status**: 🟡 Partial
- **Purpose**: Scores opportunities.
- **Current implementation**: Pure JavaScript math calculating a single Quality score based on missing fields.
- **Differences from FINAL_ARCHITECTURE.md**: Does not factor in Candidate Fit. It scores opportunities in a vacuum.
- **Recommendation**: EXTEND. Split into Quality Score and Fit Score.
- **Files involved**: `workflows.json` (Code nodes)
- **Dependencies**: None currently
- **Estimated work**: 3 days

---

## 3. Component Mapping

| Final Architecture Component | Existing Component | Status | Action | Engineering Justification |
|---|---|---|---|---|
| Control Plane (n8n) | n8n | Partial | MODIFY | Keep for scheduling and alerting. Remove execution loop. |
| Execution Plane (Queue/Worker) | None | Missing | BUILD NEW | High-fan-out crawling must scale horizontally outside n8n. |
| Intelligence Plane (Profile Builder) | None | Missing | BUILD NEW | Needed to decouple resume parsing from semantic reasoning. |
| Search Query Planner | n8n (Static logic) | Partial | BUILD NEW | Needs to be tiered and profile-driven, not a static string. |
| Domain Classifier | None | Missing | BUILD NEW | Crucial for saving costs by bypassing Playwright for static domains. |
| Internet Discovery Engine | Tavily Search node | Partial | MODIFY | Drive via the new Search Query Planner instead of raw keywords. |
| Deduplication (Hash + Semantic) | None | Missing | BUILD NEW | Required to prevent processing identical or aggregated jobs. |
| Hallucination Cross-Check | None | Missing | BUILD NEW | Critical for trust; extracted fields must trace to source HTML. |
| Fraud & Scam Detection | None | Missing | BUILD NEW | Required to protect candidates from predatory postings. |
| Ranking Engine (Quality x Fit) | n8n Code Node | Partial | EXTEND | Math exists, but needs semantic fit integration via embeddings. |
| Geographic Quota Selection | None | Missing | BUILD NEW | Must be applied post-ranking to ensure diverse presentation. |
| Explainability Engine | None | Missing | BUILD NEW | Users need to know *why* a job matched their profile. |
| Platform Services (AI Gateway) | ai-gateway | Complete | KEEP | Robust and perfectly matches the architecture. |
| Platform Services (Render) | render-service | Complete | KEEP | Handles Cloudflare and JS rendering efficiently. |

---

## 4. Gap Analysis

**Critical Gaps**
- **Execution Plane (Queue/Worker Pool)**: Currently missing. Consequence: n8n will buckle under memory pressure during high-fan-out crawling.
- **Candidate Intelligence Profile Builder**: Currently missing. Consequence: The system cannot perform true semantic matching or career trajectory inference.
- **Semantic Matching Engine & Vector Store**: Currently missing. Consequence: Ranking is purely based on posting quality, not candidate fit.

**High Gaps**
- **Deduplication Caches (Hash & Semantic)**: Currently missing. Consequence: Massive wasted LLM spend on identical and reposted jobs.
- **Domain Classifier**: Currently missing. Consequence: Wasted compute rendering static pages in Playwright.
- **Search Query Planner**: Currently missing. Consequence: Search is limited to generic keywords, missing adjacent roles.

**Medium Gaps**
- **Structured-Data-First Extraction**: Currently missing. Consequence: Wasted LLM tokens parsing pages that already expose JSON-LD/ATS APIs.
- **Fraud/Scam Detection**: Currently missing. Consequence: Risk of presenting predatory opportunities.
- **Explainability Engine**: Currently missing. Consequence: Lower user trust due to opaque ranking.

**Low Gaps**
- **Geographic Quota Selection**: Currently missing. Consequence: Results may cluster heavily in one location.
- **Recurring Re-validation Job**: Currently missing. Consequence: Stale postings persist over time.

---

## 5. Dependency Graph

- **Data Plane (Vector DB, Relational DB, Object Store)** MUST exist first.
- **Execution Plane** depends on the Data Plane.
- **Candidate Intelligence Profile Builder** depends on the Data Plane (for embeddings).
- **Search Query Planner** depends on the Candidate Intelligence Profile.
- **Domain Classifier** depends on the Execution Plane (cache).
- **Semantic Matching Engine** depends on both the Candidate Profile and Opportunity embeddings.
- **Ranking Engine** depends on the Semantic Matching Engine.
- **n8n Refactoring** is blocked until the Execution Plane is fully operational.

---

## 6. Implementation Roadmap

### Phase 1: Data & Execution Foundation
- **Objective**: Stand up the databases and horizontal worker queues.
- **Components**: Vector Store, Relational DB, Redis/Queue, Execution Workers.
- **Dependencies**: None.
- **Acceptance Criteria**: Workers can process a dummy queue item and write to the DB.
- **Estimated complexity**: High
- **Expected outcome**: System can scale out high-fan-out tasks outside of n8n.

### Phase 2: Intelligence Core
- **Objective**: Build the candidate reasoning layer.
- **Components**: Candidate Intelligence Profile Builder, Search Query Planner.
- **Dependencies**: Phase 1 (Vector Store).
- **Acceptance Criteria**: Uploading a resume generates a versioned JSON profile and tiered search plan.
- **Estimated complexity**: High
- **Expected outcome**: System understands candidate trajectory and plans diverse searches.

### Phase 3: Discovery & Extraction Enrichment
- **Objective**: Implement cost-saving pipelines.
- **Components**: Domain Classifier, Content-Hash Dedup, Structured-Data Extraction.
- **Dependencies**: Phase 1 (Queue).
- **Acceptance Criteria**: Static ATS pages are extracted without LLM calls or Playwright.
- **Estimated complexity**: Medium
- **Expected outcome**: Drastic reduction in LLM and compute costs per job processed.

### Phase 4: Reasoning & Safety
- **Objective**: Implement scoring, dedup, and safety checks.
- **Components**: Semantic Dedup, Hallucination Check, Fraud/Scam Detection, Ranking Engine, Explainability.
- **Dependencies**: Phase 2 (Profile Builder).
- **Acceptance Criteria**: Extracted jobs are ranked by Fit x Quality with full explanations.
- **Estimated complexity**: High
- **Expected outcome**: High-trust, highly relevant opportunity feeds ready for publication.

### Phase 5: Control Plane Migration
- **Objective**: Re-wire n8n to act purely as a control plane orchestrator.
- **Components**: n8n workflows.
- **Dependencies**: Phases 1-4.
- **Acceptance Criteria**: n8n only handles triggers and human-review queues, delegating all search to the Execution Plane.
- **Estimated complexity**: Low
- **Expected outcome**: Architecture fully aligns with FINAL_ARCHITECTURE.md.

---

## 7. Existing Code Reuse

- **AI Gateway (`ai-gateway/src/*`)**: Retain entirely. The abstraction over Gemini/OpenAI and schema validation is production-grade. Needs minor routing additions.
- **Playwright Render Service (`render-service/src/*`)**: Retain entirely. The context pooling and anti-bot handling are perfectly aligned with the architecture.
- **n8n Resume Extraction Prompt**: Retain the literal extraction portions.

*Never recommend rewriting stable production-quality code.* The platform services are stable and will act as the bulletproof foundation for the new Execution Plane workers.

---

## 8. n8n Review

**Current**: Monolithic orchestrator handling cron triggers, iterating through arrays of jobs, calling the Render Service, calling the AI Gateway, and computing ranking math.
**Final Architecture**: Control Plane only.

- **What stays**: Resume Upload Webhooks, Nightly Cron Triggers, Human Review Queue routing, Alerting.
- **What changes**: The entire discovery loop is removed from n8n.
- **Which nodes move**: The `Split in Batches`, `Render Service HTTP Request`, `AI Gateway HTTP Request`, and `Parse + Rank` nodes move into Node.js worker code in the Execution Plane.
- **Which nodes are added**: `Enqueue to Execution Plane` node, `Wait for Completion` webhook node.
- **Which nodes should be removed**: All data-processing and looping nodes.

---

## 9. AI Gateway Review
- **Existing vs Architecture**: Highly compatible.
- **Missing capabilities**: Model tiering (e.g., using Gemini Flash for classification and Gemini Pro for extraction), structured-data bypassing.
- **Unnecessary capabilities**: None.
- **Required improvements**: Expose lightweight classification endpoints to support the Domain Classifier and pre-extraction routing.

---

## 10. Playwright Review
- **Current implementation**: Excellent. Manages a singleton browser with in-memory request queuing and Cloudflare evasion.
- **Compatibility**: 100% compatible.
- **Scaling readiness**: Ready for vertical scaling. To scale horizontally, simply run multiple instances behind a load balancer; the architecture treats it as a stateless service.
- **Changes required**: None to the service itself. Upstream routing must implement the Domain Classifier to avoid calling it unnecessarily.

---

## 11. Candidate Intelligence Profile
- **Status**: Missing.
- **Implementation Tasks**:
  1. Define JSON schema for the Profile (canonical skills, inferred direction, career stage).
  2. Implement an LLM chain that takes the literal parsed resume and infers adjacent roles and career trajectory based on a role taxonomy.
  3. Implement embedding generation for the profile.
  4. Store the output in a Vector DB.

---

## 12. Search Planner
- **Status**: Missing (currently hardcoded keywords in n8n).
- **Implementation Tasks**:
  1. Create a service that consumes the Candidate Intelligence Profile.
  2. Generate Tier 1 (core skills), Tier 2 (adjacent roles), Tier 3 (ATS direct queries), and Tier 4 (Geo target) query sets.
  3. Feed these tiered plans into the Execution Plane for Internet Discovery.

---

## 13. Ranking Engine
- **Current ranking**: Quality Score only (deterministic math based on missing fields).
- **Comparison against Final**: Lacks Semantic Candidate Fit and Explainability.
- **Required work**:
  1. Keep existing quality math (Source Tier, Completeness, Recency).
  2. Implement semantic scoring using cosine similarity between Candidate Profile Embedding and Opportunity Embedding (Fit Score).
  3. Implement hard-filter zeroing (e.g., location mismatch = 0 fit regardless of semantic score).
  4. Multiply Quality * Fit.

---

## 14. Database Review
- **Current**: n8n SQLite.
- **Compatibility**: 0% compatible with Final Architecture requirements.
- **Required Work**:
  - **Relational Store**: Define schemas for Opportunities, Candidates, and Review Queues.
  - **Vector Store**: Provision a vector database (e.g., Pinecone, Milvus, pgvector) for profile and opportunity embeddings.
  - **Object Store**: Setup storage for raw HTML snapshots and resumes.
  - **Caches**: Provision Redis for Domain Classifier and Content-Hash states.
  - **Event Storage**: Define an append-only event log for Opportunity Radar ingestion.

---

## 15. Risks
- **Technical risks**: Shifting from n8n orchestration to a distributed queue introduces distributed tracing, retry, and idempotency challenges.
- **Performance risks**: Latency compounding in the sequential post-extraction gates (Dedup -> Fraud -> Scam -> Rank). Must be executed as a DAG, not a blocking chain.
- **Scaling risks**: The content-hash deduplication cache growing infinitely. Requires a rolling TTL strategy for maintenance.
- **Cost risks**: Storing dense embeddings for every opportunity on the internet in a Vector DB.
- **Migration risks**: n8n state is currently locked in SQLite; no historical data migration is required, but a clean cutover is necessary.

---

## 16. Recommended Build Order
1. **Data Plane (DBs, Caches, Vectors)**: Everything downstream depends on persistent state and strict schemas.
2. **Execution Plane (Queue & Workers)**: We cannot move processing out of n8n until the worker infrastructure exists.
3. **Intelligence Plane (Profile & Planner)**: Search execution requires a tiered Search Plan and Candidate Profile to operate correctly.
4. **Pipeline Enrichments (Dedup, Classify, Safety)**: Can be built iteratively inside the worker loop to progressively lower LLM costs and increase safety.
5. **n8n Refactor**: Move the workflow over only when the underlying machinery is tested, proven, and ready.

---

## 17. Final Verdict
- **The current repository is**: **Requires Major Work**
- **Estimated completion percentage**: 35%
- **Estimated engineering effort remaining**: The underlying foundation (AI Gateway, Playwright Render Service, JSON Schema Validation, Retry logic) is completely solid and preserves months of engineering effort. Building the Data Plane, Execution Plane, and Intelligence Plane will require significant, but highly structured, engineering effort.
