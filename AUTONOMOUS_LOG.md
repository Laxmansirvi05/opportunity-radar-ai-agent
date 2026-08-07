# Autonomous Run Log

Started against `CLAUDE_CODE_HANDOFF.md` Tasks 1–6. Stop before Task 7.

Live-run budget: ~12 full pipeline runs. **Used so far: 0 full pipeline runs.**
(Task 1's before/after was measured from an already-captured run plus direct
ai-gateway calls, not full pipeline executions.)

---

## Task 1 — Make scoring failures visible and reduce them — **COMPLETE**

### Changed
- `workflows.json` → **Resume Match Engine**: failure now sets `score: null`,
  `scoring_status: 'failed'`, `scoring_error: <code>` instead of `score: 0`.
- `workflows.json` → **Finalize Results**: ranks only `scoring_status==='scored'`
  items; emits run-level `{attempted, succeeded, failed}` as `scoring_summary`.
- `workflows.json` → **Geographic Allocator**: filters to scored items so a
  failure can never be allocated, backfilled, or counted toward quota.
- `ai-gateway`: provider order → groq first, gemini second; **OpenRouter removed**;
  backoff `100ms*(n+1)` → `300ms*2^n`; default retries 1 → 2.

### Root cause found (not in the handoff)
Gemini's configured model `gemini-3.5-flash` has a **20-request/day** free-tier
quota — confirmed directly against Google's API:
`RESOURCE_EXHAUSTED ... limit: 20, GenerateRequestsPerDayPerProjectPerModel-FreeTier`.
Gemini was first in the chain, so it consumed the first ~20 calls of a run then
failed for the rest of the day. Historical `ai-gateway.log`: gemini 81/95 attempts
failed (85%), groq 10/39 (26%), **openrouter 19/19 (100%)** — confirming the
handoff's "0-for-19".

### Verified with real execution
| Measurement | Before | After |
|---|---|---|
| ai-gateway `score_fit` calls | 20.4% fail (10/49, historical log) | **3.3% fail (1/30, live)** |
| Captured pipeline run, per-item | **52.6% fail (10/19)** | n/a (fixture replay below) |
| Failed scores shown as results | **2 of 10 allocated** | **0** |
| `quota_status` | `degraded` (padded to 10) | `insufficient_data` (9, honest) |

The single post-fix failure was an anomalous `GLOBAL_TIMEOUT` (one call took 363s
against a 120s budget). Not reproduced across the rest of the run; noted, not explained.

### Still open
- A genuine LLM score of **0** exists in the captured run. Correctly retained as
  "scored low" (not a failure). Task 4's score floor should exclude it.
- The 363s timeout overshooting the 120s global budget is unexplained.

---

## Task 2 — Year-based routing — **COMPLETE (unit-verified; not yet in the live pipeline)**

### Changed
- New `search-planner/src/opportunity-type.js`: `deriveOpportunityTarget()`.
  - `endYear >= currentYear+2` → `internship`
  - `endYear` this year or next → `job`, fallback `['internship']`
  - `endYear < currentYear` → `job` only
  - missing/unparseable → careerStage fallback, recorded via
    `source: 'career_stage_fallback'` + `fallbackReason`
  - Uses the **most recent** parseable `endYear`; rejects implausible years
    (<1950 or >currentYear+15); `currentYear` injectable so tests don't rot.
- Threaded as a **new** field `opportunityTarget` — `careerStage` untouched and
  still drives seniority exclusions. Flows through `extractCipComponents` →
  `buildAllQueries` → `planJson.meta` → HTTP response → `computePlanHash`.

### Bug found while probing the live service
`expandTitleForStage` still keyed off `careerStage`, so a final-year student got
`"Frontend Engineer Intern"` titles **alongside** an `"entry level"` keyword —
contradictory queries. Fixed to take `opportunityType`, falling back to
`careerStage` when not supplied. Regression test added.

### Verified (live service, `/search-plan/preview`)
| endYear | careerStage | → type | titleVariants |
|---|---|---|---|
| 2029 | student | `internship` | Frontend Engineer Intern / Internship |
| 2027 | student | **`job`** | Frontend Engineer, Junior…, Entry Level…, New Grad… |
| 2023 | early-career | `job` | same as above |

F3 confirmed fixed: two candidates both `careerStage: "student"` now produce
genuinely different query sets.

### Still open
- **Not reachable from the live pipeline yet** — the workflow still uses the
  inline Code node. Unit- and service-verified only. See Task 3.

---

## Task 3 — Wire the workflow to search-planner — **IN PROGRESS**

### Done: the 7 failing tests (51/58 → 77/77)
Reported per the "explain before changing" rule:

| Test | Asserted | Verdict |
|---|---|---|
| `normalizeTitles: removes senior qualifiers` | unconditional stripping of Senior/Staff | **Test encoded superseded behavior.** Commit 4e6d590 deliberately made stripping stage-aware so a senior candidate's own title survives. Split into two tests covering both branches. |
| `extracts careerStage from meta` | `careerStage === 'student'` | Stale fixture (below). Also **renamed** — careerStage no longer lives in `meta`. |
| `produces non-empty skills list` | `skills.length > 0` | Stale fixture |
| `adjacent roles include inferred trajectory` | `adjacentRoles.length > 0` | Stale fixture |
| `computePlanHash: differs for different career stages` | hashes differ | Stale fixture |
| `buildSearchPlan: returns planId, queryCount…` | `queryCount > 0` | Stale fixture |
| `plan has all required top-level fields` | `queries.length > 0` | Stale fixture |

