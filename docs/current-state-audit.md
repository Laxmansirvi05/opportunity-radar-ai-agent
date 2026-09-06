# Current State Audit

## Executive Summary
The repository contains a substantial foundational layer, primarily around the `job-server` (job queue, worker) and a Postgres data layer equipped with `pgvector` and multiple schemas (`opportunities`, `candidates`, `search_plans`, etc.). The core pipeline execution still relies entirely on `n8n` as the runtime via a CLI spawned process (`npx n8n execute`), which introduces fragility. Most of the advanced product features (Phase 3-8) such as free-first search providers, canonical link resolution, and robust scraping libraries are genuinely missing and not present in the current codebase or tooling. The single most important next action is to resolve the structural flaw in the n8n pipeline loop (Node 7 splitting batches incorrectly) or to commit to extracting the pipeline logic into `execution-fabric` as pure Node.js code, moving away from n8n as a hard production runtime dependency.

## Corrected Pipeline Map
| # | Node (as labeled) | Likely function | Confirm via |
|---|---|---|---|
| 1 | When clicking ‘Execute workflow’ | n8n-nodes-base.manualTrigger | workflows.json |
| 2 | Read/Write Files from Disk | Loads resume from `$env.RESUME_INPUT_PATH` | workflows.json |
| 3 | Extract from File | Extracts raw text from PDF resume | workflows.json |
| 4 | Message a model | LLM call -> `http://localhost:4000/api/ai/chat` | workflows.json |
| 5 | Code in JavaScript | Cleans up and validates LLM JSON output | workflows.json |
| 6 | HTTP Request | Direct search call to `https://api.tavily.com/search` | workflows.json |
| 7 | Loop Over Items | Iterates per discovered listing (SplitInBatches) | workflows.json |
| 8 | Parse + Rank Opportunities | Per-item scoring (JS node) | workflows.json |
| 9 | Build Multi-Source Search Plan | Generates search queries via code | workflows.json |
| 10 | Normalize + Classify Discovery Results | Normalizes raw search hits | workflows.json |
| 11 | Discovery Quality Gate + Dedup | First-pass filter/dedup on search hits | workflows.json |
| 12 | HTTP Request1 | Fetch listing URL directly (`{{$json.url}}`) | workflows.json |
| 13 | Clean HTML | Strips markup noise using custom code | workflows.json |
| 14 | Extract Main Content. | Extracts readable text via custom code | workflows.json |
| 15 | JSON Parse | Parses structured output | workflows.json |
| 16 | Standardize Opportunity | Normalize into canonical schema | workflows.json |
| 17 | Resume Match Engine | Match score/explanation vs. resume | workflows.json |
| 18 | Finalize Results | Aggregate processed items | workflows.json |
| 19 | If | Branches on Playwright need | workflows.json |
| 20 | playwright | Headless-browser scrape (`http://127.0.0.1:3100/fetch`) | workflows.json |
| 21 | HTTP Request2 | LLM call for field extraction (`:4000/api/ai/chat`) | workflows.json |
| 22 | guard node | Validation/safety guard | workflows.json |
| 23 | If1 | Branches - conditional logic | workflows.json |
| 24 | Geographic Allocator | Applies geographic distribution rules | workflows.json |
| 25 | Build Response | Formats final output | workflows.json |

## Architecture Decision (Part A.4)
**Actual state:** n8n is currently the production runtime. 
**Evidence:** In `job-server/src/pipeline-runner.js`, the `createCliRunner` explicitly uses `spawn('npx', ['--yes', 'n8n', 'execute', '--id', WORKFLOW_ID], ...)` to run the pipeline for every job. While it is executed via CLI, it relies entirely on the n8n engine and workflow logic. To adopt Option B (n8n as a prototyping surface only), the logic inside these nodes must be ported into real Node modules within `execution-fabric/`, eliminating the `spawn('npx', ['n8n'...])` path.

