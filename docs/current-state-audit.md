# Current State Audit

## Executive Summary
The repository represents a functional but unhardened baseline of the Opportunity Radar pipeline, implemented via an n8n workflow (`workflows.json`) orchestrated by a Node.js API (`job-server`) running as an ephemeral CLI command. The core structure—document extraction, LLM structuring, multi-source search planning, HTML fetching (with Playwright fallback for JS sites), and matching—is present and can run end-to-end using captured responses in `STUB_PIPELINE` mode. However, the system lacks robust foundational capabilities (Postgres tables for canonical opportunities/profiles are missing), deduplication relies heavily on basic checks without embeddings, and discovery depends directly on paid APIs like Tavily. The most important immediate next action is to establish the persistent Postgres Data Foundation (Phase 1) so downstream phases have a stable canonical store to operate against.

## Corrected Pipeline Map
| # | Node (as labeled) | Exact Type | Parameters / Notes |
|---|---|---|---|
| 1 | When clicking 'Execute workflow' | `n8n-nodes-base.manualTrigger` | Manual dev trigger |
| 2 | Read/Write Files from Disk | `n8n-nodes-base.readWriteFile` | `fileSelector`: `={{ $env.RESUME_INPUT_PATH }}` |
| 3 | Extract from File | `n8n-nodes-base.extractFromFile` | `operation`: `pdf` |
| 4 | Message a model | `n8n-nodes-base.httpRequest` | POST `http://localhost:4000/api/ai/chat` (ai-gateway) |
| 5 | Code in JavaScript | `n8n-nodes-base.code` | Parses LLM candidate JSON output |
| 6 | Build Multi-Source Search Plan | `n8n-nodes-base.code` | Interacts with `http://localhost:4200/search-plan/preview` |
| 7 | HTTP Request | `n8n-nodes-base.httpRequest` | POST `https://api.tavily.com/search` (Tavily search) |
| 8 | Normalize + Classify Discovery Results | `n8n-nodes-base.code` | Normalizes hits |
| 9 | Discovery Quality Gate + Dedup | `n8n-nodes-base.code` | Dedup step |
| 10 | Loop Over Items | `n8n-nodes-base.splitInBatches` | Loops with `batchSize`: 1 |
| 11 | If | `n8n-nodes-base.if` | Branches fetching strategies (HTTP vs Playwright) |
| 12 | HTTP Request1 | `n8n-nodes-base.httpRequest` | Fetches `={{$json.url}}` |
| 13 | playwright | `n8n-nodes-base.httpRequest` | POST `http://127.0.0.1:3100/fetch` (render-service) |
| 14 | Clean HTML | `n8n-nodes-base.code` | Cleans fetched HTML |
| 15 | Extract Main Content. | `n8n-nodes-base.code` | Extracts readable text |
| 16 | guard node | `n8n-nodes-base.code` | Checks empty content |
| 17 | If1 | `n8n-nodes-base.if` | Decides if extraction is needed |
| 18 | HTTP Request2 | `n8n-nodes-base.httpRequest` | POST `http://127.0.0.1:4000/api/ai/chat` for structure |
| 19 | JSON Parse | `n8n-nodes-base.code` | Parses extraction result |
| 20 | Standardize Opportunity | `n8n-nodes-base.code` | Schema alignment |
| 21 | Resume Match Engine | `n8n-nodes-base.code` | Basic matching mechanism |
| 22 | Parse + Rank Opportunities | `n8n-nodes-base.code` | Ranking step |
| 23 | Finalize Results | `n8n-nodes-base.code` | Aggregation |
| 24 | Geographic Allocator | `n8n-nodes-base.code` | Enforces location distribution |
| 25 | Build Response | `n8n-nodes-base.code` | Prepares final payload |

## Architecture Decision (Part A.4)
**Decision:** Option B (n8n as a prototyping surface and ephemeral runtime, not a standalone web service).

**Evidence:** The codebase explicitly implements this pattern in `job-server/src/pipeline-runner.js`. The function `createCliRunner()` orchestrates execution by spawning a detached child process (`npx n8n execute --id 3bwLRC7IC0yDFog7`), streaming stdout, and extracting the final JSON response payload (`extractResponse`). Furthermore, `n8n` is not deployed as a persistent service inside `docker-compose.yml`.

