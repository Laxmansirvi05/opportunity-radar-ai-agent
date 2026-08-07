# Final Report — Opportunity Radar internship agent

> **Headline: 6 of 14 criteria met. Six are blocked by exhausted API quota, two
> are genuinely not met.** All three LLM providers hit hard limits partway
> through this run (Groq daily tokens, Gemini 20/day, OpenRouter), so every
> criterion needing live execution is reported **unverified**, not passed.
>
> **The service is not integration-ready today.** See §9.

---

## 1. The fourteen criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Broaden-and-retry works | **Partial** | Broadening is built and verified at discovery level offline; the `<5 → ≥5` end-to-end proof needs a live run. Not met. |
| 2 | Never pads, never fabricates | **Met** | Enforced and verified across 5 captured runs; counts dropped to 1–4 honestly |
| 3 | Weak-resume returns real gaps | **Not met** | 1 successful live sample was clean; 11/12 calls failed on quota. Unverified. |
| 4 | Weak-resume only after broadening | **Met (offline)** | Ordering enforced in code and surfaced in the response; verified by replay |
| 5 | Job server live end-to-end | **Not met** | Stub-verified only. The one live attempt was swept at 30 min on quota exhaustion |
| 6 | 5 real resumes complete | **Not met** | 3 completed in Phase 1; the remaining 2 blocked on quota |
| 7 | Internship routing across all 5 | **Partial** | 3 of 5 verified live, all correct |
| 8 | Scoring failure rate <10% | **Met** | 0% across 4 live runs (11/11, 28/28, 8/8, 12/12) |
| 9 | All test suites green | **Met** | 222 tests, 0 failures, every prior failure attributed |
| 10 | Every edge case documented | **Partial** | 18 verified offline; PDF-input and Tavily-condition cases untested |
| 11 | Concurrent submissions handled | **Met (stub)** | Max observed concurrency 1, both jobs completed; SQL limit verified against real Postgres |
| 12 | Crash recovery works | **Met** | A real job was swept to `failed`/`PIPELINE_TIMEOUT`. Also exposed and fixed an orphaned-process bug |
| 13 | `INTEGRATION_GUIDE.md` written | **Met** | Written, with a limitations section |
| 14 | Clean-machine startup verified | **Partial** | Fresh clone → schema → job completes, but only stub-backed. Two real blockers found and fixed |

---

## 2. Four separate lists

### 2a. Live-verified (real execution, real APIs)
- Scoring failure rate: **0%** across 4 runs (11/11, 28/28, 8/8, 12/12)
- Internship routing on **3 real student resumes** (2nd-year CS, final-year CS, non-CS mechanical) — all `internship`, 45/45 queries mentioning intern
- Graduation-year extraction after the prompt fix: `null` → `2029` via `education_end_year`
- Loop item conservation at `batchSize: 1`: 11/11, 8/8, 46/46
- **Crash recovery**: a real job swept to `failed` with `PIPELINE_TIMEOUT` at 30 min
- Provider limits, with exact error bodies (Groq TPD/TPM, Gemini 20/day, retired-model 404)
- Postgres job repository including the SQL-enforced concurrency limit

### 2b. Stub-verified (real code, simulated pipeline)
- The entire job server: 17 tests — upload, polling, oversized/wrong-type/missing file, unknown and malformed `job_id`, concurrent submissions, crash → `PIPELINE_FAILED`, stuck → `PIPELINE_TIMEOUT`, interval sweep, CORS
- End-to-end job through real HTTP + real Postgres + real PDF, stubbed pipeline
- Clean-machine startup from a fresh clone

### 2c. Unit-tested / replay-verified only (real node code, captured data, no APIs)
- Broadening: conditional, fires on thin runs only (11→17, 5→22), skipped on healthy ones (22, 14)
- Quality gate now admits **zero** listing pages across 4 captured runs
- Contract shape, `apply_url` presence, tier validity, no internal-field leakage
- Score floor, tier contract, weak-resume exit, scoring-failure visibility
- 18 edge cases
- 222 tests across 5 suites

### 2d. Untested
- **Any live run since the Phase A changes.** The gate rewrite, broadening, key rotation, and `RESUME_INPUT_PATH` change have **never executed in n8n.** This is the single largest gap.
- Criterion 1's `<5 → ≥5` proof
- The rewritten `score_fit` gap prompt (1 sample only)
- The job server against the **real** pipeline
- Resumes 4 and 5 (thin, no-location)
- Scanned/image-only PDF, empty PDF, non-PDF with `.pdf` extension, 5+ pages, non-English
- Tavily returning zero results / only junk; every scrape failing
- DB-unreachable behaviour
- Clean-machine startup against the real pipeline