## Phase-by-Phase Status
| Phase | Status | % Complete (rough) | Key Gap |
|---|---|---|---|
| 1. Data Foundation | Partially Done | 80% | Custom migration (`migrate.js`) instead of `node-pg-migrate`; schema differs slightly. |
| 2. Resume Understanding | Partially Done | 50% | Prompt and extraction exist, but relies on standard gateway rather than explicit Ollama setup. |
| 3. Free-First Search Provider | Not Started | 0% | Hardcoded Tavily HTTP Request; no JobSpy, SearxNG, or TinyFish integration. |
| 4. Discovery Execution | Partially Done | 20% | Fetch/Playwright exists, but relies on custom regex/JS instead of standard readability libs. |
| 5. Canonical Link Resolver | Not Started | 0% | No logic explicitly resolves or searches for canonical direct links. |
| 6. Duplicate Detection | Partially Done | 30% | DB has `content_hash` for exact dedup, but no fuzzy/semantic dedup implemented. |
| 7. Trust & Fraud Screening | Partially Done | 40% | DB supports `fraud_flagged`/`scam_flagged`, but heuristics are missing in pipeline. |
| 8. Freshness & Recency | Partially Done | 30% | DB tracks `last_verified_at`, but `job-server` worker does not re-verify URLs. |
| 9. Geographic Rules | Partially Done | 80% | Pipeline has a `Geographic Allocator` node. |
| 10. Resume-Opportunity Matching | Partially Done | 70% | Pipeline has a `Resume Match Engine` node. |
| 11. Ranking Engine | Partially Done | 70% | Pipeline has a `Parse + Rank Opportunities` node. |
| 12. Adaptive Result Assembly | Partially Done | 70% | Pipeline has `Finalize Results` and `Build Response` nodes. |
| 13. Safety & Privacy | Partially Done | 70% | PII (resume uploads) are actively swept and deleted by `worker.js`. |
| 14. Evaluation Harness | Done | 100% | `fixtures/` contains evaluation scripts (e.g. `verify-task*.js`) and test resumes. |
| 15. Production Hardening | Not Started | 10% | Some rate limiting in `job-server`, but external dependencies are unhardened. |

## Detailed Findings Per Phase

### Phase 1: Data Foundation
- **Status:** Partially Done (80%).
- **Evidence:** `job-server/src/job-repository.js`, `data/migrations/*.sql`.
- **Already satisfies:** `pgvector` is enabled. Postgres is set up. Tables like `opportunities`, `candidates`, `ranking_results`, and `pipeline_jobs` exist. 
- **Missing:** The draft schema proposed in the plan differs slightly from what's implemented (e.g. `content_hash` instead of `dedup_hash`). `node-pg-migrate` is not used; instead, custom `migrate.js` is employed.

### Phase 2: Resume Understanding Upgrade
- **Status:** Partially Done (50%).
- **Evidence:** `workflows.json` Node 4 (Message a model) and Node 5 (Code in JavaScript).
- **Already satisfies:** LLM structured extraction is wired up (JSON output constraint, validation pass).
- **Missing:** The default `ai-gateway` is not explicitly wired to a local Ollama instance (no Ollama references in config or docker). Need to confirm `eligibility_tier` generation. 

### Phase 3: Free-First Search Provider Layer
- **Status:** Not Started (0%).
- **Evidence:** `workflows.json` Node 6 explicitly calls `https://api.tavily.com/search`.
- **Already satisfies:** Multi-Source Search Plan generation (Node 9).
- **Missing:** JobSpy, SearxNG, TinyFish, and Simplify-Internships connectors are completely absent.

### Phase 4: Discovery Execution & Content Extraction Hardening
- **Status:** Partially Done (20%).
- **Evidence:** `workflows.json` Node 12, Node 20 (Playwright), Node 13 (Clean HTML). 
- **Already satisfies:** The Loop/If/playwright structure is implemented (cheap fetch + Playwright fallback).
- **Missing:** Uses custom JS for HTML cleaning instead of `@mozilla/readability`. Missing `robots-parser`, `bottleneck`, and `browser-use`. No explicit blocking of LinkedIn.

### Phase 5: Canonical Link Resolver
- **Status:** Not Started (0%).
- **Evidence:** No nodes in `workflows.json` correspond to this step.
- **Already satisfies:** None.
- **Missing:** Entirety of canonical link resolution logic.

### Phase 6: Duplicate Detection Upgrade
- **Status:** Partially Done (30%).
- **Evidence:** `data/migrations/003_opportunities.sql` contains `content_hash` and `data/migrations/006_dedup_signatures.sql` exists.
- **Already satisfies:** Exact string/hash dedup structure exists.
- **Missing:** Fuzzy match (`fast-fuzzy`) and semantic/embedding similarity dedup. 

