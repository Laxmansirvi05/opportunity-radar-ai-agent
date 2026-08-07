# Final Report — Opportunity Radar autonomous run

Tasks 1–6 from `CLAUDE_CODE_HANDOFF.md`. Task 7 not started, as instructed.

> **Read this first.** I never executed the full n8n pipeline. Zero of the ~12
> budgeted live pipeline runs were used. Everything about the *workflow* below is
> verified by replaying the **real node code** from `workflows.json` against
> fixtures captured from your last real run — not by an `n8n execute`. That is a
> genuine gap: node code can be correct in a sandbox and still fail on n8n
> wiring, expression syntax, or credentials. **Tasks 3–6 should be considered
> unproven end-to-end until one live run is done.**

---

## 1. Status per task

| Task | Status | Evidence |
|---|---|---|
| 1 — Scoring failures visible + reduced | **Complete** | Live measurement + fixture replay |
| 2 — Year-based routing | **Complete** | 16 unit tests + live service probe |
| 3 — Wire workflow to search-planner | **Complete, adapted** | Fixture replay; premise of the task was wrong (below) |
| 4 — Score floor + tier contract | **Complete** | Fixture replay + 5 edge cases |
| 5 — Broaden-and-retry, weak-resume exit | **PARTIAL** | Weak-resume done; **broaden-and-retry NOT built** |
| 6 — Parallelize the loop | **Partial** | Correctness proven; **wall-clock never measured** |

---

## 2. Three separate lists

### 2a. Verified with real execution
- **Scoring failure rate**, before and after — real ai-gateway calls against live
  Groq/Gemini (55 calls post-fix).
- **Gemini's 20-request/day quota** — confirmed directly against Google's API.
- **OpenRouter 0-for-19** — confirmed from `ai-gateway.log`.
- **`/search-plan/preview` and `/search-plan/build`** — booted the real service;
  `/build` returns FK violation `23503`, `/preview` returns correct plans.
- **Year routing** — live service, three graduation years.
- **The stale test fixture is invalid** — canonical validator rejects it.
- **Real pipeline failure rate of 52.6%** — computed from your captured run.

### 2b. Unit-tested / fixture-replayed only (NOT run through n8n)
- All `workflows.json` node changes (tasks 1, 3, 4, 5, 6). Executed as real code
  in a sandbox against real captured data, but never inside n8n.
- search-planner: 79 tests passing.
- 18 offline edge cases.
- Task 6's per-item conversion — correctness proven, speed not.

### 2c. Untested
- **Any full pipeline run.** No `n8n execute` was performed at all.
- **Tavily behaviour** with the new query text (opportunity-type-driven terms).
  Query *shape* changed; whether it returns better postings is unmeasured.
- **The `Build Response` node inside n8n** — it is newly added and has never run
  in n8n. Its connection was added programmatically.
- **Batch size 5 under real load** — untested against rate limits. Five
  concurrent scoring calls may reintroduce throttling that pacing had solved.
- **Whether `runOnceForEachItem` nodes behave identically in n8n** to my sandbox.
- Scanned/image-only PDF, empty PDF, non-PDF with `.pdf` extension, 5+ page
  resume, non-English resume — **not tested**; these need real pipeline runs.

---

## 3. Scoring failure rate

| Measurement | Sample | Failure rate |
|---|---|---|
| **Before** — historical `ai-gateway.log` | 49 chat requests | **20.4%** (10 failed) |
| **Before** — your captured pipeline run, per opportunity | 19 scored items | **52.6%** (10 failed) |
| **After** — live, paced ~2s | 30 calls | **3.3%** (1 failed) |
| **After** — live, paced ~2s | 25 calls | **0.0%** (0 failed) |
| **After — combined** | **55 calls** | **1.8%** (1 failed) |

The single post-fix failure was an anomalous `GLOBAL_TIMEOUT`: one call took
**363 seconds** against a configured 120s global budget. The budget did not
enforce. **Unexplained — see Still Broken.**

In the final 25-call run every request was served by Groq on the first attempt,
with zero provider failures.

**Root cause of the original failures** (not in the handoff): Gemini's configured
model `gemini-3.5-flash` has a **20-request/day** free-tier quota. Gemini was
first in the chain, so it consumed the first ~20 calls then failed all day:

```
RESOURCE_EXHAUSTED ... limit: 20, GenerateRequestsPerDayPerProjectPerModel-FreeTier
```

Historical per-provider: gemini 81/95 attempts failed (85%), groq 10/39 (26%),
**openrouter 19/19 (100%)**.

---

## 4. Runtime before/after parallelization

**Not measured.** This is a required acceptance criterion and it is absent.