## Phase-by-Phase Status
| Phase | Status | % Complete (rough) | Key Gap |
|---|---|---|---|
| 1. Data Foundation | Not Started | 10% | Missing `opportunities` and `resumes` schemas. |
| 2. Resume Understanding | Partially Done | 60% | Needs migration to Ollama; logic currently tied to ai-gateway. |
| 3. Free-First Search Provider | Not Started | 10% | Hardcoded Tavily usage in workflows.json. |
| 4. Discovery Execution & Content Extraction | Partially Done | 50% | Needs `@mozilla/readability`, rate limiting, and `browser-use`. |
| 5. Canonical Link Resolver | Not Started | 0% | No logic exists for canonical application link resolution. |
| 6. Duplicate Detection Upgrade | Not Started | 10% | Relying on basic deduplication; missing fuzzy/embedding matches. |
| 7. Trust & Fraud Screening Gate | Not Started | 0% | No trust screening heuristics or rules implemented. |
| 8. Freshness & Recency Verification | Not Started | 0% | Missing periodic job staleness checks. |
| 9. Geographic & Eligibility Rules | Partially Done | 70% | A `Geographic Allocator` node handles parts of this. |
| 10. Resume-Opportunity Matching | Partially Done | 50% | `Resume Match Engine` node exists but relies on simple rules. |
| 11. Ranking Engine | Partially Done | 60% | `Parse + Rank Opportunities` handles initial ranking. |
| 12. Adaptive Result Assembly | Partially Done | 70% | Handled via `Finalize Results` and `Build Response`. |
| 13. Safety & Privacy | Not Started | 0% | No explicit PII stripping logic beyond basic file deletion. |
| 14. Evaluation Harness | Partially Done | 50% | Exists via `fixtures/` and testing scripts in `tools/`. |
| 15. Production Hardening | Not Started | 0% | Needs full transition from local stubs to secure endpoints. |

## Detailed Findings Per Phase

### Phase 1 (Data Foundation)
- **Status:** Not Started.
- **Evidence:** `job-server/src/job-repository.js` creates a `pipeline_jobs` table, but `opportunities` and `resumes` do not exist.
- **Already Satisfied:** Postgres is configured with pgvector in `docker-compose.yml`.
- **Genuinely Missing:** Migration scripts, actual schemas for canonical entities, and `node-pg-migrate` integration.
- **Other Findings:** `job-server` is well abstracted, making it trivial to inject the new tables.

### Phase 2 (Resume Understanding Upgrade)
- **Status:** Partially Done.
- **Evidence:** `workflows.json` contains the prompt in "Message a model" (Node 4).
- **Already Satisfied:** Structured profiling logic exists and outputs JSON.
- **Genuinely Missing:** Swapping to Ollama (currently ai-gateway uses paid APIs in `.env.example`), eligibility tier derivation.

### Phase 3 (Free-First Search Provider Layer)
- **Status:** Not Started.
- **Evidence:** `workflows.json` (Node 7) directly calls `https://api.tavily.com/search`.
- **Already Satisfied:** Query generation works in "Build Multi-Source Search Plan".
- **Genuinely Missing:** SearxNG, JobSpy integrations, and a provider abstraction layer.

### Phase 4 (Discovery Execution & Content Extraction Hardening)
- **Status:** Partially Done.
- **Evidence:** HTTP vs Playwright branching exists (Nodes 11-17).
- **Already Satisfied:** Fallback to headless Playwright (`render-service`).
- **Genuinely Missing:** `@mozilla/readability`, `robots-parser`, rate limiting, and `browser-use`.

### Phase 5 (Canonical Link Resolver)
- **Status:** Not Started.
- **Evidence:** No node handles resolving canonical ATS links directly.
- **Genuinely Missing:** `org_registry` caching, domain resolution, redirect chain handling.

### Phase 6 (Duplicate Detection Upgrade)
- **Status:** Not Started.
- **Evidence:** Existing "Discovery Quality Gate + Dedup" node handles basic dedup.
- **Genuinely Missing:** Fuzzy matching, semantic matching using `pgvector` distance.