Six shared **one** root cause: the `VALID_CIP` fixture used pre-v2.0.0 paths
(`meta.careerStage`, `literal.skills`, `literal.workExperience`,
`inferred.careerTrajectory`). Proven, not assumed — the canonical validator
**rejects** it: `literal.experience must be an array`. The canonical schema has
zero references to any of those names. Code was right; fixture was dead.
Replaced with a real v2.0.0 CIP, **every assertion kept**, plus a guard test
asserting the fixture passes the canonical validator so it can't drift back.

**8th issue found:** `handles empty work experience` was passing *vacuously* — it
set `workExperience: []`, a field that doesn't exist in v2.0.0, so it emptied
nothing. Fixed to actually empty `experience` + `careerDirection`.

### Blocker found: Task 3 cannot be done as written
Verified against the code, not assumed:

1. **`/search-plan/build` requires a persisted candidate.**
   `search_plans.candidate_id UUID NOT NULL REFERENCES candidates(id)`. A live
   POST returns `23503 foreign key violation`. The n8n pipeline is stateless and
   never writes a candidate row.
   → **Mitigated:** added stateless `POST /search-plan/preview` (split pure
   `composeSearchPlan` out of persisting `buildSearchPlan`). Verified working.

2. **Query shape mismatch.** The Tavily node reads `$json.query` — a *string*,
   one n8n item per query. search-planner returns one body with `queries[]` of
   structured objects (`roles`, `skills`, `keywords`, `exclusions`) and **no
   query string**. Commit 5ebd6b9's claim is only half true.

3. **Positional coupling.** `Normalize + Classify` calls
   `$("Build Multi-Source Search Plan").all()` **by name** and indexes it
   positionally, requiring `query_id, discovery_type, source_family, priority,
   geography, candidate_city/state/country, target_roles, candidate_skills,
   geography_policy`. search-planner supplies none of these.

4. **Profile schema mismatch.** `Message a model` emits ad-hoc
   `{candidate, career_intelligence, search_profile}`. search-planner requires
   CIP v2.0.0. Resume Match Engine and Geographic Allocator also read the ad-hoc
   `candidate`.

5. **Opposed design goals — the real blocker.** The inline node does
   provider-*specific* discovery: 9 source families (Greenhouse, Lever, LinkedIn,
   Internshala, official/startup careers, international remote), 12 discovery
   types, 45 queries in the captured run. search-planner is deliberately
   provider-*agnostic* and has a **passing test that fails if any provider name
   appears in a plan**. It produced 9 queries for the same candidate class.
   Provider selection was designed to live in `execution-fabric` (adapters for
   greenhouse/lever/ashby/web-render exist there, also unwired).

**Therefore:** "delete the Code node's logic" as literally specified would cut
discovery from 45 provider-targeted queries to ~9 generic ones — a capability
regression, not a cleanup. Also trips the hard-stop rule (rewriting >200 lines
of working code).

### Decision made
**Adapter approach**: call `/search-plan/preview` for the *intelligence* layer
(opportunity type, title variants, exclusions, skills) and let it **drive** the
inline node's provider-specific expansion, replacing that node's hardcoded
"intern" logic (31 case-insensitive occurrences, 0 references to careerStage /
year / graduation — both handoff figures confirmed).

Alternatives considered:
- *Straight swap* — matches the brief literally, but measurably weakens results.
- *Wire execution-fabric too* — architecturally correct, but 1,162 lines of
  unwired, untested code; too large to do unattended.

Chosen because it fixes F2/F3 in the real pipeline with no discovery regression
and is reversible.

---

## Repo hygiene (F8) — **DONE**
1783 of 1974 tracked files were `node_modules`, plus ~360MB of run artifacts.
`pipeline_execution.json` (81MB) is regenerated every run, so leaving it tracked
would put an 81MB blob in every subsequent commit. `git rm --cached` only —
files remain on disk, **history not rewritten**. Tracked files 1974 → 189.

---

## Security finding (not a task)
`workflows.json` contains the ai-gateway API key in cleartext
(`x-api-key` on two nodes). It was already committed before this run, so it is
already in history; my edits preserve it rather than introduce it. **Recommend
rotating that key and moving it to `$env`** — the workflow is tracked in git.
Not changed here because n8n needs a working value and rotating it is your call.

---

## Decisions made on your behalf
1. **Dropped OpenRouter** from the provider chain (0/19 real success). Reversible.
2. **Kept a genuine score of 0** as a valid low score rather than filtering it in
   Task 1 — filtering scores is Task 4's job, and conflating the two is the exact
   bug Task 1 exists to fix.
3. **Added `/search-plan/preview`** rather than making the pipeline write
   candidate rows to Postgres — smaller, reversible, no Data Plane coupling.
4. **Adapter over straight swap** for Task 3 (above).
5. **Untracked `node_modules` + run artifacts** without rewriting history.