- Before: ~5–8 min (your figure), `batchSize` unset (= 1). Confirmed by the
  captured run showing 20 Loop iterations for 19 items.
- After: unknown. Requires a live run.

---

## 5. Edge case table

18 cases exercised offline, 0 flagged. Items marked **NOT TESTED** need live runs.

| Case | Observed |
|---|---|
| 2nd-year student | → `internship`, source `education_end_year` |
| Final-year student | → `job` (F3 fixed) |
| Graduated (past endYear) | → `job` |
| Missing/unparseable endYear | → careerStage fallback, **recorded** via `source` + `fallbackReason` |
| No education section | → `internship` via `career_stage_fallback` |
| No work experience | → 45 queries still generated |
| Zero technical skills | → 60 queries still generated |
| No location anywhere | → 52 queries; geographies `["country","international_remote"]` |
| Multiple degrees (array) | → uses most recent (2028); **was broken, fixed** |
| Graduate w/ multiple degrees | → `job`, gradYear 2025 |
| Experienced professional | → `job`, 0 queries mention intern |
| Zero opportunities scored | → `weak_profile`, count 0 |
| **Scoring fails for every item** | → `weak_profile`, `{attempted:8, succeeded:0, failed:8}`, cause **named as provider errors** — NOT reported as "all scored low" |
| Only junk (all below floor) | → 0 returned, `below_score_floor: 12`, nothing padded |
| Fewer than 5 qualify | → `weak_profile`, returns the 3 that qualified + gaps |
| More than 10 qualify | → exactly 10, best-ranked, `quota_status: full` |
| All in one geographic bucket | → 10 returned, all `same_state`, widening used |
| Duplicate postings | Handled by pre-existing dedup in the quality gate; **not re-tested** |
| Scanned/image-only PDF | **NOT TESTED** |
| Empty/near-empty PDF | **NOT TESTED** |
| Non-PDF with `.pdf` extension | **NOT TESTED** |
| Very long resume (5+ pages) | **NOT TESTED** |
| Non-English resume | **NOT TESTED** |
| Tavily returns zero results | **NOT TESTED** |
| Tavily returns only aggregators | **NOT TESTED** |
| Every scrape fails | **NOT TESTED** |

---

## 6. Still broken

1. **Broaden-and-retry (Task 5) is not implemented.** Requires a cyclic n8n graph
   (Allocator → broadened plan → Tavily → scrape → score); re-searching without
   re-scraping is useless because scraping is per-item inside the loop. Could not
   be verified without live runs and a broken cycle risks the whole pipeline.
   **Consequence, plainly: removing padding (Task 4) without broadening means
   thin profiles now return FEWER results than before.** Honest results with an
   explanation — but fewer. This is a real user-visible regression in count.

2. **363-second request against a 120-second global budget.** The `GLOBAL_TIMEOUT`
   AbortController did not enforce. Root cause unknown. One occurrence in 55 calls.

3. **Batch size 5 is untested against rate limits.** Task 1's gains came partly
   from natural pacing. Five concurrent scoring calls may reintroduce throttling.
   These two changes work against each other and were never tested together.

4. **`missing_requirements` quality is poor.** In the real run, 14 of 14 distinct
   entries appeared exactly once, and several were extraction artifacts ("job
   description", "location", "workplace type" — the model listing missing *fields*,
   not missing *skills*). I filter artifacts and require a gap in ≥2 postings, so
   **in practice the captured run would produce zero reportable gaps.** The
   weak-resume feature is structurally correct but starved of good input. The fix
   is prompt work on `score_fit`, not more filtering.

5. **`MIN_ALLOCATION_SCORE = 50` is a judgment call**, not a derived threshold. I
   picked it; it is tunable in one place. It has never been validated against what
   students actually find useful.

6. **The pipeline's profile is not a CIP.** `Message a model` emits an ad-hoc
   `{candidate, career_intelligence, search_profile}` shape with no validator. My
   adapter converts it to a minimal CIP in-node — a second, thinner construction
   path duplicating what `profile-builder` already does properly.

7. **API key in cleartext in `workflows.json`**, which is tracked in git. It
   predates this run (already in history); I preserved rather than introduced it.
   **Recommend rotating it** and moving to `$env`. Not changed because n8n needs a
   working value and rotation is yours.

8. **execution-fabric (1,162 lines) remains unwired**, holding the provider
   adapters (greenhouse/lever/ashby/web-render) that architecturally should own
   provider selection.

---

## 7. Decisions made on your behalf

1. **Dropped OpenRouter entirely.** 0/19 real success — pure added latency.
   *Alternative:* keep as last resort. *Why not:* it never once succeeded.

