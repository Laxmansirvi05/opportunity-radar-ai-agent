# Final Report — Production Readiness Run

> **9 of 16 criteria met. 5 blocked by exhausted quota, 2 genuinely not met.**
>
> Both Tavily and Gemini hit hard limits partway through. Six live runs were
> spent; the last two failed on quota, so everything needing further live
> execution is reported **unverified**, not passed.
>
> **Production readiness: NO.** See §12 — one specific fix is implemented but
> unproven, and that fix is the difference between usable and unusable results.

---

## 1. The sixteen criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Tiering correct at every level | **Met (replay), partial live** | All 5 tiers verified through the real node code; 2 tiers observed live (`good`, `none`) |
| 2 | Feedback specific and constructive | **Met** | Real messages quoted in §3; scoring outages owned, never blamed on the resume |
| 3 | Never pads or fabricates | **Met** | Every returned item has a real `apply_url`; 5/6 resolve HTTP 200 |
| 4 | `company`+`description` ≥85% | **NOT MET** | Root cause found and fixed; **fix unverified live**. Last measured: 0/6 |
| 5 | Titles are role titles | **Met (live)** | `"Frontend Development Intern job in Hyderabad"`, `"Software Engineer Intern"` |
| 6 | `apply_url` real posting ≥95% | **Partial** | 5/6 = 83% returned HTTP 200; the 6th was a listing page, now filtered |
| 7 | Geographic targeting works or disabled | **NOT MET** | Still `false` on every run; documented but neither fixed nor removed |
| 8 | Job server live end-to-end | **NOT MET** | Stub-verified (22 tests). Live attempt swept at 30 min in a prior session |
| 9 | 5 varied resumes | **NOT MET** | 1 resume run repeatedly this session; quota exhausted |
| 10 | Edge cases documented | **Partial** | 18 offline + job-server cases; PDF-input and Tavily-condition cases untested |
| 11 | Security review clean | **Met** | 22/22 checks, `tools/verify-security.js`, `SECURITY.md` |
| 12 | Cost + quota measured | **Met** | ~33 calls / ~68,800 tokens / student; ~1 run/day free |
| 13 | Runtime measured | **Met** | p50 ~525s; worst 1348s |
| 14 | All test suites green | **Met** | 227 tests, 0 failures |
| 15 | Clean-machine startup, real pipeline | **NOT MET** | Fresh clone verified stub-backed only |
| 16 | Docs current | **Met** | Contract, integration guide, runbook, SECURITY all updated |

---

## 2. Four lists

**Live-verified:** full pipeline completes (`rc=0`, 3 runs); the render-service
401 regression and its whole cascade; scoring failure rate 0% (20/20, 27/27);
internship routing; tiering fields present in a real response; clean role
titles; 5/6 apply URLs resolve 200; `skipped_no_content` working (14 attempted →
6 scored, 8 skipped); SSRF blocking; provider limits with exact error bodies.

**Stub-verified:** the entire job server (22 tests) — upload, polling, all error
paths, concurrency limit, crash → `PIPELINE_FAILED`, stuck → `PIPELINE_TIMEOUT`,
interval sweep, rate limiting, PII deletion; clean-machine startup.

**Replay-verified (real node code, captured data, no APIs):** all 5 tiers and
their messages; conditional broadening (fires 11→17 and 5→22, skipped at 22 and
14); gate admits zero listing pages; contract shape; provenance merge recovering
7/8 company+URL pairs; 18 edge cases; 227 unit tests.

**Untested:** the provenance fix live (criterion 4); 5 varied resumes; job
server against the real pipeline; live concurrent submissions; malicious-resume
injection test; scanned/empty/non-English PDFs; Tavily-zero and all-scrapes-fail
conditions; DB-unreachable.

---

## 3. Per-resume results

Only one resume was run this session — quota did not permit five. Honest record
of the six live runs, all with `student-strong-2nd-year.pdf`:

