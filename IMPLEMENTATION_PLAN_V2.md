# IMPLEMENTATION_PLAN_V2.md
## Final Engineering Blueprint

## 1. Executive Summary

- **Repository health**: Excellent structural health in existing Node.js services. High coupling and debt in the n8n orchestrator.
- **Architecture compatibility**: Mostly compatible, but completely missing the Execution, Intelligence, and Data Planes specified in `FINAL_ARCHITECTURE.md`.
- **Estimated completion**: ~35% of overall architecture.
- **Technical debt**: Monolithic workflow execution within n8n (`Split in Batches` loops over hundreds of items). Lack of a real database.
- **Critical risks**: High-fan-out memory exhaustion in n8n. Uncontrolled LLM costs from lacking Deduplication and Domain Classification.
- **Blocking issues**: None currently block starting work, but moving n8n execution is blocked until the Execution Plane is built.
- **Engineering confidence**: High. The hard problems (rendering, provider abstraction) are solved. The remaining work is standard distributed systems engineering.

---

## 2. Repository Inventory

### `/ai-gateway`
- **Purpose**: Unified LLM provider routing, JSON schema enforcement, and task-specific prompt logic.
- **Status**: Complete (Requires minor extensions).
- **Owner component**: Platform Services.
- **Architecture mapping**: Maps directly to `Platform Services: AI Gateway`.
- **Recommendation**: KEEP. Extend to support lightweight model tiers for Domain Classification.

### `/render-service`
- **Purpose**: Headless browser rendering, Cloudflare evasion, and resource blocking for performance.
- **Status**: Complete.
- **Owner component**: Platform Services.
- **Architecture mapping**: Maps directly to `Platform Services: Playwright Render Service`.
- **Recommendation**: KEEP. 

### `/playwright`
- **Purpose**: Playwright testing/cache directory.
- **Status**: Unused.
- **Owner component**: Tooling.
- **Architecture mapping**: None.
- **Recommendation**: DELETE or add to `.gitignore`.

### `/agent`
- **Purpose**: Placeholder/empty directory.
- **Status**: Unused.
- **Owner component**: N/A.
- **Architecture mapping**: None.
- **Recommendation**: DELETE.

### `/` (Root)
- **Purpose**: n8n workflows export (`workflows.json`) and documentation.
- **Status**: Partial.
- **Owner component**: Control Plane.
- **Architecture mapping**: Maps to `Control Plane (n8n)`.
- **Recommendation**: MODIFY. The root should house the new `execution-plane`, `intelligence-plane`, and `data-plane` packages.

---

## 3. File Inventory

### `ai-gateway/src/app.js`
- **Purpose**: Express app setup, middleware, and route mounting.
- **Current responsibility**: Rate limiting, auth, routing.
- **Architecture responsibility**: Same.
- **Action**: KEEP.
- **Engineering justification**: Production-ready.
- **Dependencies**: Express, `gateway-service.js`.
- **Estimated effort**: 0 days.

### `ai-gateway/src/gateway-service.js`
- **Purpose**: Core LLM routing and failover logic.
- **Current responsibility**: Loops providers, parses JSON.
- **Architecture responsibility**: Same, plus model tiering.
- **Action**: MODIFY. Add `classification` task routing.
- **Engineering justification**: Needs to support cheap fast models.
- **Dependencies**: Provider modules.
- **Estimated effort**: 0.5 days.

### `ai-gateway/src/tasks/extract-opportunity.js`
- **Purpose**: Prompt logic for job extraction.
- **Current responsibility**: Formats HTML and schema.
- **Architecture responsibility**: Same.
- **Action**: KEEP.
- **Engineering justification**: Already schema-enforced.
- **Dependencies**: `opportunity-schema.js`.
- **Estimated effort**: 0 days.

