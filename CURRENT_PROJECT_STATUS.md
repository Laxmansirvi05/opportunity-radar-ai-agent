# CURRENT PROJECT STATUS

## 1. Executive Summary
The project is midway through a critical architectural transition. The foundational microservices (Data Plane, AI Gateway, Render Service, Profile Builder) are robust, tested, and complete. Development stopped exactly while shifting the core orchestration out of `n8n` into the new Node.js `execution-fabric` and `search-planner`. These new modules have been written but remain uncommitted (untracked) in the Git repository alongside their corresponding database migrations. 

## 2. Current Architecture
- **Control Plane**: `n8n` (Currently handling too much, destined to become just a cron/trigger UI).
- **Data Plane**: PostgreSQL + Redis (`data/`) [✅ Completed]
- **AI Gateway**: Express API routing LLM tasks (`ai-gateway/`) [✅ Completed]
- **Render Service**: Playwright headless browser for extraction (`render-service/`) [✅ Completed]
- **Profile Builder**: Parses resumes into Intelligence Profiles (`profile-builder/`) [✅ Completed]
- **Execution Fabric**: Job dispatcher and worker pool (`execution-fabric/`) [🟡 Partially Completed - Uncommitted]
- **Search Planner**: Translates Profiles to queries (`search-planner/`) [🟡 Partially Completed - Uncommitted]

## 3. Current Pipeline

Resume Upload (n8n trigger)
↓
Resume Parsing (profile-builder) [✅ Completed]
↓
AI Normalization & Inference (ai-gateway) [✅ Completed]
↓
Search Planning (search-planner) [🟡 Partially Completed - Uncommitted]
↓
Execution Fabric (Dispatcher/Worker) [🟡 Partially Completed - Uncommitted]
↓
Render Service (playwright) [✅ Completed]
↓
Opportunity Extraction (ai-gateway) [✅ Completed]
↓
Deduplication (data) [🟡 Partially Completed - Repos exist, not wired end-to-end]
↓
Ranking (n8n Code Node) [❌ Not Started - Needs extraction from n8n]
↓
Final Output

## 4. Completed Features
- **AI Gateway**: ✅ Completed. Multi-provider support (Gemini, OpenRouter, Groq) and task-based registries are fully implemented.
- **Playwright Render Service**: ✅ Completed. Browser recycling, Cloudflare challenge handling, resource blocking, and private network restrictions are fully implemented.
- **Resume parsing**: ✅ Completed. `profile-builder.js` implements the full pipeline (Validation -> Hash -> Gateway -> Validate -> DB).
- **Candidate normalization**: ✅ Completed. Normalizers for skills, titles, and locations are implemented inside `search-planner/src/normalizers`.
- **AI prompts**: ✅ Completed. Prompts are implemented as distinct tasks inside `ai-gateway/src/tasks/`.
- **JSON schemas**: ✅ Completed. Available centrally in `data/src/schemas`.
- **Validation**: ✅ Completed. Secondary schema validation is implemented in the data plane and `profile-builder`.
- **Retry logic**: ✅ Completed. Available in `execution-fabric/src/retry-policy.js` and `circuit-breaker.js`.
- **Timeout handling**: ✅ Completed. Handled with `Promise.race` in `execution-fabric/src/orchestrator.js` and custom timeouts in services.
- **Error handling**: ✅ Completed. Custom error classes (`ProfileBuildError`, `GatewayClientError`, etc.) with structured contexts are used throughout.
- **Logging**: ✅ Completed. Structured JSON logging implemented (`execution-fabric/src/event-logger.js`, `render-service/src/logger.js`).
- **Configuration**: ✅ Completed. Implemented cleanly in each module via `config.js` loading from `.env`.

## 5. Partially Completed Features
- **n8n workflows**: 🟡 Partially Completed. Exists but requires refactoring to remove the heavy execution loop and delegate to the Execution Fabric.
- **Search pipeline**: 🟡 Partially Completed. `search-planner` is fully written but remains untracked/uncommitted in git.
- **Queue management**: 🟡 Partially Completed. Worker and dispatcher exist in `execution-fabric`, but it's currently an untracked local promise-pool.
- **Deduplication**: 🟡 Partially Completed. Repositories (`dedup-repository.js`) and hashing logic exist but are uncommitted / not fully integrated.
- **Authentication**: 🟡 Partially Completed. API keys are checked via environment variables but internal service auth is basic.
- **README**: 🟡 Partially Completed. Root README is missing, though architectural markdown files exist.
- **Documentation**: 🟡 Partially Completed. Architectural docs exist but need updating to reflect the new uncommitted components.
- **Tests**: 🟡 Partially Completed. 17 test files exist for core logic, but the newly written `search-planner` and `execution-fabric` lack full coverage.

## 6. Missing Features
- **Ranking**: ❌ Not Started. Mathematical ranking exists in the old n8n monolithic node but hasn't been extracted into the new Node architecture.
- **Verification**: ❌ Not Started. No logic found for verification of extracted opportunities.

## 7. Current Problems
- **Uncommitted Code**: Substantial amounts of new code (`execution-fabric`, `search-planner`, `data` repositories and migrations) are sitting as untracked files in the working directory.
- **n8n Bottleneck**: `n8n` is still architecturally acting as an execution loop rather than just a control plane, which is prone to memory crashes under high-fan-out tasks.

## 8. Current Risks
- **Database Schema Desync**: The database schema is being actively modified (`011_search_plans.sql`, `012_execution_runs.sql`). Applying these migrations must be synchronized with committing the new services.
- **Hybrid State**: The system is in a hybrid state where old `n8n` logic might clash with new `execution-fabric` infrastructure if triggered simultaneously.

## 9. Last Completed Work
- **Most recently modified files**: `data/src/index.js`, `data/package.json`, and numerous new files in `search-planner/` and `execution-fabric/`.
- **Most recent feature**: Execution Fabric and Search Planner orchestration, including their data repositories.
- **Most recent architectural changes**: Designing and writing the new Execution Fabric to move monolithic discovery loops out of n8n.
- **AI Gateway improvements**: ✅ Implemented (Tasks & Providers).
- **Task-based extraction**: ✅ Implemented.
- **Provider fallback**: ✅ Implemented.
- **Render Service improvements**: ✅ Implemented.
- **Port configuration issues**: ✅ Resolved (Via dotenv and config mapping).

## 10. Recommended Next Task
1. Stage and commit the uncommitted code in `execution-fabric`, `search-planner`, and `data` (including migrations 011 and 012).
2. Run database migrations to apply the new schemas.
3. Write/run tests for the new uncommitted Node.js logic to ensure it behaves as expected before refactoring n8n.

## 11. Estimated Overall Completion
- **Architecture**: 100%
- **AI Gateway**: 100%
- **Render Service**: 100%
- **Resume Intelligence**: 100%
- **n8n Workflow**: 30% (Awaiting refactor to become Control Plane only)
- **Search Pipeline**: 70% (Written but uncommitted/untested)
- **Extraction Pipeline**: 90% (Integrated into Gateway)
- **Ranking**: 10% (Math exists, needs porting)
- **Verification**: 0%
- **Overall AI Agent**: ~65%

## 12. What should be worked on NEXT
After committing the local changes and verifying the new `execution-fabric`, the immediate next step is **ID-010: Refactor n8n**. We must wire up the new Execution Fabric to the `n8n` orchestrator to relieve `n8n` of the looping burden and switch it to trigger the new `enqueue job` webhook.