| Run | Result | Tier | Scoring | Wall-clock |
|---|---|---|---|---|
| `prod-p1-gate` | 0 opportunities | `none` | 21/22, 4.5% fail | 1348s |
| `prod-p3-verify` | **6 opportunities** | `good` | 20/20, 0% fail | 525s |
| `prod-p4-quality` | 0 opportunities | `none` | 6 scored, 8 skipped | 802s |
| `prod-p5-final` | crashed at first LLM call | — | — | 383s |
| `prod-p6-confirm` | crashed — Tavily quota | — | — | 106s |

Real feedback text produced at each tier (replay, from real aggregated gaps):

- **good (5–7):** *"Good match rate. To reach even more internships, consider adding Docker, AWS, and TypeScript — these came up in the roles you matched."*
- **limited (3–4):** *"Your resume matched a limited number of internships. Most of the roles you came close to wanted Docker, AWS, and TypeScript — adding one of these, ideally shown through a deployed project, should noticeably improve your matches."*
- **very_limited (1–2):** *"Your resume is currently limiting your matches. The roles you came closest to wanted Docker, AWS, and TypeScript. Building one substantial project that uses them — and describing what you built and deployed — should make a clear difference."*
- **none (0):** *"We could not find internships that match your resume yet. Start by naming the specific technologies you have used and adding one project you have built and deployed."*
- **scoring outage:** *"We could not score 9 of 11 matches because of a temporary problem on our side… this is not a reflection of your resume."*

---

## 4. Quality metrics

| Metric | Measured | Target | Status |
|---|---|---|---|
| `title` populated (returned) | **6/6 (100%)** | — | good |
| Titles are role titles | **live-confirmed clean** | — | met |
| `company` populated (returned) | **0/6** | ≥85% | **not met — fix unverified** |
| `description` populated (returned) | **0/6** | ≥85% | **not met — fix unverified** |
| `apply_url` present | **6/6 (100%)** | — | met |
| `apply_url` resolves | **5/6 (83%)** | ≥95% | partial |

**Why company/description are 0% and what was done.** Traced, not guessed:
`JSON Parse` replaced the item with the LLM's extracted output, discarding the
source URL. The effect was a perfect inversion — items where extraction
*succeeded* (so had company and description) lost their URL and were then
excluded by product rule 5, while the items that survived were exactly those
where extraction had been skipped. Every returned opportunity therefore had
`company: null`.

Fixed in two steps: merge extracted fields onto the item instead of replacing
it, and — because on the extraction branch `$json` is the gateway *response*,
not the item — recover provenance from the guard node by paired item. Replaying
the real captured extraction responses, **7 of 8 now carry both a company and an
apply URL (was 0)**. This has not run live. It is the single highest-value
unverified change in the repo.

---

## 5. Security

22/22 checks pass. Full detail in `SECURITY.md`.

| Item | Status |
|---|---|
| Prompt injection | **Fixed, live test outstanding.** All three prompts now delimit untrusted text and declare it data; schema validation is the backstop |
| SSRF | **Verified.** localhost, 127.0.0.1, 0.0.0.0, 10/8, 192.168/16, 172.16/12, 169.254.169.254, `[::1]`, `file:`/`gopher:`/`data:` all blocked |
| Upload safety | **Verified.** Magic-byte type check, streaming size cap, malformed PDF neither hangs nor crashes, uploads outside any web path |
| Job IDs | **Verified.** v4 UUIDs; guessing returns 404 with no body |
| Secrets | **Fixed.** Per-service keys via `$env`, gateway key rotated, tracked-file scan clean |
| Rate limiting | **Added.** 10 submissions/hour per IP; polling deliberately exempt |
| Error hygiene | **Verified.** No paths, stack traces, or provider names leak |
| PII / retention | **Partly fixed.** Resume PDFs deleted at terminal state + orphan sweep. `pipeline_jobs` rows retained **forever** — policy recommended, not implemented |

**Stated plainly:** the retired gateway key is in git **history** and cannot be
removed without a rewrite. Treat this repo as having leaked a credential. There
is also **no per-user authorization** on job results — unguessable IDs are the
only control, which is fine behind a backend and unsafe if ever browser-facing.

---

## 6. Cost and quota

