# Project Architecture and Status

## 1. Executive Summary
The AI Opportunity Discovery Agent is currently functioning as an end-to-end pipeline orchestrated by **n8n**. The foundational microservices (Data Plane, AI Gateway, Render Service, Profile Builder) are robust and integrated directly into the n8n workflow.

**Important Note on Execution Fabric & Search Planner:** 
While code for a Node.js-based `execution-fabric` (job dispatcher/worker pool) and `search-planner` exists in the repository, they remain **unused stubs by design**. The scaling work to move orchestration out of n8n has been deferred, not forgotten. 
*Trigger to pick this back up:* If processing needs to run concurrently for multiple candidates, or if per-resume processing latency needs to drop significantly through parallel extraction, the `execution-fabric` should be wired up to replace the n8n execution loops.

## 2. Current Working Architecture

The system is currently wired as follows, verified directly against the `workflows.json` configuration:

1. **Control Plane & Orchestration (`n8n`)**: Handles the entire execution loop.
2. **Resume Parsing**: 
   - A PDF is read and extracted via n8n's `Extract from File` node.
   - Passed to `Message a model` (AI Gateway) to build a candidate profile.
3. **Discovery & Deduplication**:
   - `HTTP Request` nodes query Tavily for job postings.
   - Results are normalized, classified, and deduplicated via `Discovery Quality Gate + Dedup`. Identical postings from different job boards are clustered using URL hostnames and title signatures, and condensed into a single winner with `multi_query_evidence`.
4. **Extraction Pipeline**:
   - `playwright` (Render Service) fetches the raw HTML.
   - `Clean HTML` node strips unnecessary bloat.
   - `HTTP Request1` sends the cleaned DOM to the AI Gateway's `extract_opportunity` task to output structured JSON.
5. **Fit Scoring**:
   - The `HTTP Request` node makes a direct call to the AI Gateway's `score_fit` task. It compares the extracted opportunity against the candidate profile and returns a 0-100 `fit_score`, a specific `reasoning` sentence, and `missing_requirements`.
6. **Geographic Allocation (`Geographic Allocator`)**:
   - A custom n8n code node takes the fully scored and deduped opportunities and enforces a strict geographic quota (7 same state, 2 same country, 1 international).
   - It buckets opportunities based on the candidate's location, sorts each bucket by the AI `fit_score`, and backfills from other buckets if a quota cannot be met.
   - It appends a `quota_status` field (`full`, `degraded`, or `insufficient_data`) to the final payload.

## 3. The Microservices

- **Data Plane (PostgreSQL + Redis)**: Native macOS Postgres (with `pgvector` enabled) and Redis running locally. Used by the `data` package.
- **AI Gateway (`ai-gateway/`)**: Express API on port 4000. Handles all LLM prompting logic via tasks (`score_fit`, `extract_opportunity`, etc.). Uses Gemini and Groq with robust try/catch, fallback, and JSON repair mechanisms. A payload limit of 10MB has been set in Express to handle large page texts.
- **Render Service (`render-service/`)**: Playwright headless browser API on port 3000 for HTML extraction and Cloudflare bypass.

## 4. Known Limitations & Edge Cases (Documented Tradeoffs)

During edge-case testing, the following behaviors were verified and **accepted as-is** representing documented tradeoffs:

1. **Scanned / Image-Based Resumes**: The `build_profile` AI task degrades gracefully. If no text is extracted from the resume PDF, it infers a "student" profile with 0 confidence. The pipeline does not crash, but the resulting searches will be generic.
2. **Resumes or Opportunities Missing Location**: If the candidate or opportunity lacks a clearly stated location, the `Geographic Allocator` puts the opportunities into an `unresolved_location` bucket. It then successfully uses them to backfill the quota, returning a `quota_status` of `"degraded"`.
3. **Zero Search Results**: If a search (e.g., international tier) returns zero Tavily results, the pipeline processes the empty array gracefully, and the `Geographic Allocator` outputs fewer than 10 results with a `quota_status` of `"insufficient_data"`.
4. **Near-identical Job Postings**: The `Discovery Quality Gate + Dedup` node successfully clusters identical postings from different job boards (e.g., matching company+role signature) and picks the one with the highest source tier, retaining the multi-query evidence without creating duplicates.
5. **LLM Hallucinations / Rate Limits**: The AI Gateway automatically handles provider rate limits (e.g., Groq 429s) by falling back to Gemini, preventing the pipeline from crashing. Invalid JSON outputs are caught and repaired.

## 5. Source of Truth

- **Fit Scoring**: Handled exclusively by `ai-gateway/src/tasks/score-fit.js`.
- **Geographic Allocation**: Handled exclusively by the `Geographic Allocator` node in `workflows.json`.

*(This document supersedes all older architectural claims, including `CURRENT_PROJECT_STATUS.md` and `FINAL_PRODUCTION_ARCHITECTURE.md`, which should be considered deprecated).*