### Phase 7: Trust & Fraud Screening Gate
- **Status:** Partially Done (40%).
- **Evidence:** `data/migrations/003_opportunities.sql` (flags: `fraud_flagged`, `scam_flagged`, `status`). Node 22 (guard node).
- **Already satisfies:** Database schema accommodates these flags natively.
- **Missing:** Keyword/pattern heuristic module, domain-org consistency check, description completeness scoring.

### Phase 8: Freshness & Recency Verification
- **Status:** Partially Done (30%).
- **Evidence:** DB schema has `last_verified_at` and `expired` status. `worker.js` exists for background tasks.
- **Already satisfies:** Background task infrastructure and database schema ready.
- **Missing:** Periodic re-verification routine to check dead links and update `last_verified_at`.

### Phase 9: Geographic & Eligibility Rules
- **Status:** Partially Done (80%).
- **Evidence:** `workflows.json` Node 24 (Geographic Allocator). 

### Phase 10: Resume-Opportunity Matching
- **Status:** Partially Done (70%).
- **Evidence:** `workflows.json` Node 17 (Resume Match Engine).

### Phase 11: Ranking Engine
- **Status:** Partially Done (70%).
- **Evidence:** `workflows.json` Node 8 (Parse + Rank Opportunities) and `004_ranking_results.sql`.

### Phase 12: Adaptive Result Assembly
- **Status:** Partially Done (70%).
- **Evidence:** `workflows.json` Node 18, 25.

### Phase 13: Safety & Privacy
- **Status:** Partially Done (70%).
- **Evidence:** `job-server/src/worker.js` explicitly deletes uploaded resumes after processing.

### Phase 14: Evaluation Harness
- **Status:** Done (100%).
- **Evidence:** `fixtures/` has extensive evaluation scripts.

### Phase 15: Production Hardening
- **Status:** Not Started (10%).

## Data Layer Findings
- **Schema Presence:** Yes, `opportunities`, `candidates`, and several auxiliary tables are present. 
- **Migration Tooling:** `node-pg-migrate` is not present in `package.json`. Migrations are handled by a custom `migrate.js` script in `data/src`.
- **pgvector:** Fully enabled (`001_enable_pgvector.sql` executes `CREATE EXTENSION IF NOT EXISTS vector`).
- **Deviations:** The `opportunities` table uses a `content_hash` for uniqueness and maintains independent `fraud_flagged` and `scam_flagged` booleans instead of a single `trust_score`. 

## Tooling Inventory
| Tool | Status | Notes |
|---|---|---|
| SearxNG | Not present | Missing from `docker-compose.yml` |
| Ollama | Not present | No explicit setup found |
| pgvector | Present | Found in `docker-compose.yml` and migrations |
| JobSpy | Not present | Missing |
| Resume-Matcher | Not present | Missing |
| browser-use | Not present | Missing |
| TinyFish | Not present | Missing |
| @mozilla/readability | Not present | Missing |
| robots-parser | Not present | Missing |
| bottleneck | Not present | Missing |
| fast-fuzzy | Not present | Missing |
| node-pg-migrate | Not present | Custom `migrate.js` logic used instead |

## Risks & Blockers
1. **n8n Loop Split Bug (Blocker):** `workflows.json` notes on Node 7 (Loop Over Items) indicate a structural issue: "batchSize MUST stay 1. The If node splits each batch between the direct-fetch and playwright branches... a batch containing items on both branches makes the done-branch fire more than once." This will cause cascading downstream failures.
2. **RENDER-SERVICE API Key Rotation (Risk):** Node 20 (playwright) states that it authenticates against RENDER-SERVICE's API key. Accidental mismatch with `GATEWAY_API_KEY` causes a silent 401 failure resulting in empty pages for JS-heavy sites. 
3. **Hardcoded API Dependency (Blocker for Phase 3):** Tavily API calls are hardcoded directly in `workflows.json` (Node 6) making it currently impossible to run discovery end-to-end without a paid Tavily API key unless `STUB_PIPELINE` mode is used.

## Recommended Immediate Next Action
Extract the pipeline's logic into `execution-fabric` as pure Node.js code to remove `n8n` as a production runtime dependency, unblocking the ability to easily test and refactor the flawed loop branch logic.