Measured across four real runs (`tools/measure-cost.js`; token counts are
estimates reconstructed from actual payloads and labelled as such).

| Per student | Value |
|---|---|
| LLM calls | ~33 |
| Tokens | ~68,800 (in ~64,900 / out ~3,850) |
| Tavily searches | ~45 |
| Token split | scoring 54%, extraction 40%, profile 6% |

| Tier | Runs/day |
|---|---|
| Groq free (100k tokens/day) | **~1** |
| Gemini free (20 req/day) | cannot carry one run |
| Tavily free | exhausted after ~6 runs today |

| Model | Cost/student | Per 1,000 |
|---|---|---|
| gemini flash | $0.006 | $6 |
| gpt-4o-mini | $0.012 | $12 |
| groq llama-3.3-70b | $0.041 | $41 |

**Reduction implemented:** 16 of 22 scored items in the gate run had no company,
description, requirements or skills, and 15 of those scored exactly 0 before
being discarded — ~30% of the token budget spent producing zeros. Those are now
skipped as a distinct third outcome (`skipped_no_content`). Confirmed live: 8 of
14 items skipped in `prod-p4-quality`.

**`batchSize: 1` recommendation.** A Merge node before the loop feedback would
let batching work, but the payoff is small: runtime is dominated by sequential
LLM calls that are themselves rate-limited, not by loop overhead. **Not worth
building** until a paid tier removes the token ceiling.

**Caching recommendation.** The same postings recur across students. A
`content_hash → extracted fields` cache keyed on canonical URL would cut the
extraction stage (40% of tokens) substantially. `execution-fabric` already has
a dedup repository that could back it.

---

## 7. Runtime

| Measure | Value |
|---|---|
| p50 | **~525s** (~9 min) |
| Worst successful | **1348s** (~22 min) |
| Fastest successful | 78s (11 opportunities, earlier session) |

Runtime scales with item count and degrades sharply under provider throttling,
not with configuration.

---

## 8. Edge cases

| Case | Observed |
|---|---|
| 2nd-year / final-year / graduated | all → `internship`; year used only as a student-status guard |
| Missing/unparseable `endYear` | careerStage fallback, recorded |
| No education / no location / zero skills | queries still generated (45–60) |
| Multiple degrees | most recent used; graduate flagged |
| Non-student professional | `internship`, flagged not-a-current-student |
| **All scoring fails** | owned as our failure, never "all scored low" |
| Only junk | 0 returned, nothing padded |
| <5 / >10 qualify | correct tier; exactly 10 max |
| All one geography | 10 returned, widening used |
| Aggregator/listing pages | excluded at the gate **and** at allocation |
| Job server: oversized / wrong type / missing / unknown id / malformed id | 413 / 415 / 400 / 404 / 404 |
| Job server: concurrent | both accepted, queued, max concurrency 1 (stub) |
| Job server: crash / stuck | `PIPELINE_FAILED` / `PIPELINE_TIMEOUT` (stuck verified on a real job) |
| Rate limit exceeded | 429 + `Retry-After` |
| PII after job | resume PDF deleted on success and on failure |
| **Prompt-injection resume** | **NOT TESTED** |
| Scanned / empty / fake / long / non-English PDF | **NOT TESTED** |
| Tavily zero / only junk / all scrapes fail | **NOT TESTED** |
| DB unreachable | **NOT TESTED** |

---

## 9. Still broken

1. **The provenance fix is unverified live.** It is the difference between
   results with company/description and results without. Highest priority.
2. **`company`/`description` 0% in the last measured output** (criterion 4).
3. **Geographic targeting does not work.** `geographic_target_met` false on
   every run; most results `unresolved_location`. Neither fixed nor removed from
   the contract — I chose to document rather than delete a field a consumer may
   already read.
4. **`weak_profile.gaps` still empty on real data.** The rewritten prompt got
   exactly one clean live sample before quota died.
5. **Free tier supports ~1 student/day.** Commercial, not engineering.
6. **`salary` and `deadline` null in 100% of observed items.** Left in the
   contract, documented as effectively absent — removing them is a breaking
   change I did not want to make on one session's evidence.