---

## 3. Per-resume results

Three of five, from Phase 1. Resumes 4 and 5 were generated but never run.

| Resume | Completed | Returned | All internships | Scoring failures | Notes |
|---|---|---|---|---|---|
| Strong CS, 2nd year (grad 2029) | yes | 5, then 10 after fixes | yes, 45/45 queries | 0/11, 0/28 | `graduation_year` was null before the prompt fix |
| Strong CS, final year (grad 2027) | yes | 4 | yes, 45/45 | 0/8 | |
| Non-CS mechanical (grad 2028) | **aborted** | — | yes, 45/45, roles `Mechanical Engineering Intern` | 0/12 | render-service died mid-run; `playwright` had no `onError`. Fixed. |
| Thin/sparse | **not run** | — | — | — | quota |
| No location stated | **not run** | — | — | — | quota |

Counts above **predate** the product-rule-5 enforcement. Replaying those same
runs through the current code gives **4, 4, 1, 1, 1** usable opportunities.

---

## 4. Scoring failure rate and runtime

| Measure | Value |
|---|---|
| Baseline (original captured run) | **52.6%** (10/19) |
| After payload projection, 4 live runs | **0%** (0/59) |
| Runtime, `batchSize: 1` | 78s (11 items), 402s (8), 484s (28), 781s (24, aborted) |
| Runtime, parallelized | **not available** — batching reverted for correctness |

Runtime scales with item count, not configuration. There is no honest
"after parallelization" number because parallelization is not shippable: the
`If` node's branches reconverge into `splitInBatches`, so any batch >1 makes the
done-branch fire repeatedly and emit partial results.

---

## 5. Edge cases

| Case | Observed |
|---|---|
| 2nd-year / final-year / graduated | all → `internship`; year used only as a student-status guard |
| Missing/unparseable `endYear` | falls back to `careerStage`, records `fallbackReason` |
| No education section | `internship` via `career_stage_fallback` |
| Multiple degrees | uses most recent; graduate flagged `studentStatus: graduated` |
| No location | 52 queries still generated; geography `country` + `international_remote` |
| Zero technical skills | 60 queries still generated |
| Non-student professional | `internship`, flagged not-a-current-student, 0 intern-titled roles |
| **All scoring fails** | `weak_profile`, `{attempted:8, succeeded:0, failed:8}`, cause named as provider errors — **not** "all scored low" |
| Only junk (below floor) | 0 returned, `below_score_floor: 12`, nothing padded |
| Fewer than 5 qualify | `weak_profile`, returns what qualified + reasons |
| More than 10 qualify | exactly 10, best-ranked, `quota_status: full` |
| All one geography | 10 returned, all `same_state`, widening used |
| Duplicates across sources | deduped by the gate; one duplicate pair previously survived across tiers |
| Aggregator/listing pages | **now excluded** at the gate and again at allocation |
| Job server: oversized / wrong type / missing / unknown id / malformed id | 413 / 415 / 400 / 404 / 404, all with stable codes |
| Job server: concurrent submissions | both accepted, queued, max concurrency 1 |
| Job server: crash mid-run | `failed` + `PIPELINE_FAILED` |
| Job server: stuck job | swept to `failed` + `PIPELINE_TIMEOUT` (**verified on a real job**) |
| Scanned / empty / fake / long / non-English PDF | **NOT TESTED** |
| Tavily zero results / only junk / all scrapes fail | **NOT TESTED** |
| DB unreachable | **NOT TESTED** |

---

## 6. Still broken

1. **Nothing since Phase A has run live.** Gate rewrite, broadening, key
   rotation, `RESUME_INPUT_PATH` — all unexercised in n8n. Highest risk item.
2. **The 5-minimum is not met.** Replayed against current code, real runs yield
   **4, 4, 1, 1, 1**. Broadening should help but is unproven end-to-end.
3. **Weak-resume gaps are effectively always empty.** The prompt rewrite got
   exactly one clean live sample (`["Azure","ERP systems"]`, zero artifacts)
   before quota died. Promising, not verified.
4. **Extraction quality is poor.** `company` and `description` null ~50% of the
   time; `title` is often a page title. `salary` and `deadline` null in 100% of
   observed items.
5. **Geographic targeting does not work.** `geographic_target_met: false` on
   every run; most results `unresolved_location`.