### `ai-gateway/src/tasks/opportunity-schema.js`
- **Purpose**: Zod/JSON schema for job extraction.
- **Current responsibility**: Validation.
- **Architecture responsibility**: Same.
- **Action**: KEEP.
- **Engineering justification**: Prevents downstream failures.
- **Dependencies**: None.
- **Estimated effort**: 0 days.

### `render-service/src/browserManager.js` & `renderer.js`
- **Purpose**: Singleton browser state and page extraction.
- **Current responsibility**: Render DOM, evade bots.
- **Architecture responsibility**: Same.
- **Action**: KEEP.
- **Engineering justification**: Highest risk component, currently stable.
- **Dependencies**: Playwright.
- **Estimated effort**: 0 days.

### `render-service/src/requestQueue.js`
- **Purpose**: In-memory concurrency limiting.
- **Current responsibility**: Prevents browser OOM.
- **Architecture responsibility**: Same.
- **Action**: KEEP.
- **Engineering justification**: Essential for node stability.
- **Dependencies**: None.
- **Estimated effort**: 0 days.

### `workflows.json` (Root)
- **Purpose**: Orchestration of the entire pipeline.
- **Current responsibility**: Webhooks, looping, parsing, API calls, ranking.
- **Architecture responsibility**: Triggers, cron, alerting, human review ONLY.
- **Action**: MODIFY (Severely prune).
- **Engineering justification**: N8n cannot handle distributed scaling or per-domain rate limiting for execution.
- **Dependencies**: AI Gateway, Render Service.
- **Estimated effort**: 5 days.

---

## 4. Folder Mapping

**Current Folder ↓ Final Folder**
- `/ai-gateway` ↓ `/packages/platform/ai-gateway`
- `/render-service` ↓ `/packages/platform/render-service`
- `[New]` ↓ `/packages/execution/discovery-worker`
- `[New]` ↓ `/packages/intelligence/profile-builder`
- `[New]` ↓ `/packages/intelligence/search-planner`
- `[New]` ↓ `/packages/intelligence/ranking-engine`
- `[New]` ↓ `/packages/data/db`
- `workflows.json` ↓ `/control-plane/n8n/workflows.json`

---

## 5. Service Ownership

### `ai-gateway`
- **Owns**: Provider fallback, schema extraction.
- **APIs**: `POST /api/ai/chat`, `GET /health`
- **Who calls it**: Currently n8n. Future: Execution Plane Workers.
- **Remains?**: Yes.

### `render-service`
- **Owns**: DOM rendering.
- **APIs**: `POST /api/render/fetch`, `GET /api/health`
- **Who calls it**: Currently n8n. Future: Execution Plane Workers.
- **Remains?**: Yes.

---

## 6. API Inventory

**Current endpoints**:
- `AI Gateway`: `POST /api/ai/chat`
- `Render`: `POST /api/render/fetch`

**Missing endpoints**:
- `AI Gateway`: `POST /api/ai/classify` (for fast Domain/Content classification).
- `Execution Plane`: `POST /api/jobs/enqueue` (for n8n to trigger runs).
- `Intelligence Plane`: `POST /api/profile/build` (resume to profile).
- `Intelligence Plane`: `POST /api/search/plan` (profile to tiered query).
- `Intelligence Plane`: `POST /api/rank` (score generation).

---

## 7. Database Audit

**Current State**: n8n SQLite DB (Embedded).
**Compatible?**: No. Must be replaced entirely.

**Missing Databases to Provision**:
1. **Relational Store (PostgreSQL)**:
   - `Candidates` (id, resume_raw, profile_versioned)
   - `Opportunities` (id, title, company, apply_url, status, quality_score, last_verified_at)
2. **Vector Store (Pinecone / pgvector)**:
   - `Candidate_Embeddings`
   - `Opportunity_Embeddings`
3. **Cache (Redis)**:
   - `Domain_Classification` (hash map)
   - `Content_Hash_Dedup` (set)
4. **Execution Queue (Redis / BullMQ)**:
   - Job queues per domain (for politeness).