7. **`pipeline_jobs` retention unbounded.**
8. **No per-user authorization on job results.**
9. **Malicious-resume test never run.**
10. **`batchSize` still 1**; no parallelism.
11. **Retired key permanently in git history.**
12. **n8n runs one-shot CLI, not webhook mode.**
13. **`profile-builder` and `execution-fabric` still unwired.**
14. **A 363s call once overshot the 120s global timeout** — never explained.

---

## 10. Decisions made on your behalf

1. **Fixed the render-service 401 before anything else.** The gate run's 0
   results traced to a regression I introduced in the last session's key
   rotation. One bug, whole cascade.
2. **Diagnosed rather than guessed on result quality.** Tracing the funnel found
   an inversion no amount of prompt tuning would have fixed.
3. **Skipped scoring for contentless items** instead of shortening prompts. It
   was measurably 30% of the budget and cost nothing in quality.
4. **Made `skipped_no_content` a third outcome** rather than folding it into
   `failed` — that would have overstated provider problems.
5. **Kept `salary`/`deadline`/`geographic_target_met` in the contract**,
   documented as unreliable, rather than removing fields a consumer may read.
6. **Stopped live runs when Tavily hit its limit** rather than retrying.

---

## 11. Every test file modified, and why

| File | Change | Why |
|---|---|---|
| `tools/verify-task5.js` | 7 results now expects `partial`, not `ok` | **Spec change**, not relaxation: the 5-minimum was retired and 5–7 is now the `good` tier. **Added** a 9-result case asserting `full`/`ok`/no-warning |
| `tools/verify-task6.js` | Accepts `skipped_no_content` as a third outcome | New behaviour from the cost work. **Added** a case proving an item with real content is still attempted, never quietly skipped |
| `tools/verify-security.js` | Secret literal assembled at runtime | The scanner matched its own source. No assertion changed |
| `tools/verify-workflow-config.js` | Same | Same |
| `job-server/test/job-server.test.js` | **+5 tests** | Rate limiting, polling exempt, PII deletion on success and failure, orphan sweep. One initially failed because the job completed synchronously — the deletion was correct, the test's timing was wrong |
| `tools/verify-tiering.js` | **New** | All 5 tiers through real node code |
| `tools/verify-gate-specificity.js` | **New** | Gate admits postings not listing pages; broadening conditional |
| `tools/verify-security.js`, `verify-workflow-config.js`, `measure-cost.js` | **New** | Security, static config guards, cost |

**No test was weakened.** Where an expectation changed it was because the spec
or behaviour changed, and in both cases a stricter companion case was added.

---

## 12. Production readiness

**No — but the gap is now one specific, identified thing rather than a fog.**

What is ready: the contract is stable and documented; security is verified;
tiering works and the messages are genuinely good; cost is quantified; the job
server is thoroughly tested against a stub; all 227 tests pass.

**Blocking:**

1. **Verify the provenance fix live.** One run answers criterion 4. Without it
   the service returns results with no company or description — technically
   real, practically thin.
2. **A paid API tier.** ~1 student/day on free tier is not a product. Everything
   else is downstream of this.
3. **Run 5 varied resumes.** Generalization is asserted, not shown.
4. **Live job-server end-to-end** on current code.

**Not blocking but should precede launch:** the malicious-resume test, a
`pipeline_jobs` retention policy, and a decision on geographic targeting.

Realistically: **one working day with a paid tier** closes 1, 3 and 4.

---

## 13. Limitations a student would actually hit

1. **Often 0–6 internships, sometimes none** — now explained rather than silent.
2. **Results may show no company name or description** — just a title and a link
   (pending the unverified fix).
3. **Never any salary or deadline.**
4. **No actionable skill gaps** in the feedback yet — advice is structural.
5. **5–22 minute wait.**
6. **Location targeting doesn't work** — most results aren't geographically resolved.
7. **On a bad quota day the run fails outright** after several minutes.
8. **One student at a time**; a queued submission can take twice as long.