6. **`batchSize` cannot exceed 1** without a Merge node before the loop feedback.
   No parallelism, so runtime stays 1–13 minutes.
7. **The old gateway key is in git history.** Rotated in config, but history was
   not rewritten (forbidden). Anyone with repo history has the old value — it is
   dead, but treat the repo as having leaked a credential.
8. **n8n runs one-shot CLI, not webhook mode.** Deferred deliberately.
9. **`profile-builder` still not wired.** Kept, not dead.
10. **A 363s call once overshot the 120s global timeout.** Never explained.
11. **`execution-fabric` remains unwired** (1,162 lines).

---

## 7. Decisions made on your behalf

1. **Corrected Phase A's premise.** The brief assumed the constraint was
   discovery breadth. Measured: runs already discover 160–181 specific postings;
   the gate was discarding them while admitting listing pages. Fixed the gate
   first, then built broadening on top.
2. **Broadening as a second admission pass, not a cyclic graph.** A cycle would
   re-enter the already-completed `splitInBatches` — the same mechanism that
   forced `batchSize: 1`. Tradeoff: cannot surface a posting discovery never
   found; it only stops us discarding ones we did find.
3. **Enforced product rule 5 despite counts dropping to 1–4.** Returning listing
   pages as opportunities is fabrication. Alternative (report 10 including junk)
   rejected.
4. **Reconciled on `gemini-flash-latest`, the alias.** A pinned model has been
   retired under us twice.
5. **Untracked `test_output.json`** rather than scrubbing it — it is a captured
   run artifact like the others.
6. **Stopped live calls when all three providers hit hard limits**, rather than
   retrying or declaring anything verified.

---

## 8. Every test file modified, and why

**This run:**

| File | Change | Why |
|---|---|---|
| `job-server/test/pipeline-runner.test.js` | **new** | Proves the process-group kill by spawning a real grandchild — showing it survives a direct-child kill, then that a group kill reclaims it |
| `tools/verify-gate-specificity.js` | **new** | Gate admits postings, not listing pages; broadening is conditional |
| `tools/verify-gap-quality.js` | pacing 1.5s → 11s; key from env | 11/12 calls failed — a pacing bug in the harness, derived from Groq's 12k tokens/min |
| `tools/verify-scoring-payload.js` | key from env | Purging the dead credential |

**Earlier in this session (already reported, repeated for completeness):**
`ai-gateway/package.json` (test glob — `test-extract.js` was making live API
calls on every `npm test`), `execution-fabric/test/{validator,integration,worker}.test.js`
(stale string `location` fixtures, which unmasked a real crash bug),
`profile-builder/test/profile-schema.test.js` (enum gained `unknown`
deliberately), `tools/verify-task{1,4,5}.js` and `verify-edge-cases.js`
(synthetic fixtures lacked apply URLs, so rule 5 correctly excluded them).

**No test was weakened.** Where an expectation changed it was because behaviour
became *stricter*, and in that case (`verify-task5`) I **added** a new
`status: "ok"` case so the branch stayed covered.

---

## 9. Integration readiness

**No — not today.** `INTEGRATION_GUIDE.md` is written and accurate, and the
contract is stable enough to code against. But:

- The service returns **1–4 opportunities**, not the promised 5–10.
- **No configuration currently in the repo has been run live.** Phase A's
  changes are unexercised in n8n.
- Free-tier quota cannot sustain even a handful of runs per day. Groq's 100k
  tokens/day is roughly **2–3 full runs**. This is a hard commercial blocker,
  not an engineering one.

**Minimum to become integration-ready:**
1. One live run on the current code (proves nothing regressed)
2. Paid API tier — everything else is downstream of this
3. Criterion 1 proven live (`<5 → ≥5`)
4. Phase B verified, or gaps removed from the contract

A team *can* start building against `API_CONTRACT.md` now, provided they follow
§7 of the integration guide and design for 1–4 results and empty gaps.

---

## 10. Limitations a student would actually hit

1. **Usually fewer than 5 internships**, often 1.
2. **Half the results show no company name** and no description — just a title and a link.
3. **Never any salary or deadline.**
4. **Some titles are page titles**, e.g. `"Rejolut is hiring Frontend Developer Intern | Cutshort"`.
5. **No actionable feedback** when the list is short — gaps are empty.
6. **5–15 minute wait**, sometimes longer.
7. **Location targeting doesn't work** — most results aren't geographically resolved.
8. **On a bad quota day the run fails outright** after several minutes of waiting.