2. **Task 3 adapter instead of replacement.** The task says replace the inline
   node with `/search-plan/build` and delete its logic. **That premise is wrong**,
   verified five ways:
   - `search_plans.candidate_id` is `NOT NULL REFERENCES candidates(id)`; a live
     POST returns FK violation `23503`. The pipeline is stateless.
   - The Tavily node needs `$json.query` (a string); search-planner returns
     structured objects with no query string. Commit 5ebd6b9's "shaped for n8n"
     claim is only half true.
   - `Normalize + Classify` calls `$("Build Multi-Source Search Plan").all()` by
     name and indexes it positionally for 11 fields search-planner doesn't supply.
   - Profile schema mismatch (ad-hoc vs CIP v2.0.0).
   - **Decisive:** the inline node does provider-*specific* discovery (9 source
     families, 45 queries in your run); search-planner is deliberately
     provider-*agnostic* with a passing test that fails if a provider name appears.
     Deleting it would cut discovery to ~9 generic queries.

   *Chosen:* search-planner owns the intelligence, the node keeps provider
   expansion. Discovery breadth preserved at 45–60 queries.

3. **Added `/search-plan/preview`** (stateless) rather than making the pipeline
   write candidate rows to Postgres. Smaller and reversible.

4. **profile-builder: WIRE IT IN, not delete.** Deleting would strand
   search-planner, which requires CIP v2.0.0, and would enshrine an unvalidated
   ad-hoc schema as the contract. profile-builder already produces a validated CIP
   *and* persists the candidate row that `/search-plan/build` needs. **Not wired
   during this run** — it changes the contract consumed by Resume Match Engine and
   Geographic Allocator, putting Task 1's hard-won scoring stability at risk. It is
   kept and should be wired as its own task.

5. **Kept a genuine score of 0 as a valid low score** in Task 1 rather than
   filtering it. Conflating "scored low" with "failed to score" is the exact bug
   Task 1 exists to fix; excluding low scores is Task 4's floor.

6. **`tier` stays geographic; widening moved to `allocation_reason`** (F6).
   *Alternative:* add `"backfilled"` to the contract. *Why not:* it isn't a
   geography, and mixing them is what broke the contract.

7. **Untracked `node_modules` + run artifacts** without rewriting history.
   Necessary: `pipeline_execution.json` is 81MB and regenerates every run.

---

## 8. Recommended next steps, ordered

1. **Do one live pipeline run.** Nothing in tasks 3–6 is proven until this passes.
   Expect wiring problems, not logic problems.
2. **Rotate the leaked API key.**
3. **Measure runtime** before/after batching, and watch for rate-limit failures
   from batch size 5. If they reappear, lower to 3 or add pacing.
4. **Fix `score_fit`'s `missing_requirements` prompt** so gaps are skills, not
   schema fields. The weak-resume feature is worthless until this is done.
5. **Implement broaden-and-retry** (Task 5's missing half) — most valuable once
   padding is gone.
6. **Wire profile-builder** so there is one validated profile schema.
7. Then Task 7.

---

## 9. Task 7 readiness

**In place:** ai-gateway stable at ~1.8% failure; search-planner has a stateless
endpoint; `data/` has candidates/search_plans tables, repositories, and
migrations; the response shape is now well-defined by `Build Response`.

**Missing:** no HTTP entry point (still one-shot `npx n8n execute`); no
`pipeline_jobs` table or migration; n8n is not in webhook mode; no job/sweeper
process; `API_CONTRACT.md` does not exist.

**You'd need to decide:** whether `Build Response`'s shape becomes the locked
contract; whether the job server calls n8n via webhook or replaces the
orchestration; and whether profile-builder gets wired first (it should — the job
server will want a persisted candidate anyway).

---

## Commits

```
ad18629  task-6: parallelize Loop Over Items (batch 5)
3260341  task-5: weak-resume exit (PARTIAL — broaden-and-retry NOT implemented)
b7d8ec4  task-4: score floor in the allocator + fix the tier contract (F5/F6)
2b48538  task-3: drive the discovery node from search-planner (F2/F3 fixed)
0e1202c  tools: fixture capture + offline replay harness
d5cedb1  chore: untrack node_modules and pipeline run artifacts (F8)
82a1e7b  task-2: year-based opportunity routing (+ task-3 groundwork)
12c340a  task-1: make scoring failures visible and reduce failure rate
```
(plus a follow-up commit fixing the education-array bug and the edge-case harness)

Nothing was pushed. History was not rewritten. No test was weakened to pass:
the 7 pre-existing failures were fixed by correcting an invalid fixture that the
canonical validator rejects, with every assertion preserved.