---

## 8. Workflow Audit

**Current `workflows.json` Analysis**:
- **Trigger Node**: Keep.
- **Ollama Resume Node**: Modify. Remove inference, keep literal parsing.
- **Set Keywords Node**: Remove. Replaced by Search Query Planner.
- **Tavily Search Node**: Move into Execution Plane worker.
- **Split In Batches**: Remove. Replaced by RabbitMQ/BullMQ horizontal workers.
- **Render Service Node**: Move into Execution Plane worker.
- **AI Gateway Node**: Move into Execution Plane worker.
- **Parse + Rank Code Node**: Move into Intelligence Plane (Ranking Engine).

**Why**: n8n UI is a control plane, not an execution fabric. Looping over 500 URLs inside n8n causes crashes and cannot be effectively load-balanced.

---

## 9. Existing Component Reuse

- **AI Gateway Schema Validation (`zod`)**: Reuse. It guarantees perfect data output. Estimated savings: 1 week.
- **Render Service Bot Evasion**: Reuse. Saves massive headaches debugging Cloudflare. Estimated savings: 2-3 weeks.
- **Gateway Provider Fallback**: Reuse. Ensures uptime without writing complex retry logic. Estimated savings: 1 week.
*Never rewrite these. Simply invoke them from the new Execution Plane.*

---

## 10. Missing Components

### Execution Worker (`packages/execution/discovery-worker`)
- **Folder**: `/packages/execution/discovery-worker`
- **Files**: `index.js`, `worker.js`, `pipeline.js`.
- **Classes**: `DiscoveryPipeline`, `RateLimiter`.
- **Dependencies**: `bullmq`, `redis`, `pg`.
- **Acceptance Criteria**: Consumes URL from queue, checks Domain Cache, fetches, extracts, deduplicates, saves to PG.

### Candidate Profile Builder (`packages/intelligence/profile-builder`)
- **Folder**: `/packages/intelligence/profile-builder`
- **Files**: `builder.js`, `prompts.js`, `schema.js`.
- **Dependencies**: `openai` (for embeddings), `pgvector`.
- **Acceptance Criteria**: Takes literal parsed resume, outputs trajectory, skills, and embedding.

### Domain Classifier (`packages/intelligence/classifier`)
- **Folder**: `/packages/intelligence/classifier`
- **Dependencies**: `redis`.
- **Acceptance Criteria**: Given URL, returns `STATIC`, `JS`, or `BLOCKLIST`. Caches result.

### Ranking Engine (`packages/intelligence/ranking-engine`)
- **Folder**: `/packages/intelligence/ranking-engine`
- **Files**: `scorer.js`, `similarity.js`.
- **Dependencies**: `pgvector`.
- **Acceptance Criteria**: Calculates Quality * Semantic Fit.

---

## 11. Dependency Graph

1. **Databases (PG, Redis)** -> [Unblocks Everything]
2. **Intelligence Plane (Profile Builder)** -> [Unblocks Search Planner]
3. **Execution Plane (Queue, Workers)** -> [Unblocks Domain Classifier & Dedup]
4. **Execution Plane Pipeline** -> Depends on AI Gateway & Render Service.
5. **Ranking Engine** -> Depends on PG Vector Data.
6. **n8n Refactor** -> Depends on complete Execution Plane.

---

## 12. Build Order (Roadmap)

### Sprint 1: Persistence & Intelligence Core
- **Deliverables**: Setup PostgreSQL + pgvector, Redis. Build `Candidate Profile Builder` and `Search Query Planner` services.
- **Dependencies**: None.
- **Acceptance Criteria**: Uploading a raw resume inserts a valid semantic profile embedding into Postgres.

### Sprint 2: Execution Fabric
- **Deliverables**: Build `discovery-worker` with BullMQ. Setup per-domain rate limiting.
- **Dependencies**: Sprint 1 DBs.
- **Acceptance Criteria**: Submitting 10 URLs queues them and processes them concurrently without crashing.

