# PROJECT_AUDIT

## 1. Verdict

The project is currently a functional but fragile proof-of-concept pipeline, far from being integration-ready as a web service. While core components (resume parsing, search planning, extraction, scoring) individually work using real LLMs and live web search, the orchestration relies entirely on a monolithic, synchronous n8n workflow executed via a shell script. It lacks proper state management, robust error handling, concurrency support, and strictly violates several hard product rules—most notably by aggressively padding results to hit a 10-item quota instead of gracefully handling weak resumes or low-quality discoveries.

## 2. Actual Architecture

**Orchestration:** `run_pipeline.sh` boots 4 local Express microservices and runs a single n8n workflow synchronously via `npx n8n execute`.

**Data Flow (per `workflows.json`):**
1. **Trigger:** `manualTrigger` (no HTTP entry point).
2. **File Read:** `Read/Write Files from Disk` (hardcoded path) → `Extract from File` (extracts text from PDF).
3. **Profile Build:** `Message a model` POSTs text to `profile-builder` (runs locally, calls `ai-gateway`). Produces a Candidate Intelligence Profile (CIP).
4. **Search Plan:** `Build Multi-Source Search Plan` generates up to 60 search queries based on inferred skills/roles.
5. **Search:** `HTTP Request` calls Tavily API with queries.
6. **Filtering:** `Normalize + Classify` → `Discovery Quality Gate + Dedup` filters junk and deduplicates based on heuristics and spam patterns.
7. **Processing Loop:** `Loop Over Items` processes survivors individually.
8. **Scraping:** `HTTP Request1` tries direct GET. `If` node routes failures to `playwright` (local render-service). `Clean HTML` → `Extract Main Content` strips boilerplate.
9. **Extraction:** `HTTP Request2` (to `ai-gateway`) extracts structured opportunity JSON.
10. **Standardization & Scoring:** `Standardize Opportunity` formats fields → `Resume Match Engine` calls `ai-gateway` to score candidate fit.
11. **Finalization:** `Finalize Results` takes top 20 → `Geographic Allocator` pads to exactly 10 and assigns tiers.
12. **Output:** Workflow writes to `pipeline_execution.json`.

## 3. Verified Working

- **Resume Parsing (CIP):** Real extraction to structured JSON with literal/inferred sections and confidence scores (`ai-gateway/src/tasks/build-profile.js`).
- **Live Search & Scraping:** Tavily is actually called. Playwright fallback successfully handles JS-heavy pages when simple GET fails (`workflows.json` nodes `HTTP Request1`, `playwright`, `Clean HTML`).
- **Data Extraction:** LLM successfully structures unstructured HTML into the defined schema (`ai-gateway/src/tasks/extract-opportunity.js`).
- **Match Scoring:** Semantic matching between candidate and opportunity successfully runs and produces a score/reasoning (`ai-gateway/src/tasks/score-fit.js`).

## 4. Broken or Missing

- **[Critical] Concurrent Execution:** `run_pipeline.sh` kills existing Node processes and writes to a hardcoded `pipeline_execution.json` output file. The system cannot handle two simultaneous users.
- **[Critical] Error Handling / State Storage:** If a Tavily search or critical node times out, the entire synchronous n8n run dies. No state is saved mid-pipeline (`workflows.json`). Database migrations exist (`data/migrations/012_execution_runs.sql`), but n8n does not write execution progress to them.
- **[Major] Scanned PDFs:** `Extract from File` relies on text extraction. An image-based PDF yields empty text, which will crash the `build_profile` validation (`profile-builder/src/profile-builder.js:L91`).
- **[Major] Webhook Entry Point:** The workflow starts with `manualTrigger` and a hardcoded file read (`workflows.json`). It is impossible to POST a PDF to it currently.
- **[Minor] Missing Resume Feedback Path:** There is no "resume too weak" early exit. The pipeline will attempt to run full searches even on a blank or purely non-technical resume.