### Phase 7 (Trust & Fraud Screening Gate)
- **Status:** Not Started.
- **Evidence:** Missing explicit node in `workflows.json`.
- **Genuinely Missing:** Three-way trust classification, suspicious keyword heuristic configs.

### Phase 8 (Freshness & Recency Verification)
- **Status:** Not Started.
- **Evidence:** `worker.js` sweeps stuck pipelines, but no logic sweeps old job records.
- **Genuinely Missing:** `last_verified_at` tracking and HEAD-request periodic checks.

### Phase 9 (Geographic & Eligibility Rules)
- **Status:** Partially Done.
- **Evidence:** `Geographic Allocator` (Node 24).
- **Genuinely Missing:** Stricter enforcement rules linked to the database schema.

### Phase 10 (Resume-Opportunity Matching)
- **Status:** Partially Done.
- **Evidence:** `Resume Match Engine` (Node 21).
- **Genuinely Missing:** Utilizing vector embeddings from Phase 1.

### Phase 11 (Ranking Engine)
- **Status:** Partially Done.
- **Evidence:** `Parse + Rank Opportunities` (Node 22).
- **Genuinely Missing:** Integration with the deduplicated and fraud-checked opportunity rows.

### Phase 12 (Adaptive Result Assembly)
- **Status:** Partially Done.
- **Evidence:** Handled by `Finalize Results` and `Build Response`.
- **Genuinely Missing:** Tie-ins to the new database models.

### Phase 13 (Safety & Privacy)
- **Status:** Not Started.
- **Evidence:** Resumes are deleted post-processing in `worker.js`, but no PII stripping on LLM outputs is enforced.
- **Genuinely Missing:** Prompt/schema updates for anonymization.

### Phase 14 (Evaluation Harness)
- **Status:** Partially Done.
- **Evidence:** `fixtures/` and `tools/verify-*.js` scripts already support baseline checks.
- **Genuinely Missing:** Formal automated CI/CD checks covering the new database workflow.

### Phase 15 (Production Hardening)
- **Status:** Not Started.
- **Evidence:** `.env.example` configurations exist, but the system expects to run locally.

## Data Layer Findings
- **Current Schema:** Only `pipeline_jobs` exists (managed by `job-repository.js`).
- **Missing Tables:** `opportunities`, `opportunity_sources`, `resumes`, `match_results`, `run_logs` are all absent.
- **pgvector:** Enabled successfully in `docker-compose.yml` (`pgvector/pgvector:pg16`).
- **Migrations:** No active migrations folder for business logic exists, though `data/package.json` suggests there will be scripts added.

## Tooling Inventory
| Tool | Status | Notes |
|---|---|---|
| SearxNG | Not present | Missing from `docker-compose.yml`. |
| Ollama | Not present | AI Gateway relies on `.env.example` configurations for paid providers. |
| pgvector | Present | Defined in `docker-compose.yml`. |
| JobSpy | Not present | - |
| Resume-Matcher | Not present | - |
| browser-use | Not present | - |
| TinyFish | Not present | - |
| @mozilla/readability| Not present | Missing from `package.json`. |
| robots-parser | Not present | Missing from `package.json`. |
| bottleneck | Not present | Missing from `package.json`. |
| fast-fuzzy | Not present | Missing from `package.json`. |
| node-pg-migrate | Not present | Missing from root and data dependencies. |

## Risks & Blockers
1. **n8n CLI Dependency:** `pipeline-runner.js` calls `npx n8n execute`, which implicitly expects n8n to be available. However, `package.json` in the root lacks an n8n dependency, which might cause global cache retrieval delays on a fresh machine.
2. **Hardcoded API Integrations:** `workflows.json` explicitly calls `https://api.tavily.com/search`, locking development into paid APIs immediately unless mocked.
3. **Missing Local LLM (Ollama):** Without Ollama running locally, testing the pipeline locally (outside `STUB_PIPELINE`) requires paid API keys (OpenAI, Gemini, etc.), violating the free-first rule.

## Recommended Immediate Next Action
Create the `opportunities`, `opportunity_sources`, and `resumes` PostgreSQL schemas and migrations using `node-pg-migrate` inside the `data` package (Phase 1) to establish the persistent data layer.