### Sprint 3: Cost Optimization Pipeline
- **Deliverables**: Implement `Domain Classifier` (Redis cache) and `Content-Hash Dedup` inside the worker pipeline.
- **Dependencies**: Sprint 2 workers.
- **Acceptance Criteria**: Duplicate URLs are skipped. Static domains bypass Playwright.

### Sprint 4: Semantic Matching & Ranking
- **Deliverables**: Build `Ranking Engine` and `Semantic Dedup`. 
- **Dependencies**: Sprint 1 (Embeddings) & Sprint 3 (Extracted Data).
- **Acceptance Criteria**: Opportunities are scored Quality x Fit and geographic quotas are applied.

### Sprint 5: Control Plane Cutover
- **Deliverables**: Remove looping from n8n. Add Webhook to enqueue jobs to Execution Plane. Add Recurring Re-validation cron.
- **Dependencies**: Sprints 1-4.
- **Acceptance Criteria**: n8n triggers the job, execution plane finishes it, and outputs to Opportunity Radar.

---

## 13. Migration Plan
1. **Parallel Run**: Keep current n8n workflow active.
2. **Deploy DBs & Microservices**: Deploy the new packages in parallel.
3. **Shadow Testing**: Copy traffic from n8n into the Execution Plane and verify database outputs match.
4. **Cutover**: Swap the n8n logic to just call `Enqueue Job` and delete the old nodes.
- **Rollback**: Restore the exported `workflows.json`. No existing APIs are modified destructively.

---

## 14. Testing Plan
- **Unit tests**: AI Gateway schemas, Ranking Engine math functions.
- **Integration tests**: BullMQ enqueuing and dequeuing, Redis caching hits.
- **E2E tests**: Send a dummy resume -> Check final Postgres output.
- **Failure tests**: Simulate Playwright crash, simulate OpenAI 429. Ensure BullMQ retries correctly.

---

## 15. Production Readiness
- **AI Gateway**: Ready.
- **Playwright Render**: Ready.
- **n8n Orchestration**: Needs work (must be reduced).
- **Execution Plane**: Blocked (Needs DBs).
- **Intelligence Plane**: Blocked (Needs DBs).

---

## 16. Technical Debt
- **Current debt**: SQLite database lock-in in n8n. Monolithic orchestration.
- **Future debt**: Vector DB storage costs. Maintaining ATS API schemas.
- **Refactoring candidates**: `Parse + Rank` math inside n8n must be ripped out into a version-controlled Node.js package.

---

## 17. Final Engineering Backlog

1. **ID-001** [Critical] Provision PostgreSQL and Redis.
2. **ID-002** [Critical] Create Monorepo structure (`packages/`).
3. **ID-003** [High] Build `profile-builder` API to generate embeddings.
4. **ID-004** [High] Build `search-planner` to generate tiered search JSON.
5. **ID-005** [Critical] Build `discovery-worker` queue consumer.
6. **ID-006** [High] Implement Domain Classification Redis cache in worker.
7. **ID-007** [High] Implement Content-Hash deduplication in worker.
8. **ID-008** [High] Wire worker to call `ai-gateway` and `render-service`.
9. **ID-009** [Medium] Build `ranking-engine` (Quality x Fit) utilizing embeddings.
10. **ID-010** [Critical] Refactor n8n to call `discovery-worker` queue and remove internal batching.

---

## 18. Final Verdict

- **Can implementation begin?** Yes.
- **What is still missing?** Nothing from the planning perspective.
- **Is the architecture fully mapped?** Yes, strictly to `FINAL_ARCHITECTURE.md`.
- **Is the repository understood?** Yes, completely.
- **Is another audit required?** No.
- **Estimated remaining engineering effort**: 5 sprints (10 weeks) for 2 backend engineers.