## 5. Product-Rule Violations

1. **Input is resume only:** **Met.** `run_pipeline.sh` and the workflow only take a PDF path.
2. **Output count (min 5, max 10) no padding:** **Not met.** `Geographic Allocator` (`workflows.json`) explicitly backfills up to 10 items using `if (needed() > 0) pull('unresolved_location', needed(), 'backfilled')`, regardless of quality.
3. **Weak-resume path exists:** **Not met.** No such path exists in the code. The system plows forward and backfills junk.
4. **Opportunity type derived from academic year:** **Not met.** `Build Multi-Source Search Plan` (`workflows.json`) simply appends "Intern" directly based on hardcoded technical skills (e.g. `targetRoles.push("Frontend Developer Intern")`) without checking academic year. The CIP extracts `careerStage` (`build-profile.js`), but the search planner ignores it entirely.
5. **Real and applyable URL:** **Partial.** `opportunity-schema.js` verifies it's a valid HTTP URL. `Discovery Quality Gate + Dedup` filters out known board pages heuristically, but there is no runtime check verifying the `apply_url` points directly to a single posting.
6. **No hallucinated fields:** **Partial.** Prompt asks for `null` (`extract-opportunity.js`), but there are no explicit "NEVER infer" anti-hallucination guardrails in the prompt for things like salary. Salary/hours are currently missing entirely from the schema (`opportunity-schema.js`).
7. **Callable service:** **Not met.** It is a CLI script.

## 6. Integration Gap (Blockers to Website Integration)

1. **No Job Server:** An async job server (e.g., Express) must be built to accept the POST request, validate the PDF, return an immediate `job_id`, and launch the pipeline in the background. 
2. **Synchronous n8n:** n8n must be reconfigured to run as a persistent daemon listening on a Webhook node, rather than one-shot CLI execution.
3. **Concurrency Collisions:** Shared output files (`pipeline_execution.json`) and kill-scripts (`run_pipeline.sh`) must be eliminated so multiple webhook runs don't overwrite or terminate each other.
4. **Lengthy Wall-Clock Runtime:** The loop processes up to 60 pages sequentially through LLMs. A realistic run takes 5–8 minutes (dominant cost: LLM processing in `Extract Main Content` and `Standardize Opportunity`). Synchronous HTTP responses to the website are impossible; long-polling or client-side WebSocket is required.

## 7. Unverified Claims (Docs vs. Reality)

- **Claim:** The `FINAL_ARCHITECTURE.md` likely describes an "Execution Fabric" and stateful tracking of execution runs.
- **Reality:** The `execution-fabric/` directory exists, but the actual pipeline runs via a flat n8n JSON file. `012_execution_runs.sql` is never written to by the active workflow.
- **Claim:** Robust error handling and resiliency.
- **Reality:** A timeout on the Tavily `HTTP Request` node (which has `continueOnFail: undefined/false`) will instantly kill the entire 8-minute job with no partial results saved.

## 8. Prioritized Next Steps

1. **Architectural Wrapper (Unblock Integration):** Replace `run_pipeline.sh` manual trigger with an Express job-server + n8n Webhook node. Implement async database tracking (Postgres) so a UI can poll for status.
2. **Kill the Padding Logic (Unblock Rule #2):** Modify `Geographic Allocator` to strictly return qualified items without backfilling to 10.
3. **Implement Year Routing (Unblock Rule #4):** Modify `Build Multi-Source Search Plan` to read `candidate.careerStage` and correctly route to "Internship" vs "Full-time" searches.
4. **Implement Weak Resume Path (Unblock Rule #3):** Add an early exit condition if `build_profile` returns extremely low confidence or zero target roles.
5. **Schema Extension & Prompt Hardening (Unblock Rule #6):** Add `salary` and `work_mode` to `opportunity-schema.js` and add aggressive anti-hallucination language to `extract-opportunity.js`.
