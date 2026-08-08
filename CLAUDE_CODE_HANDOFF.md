# Handoff Brief — Opportunity Radar AI Job Search Agent

> Paste this into Claude Code as your first message, or say: "Read CLAUDE_CODE_HANDOFF.md and start Task 1."
> Findings below were verified by reading the actual code. **Do NOT re-audit.** That work is done twice already.

---

## 1. Product aim (the spec — judge all code against this)

A student uploads **only a resume PDF**. No job description, no keywords, no location field, no filters. From that single input the system returns **5–10 real, currently-open opportunities** with working apply links, each with company, role, description, location, salary (if stated), work mode/hours (if stated), a fit score, why it matched, and a direct apply URL.

Hard rules:

1. **Resume is the only input.** Any path requiring the user to supply a role, keyword, or location is a design violation.
2. **5 minimum, 10 maximum. Never pad.** Geographic skew target ~7 same-state / 1–2 same-country / 1–2 international, but counted honestly — fewer is better than padded.
3. **Weak-resume path.** If fewer than 5 qualify after broadening, return an honest short list plus specific, actionable gaps.
4. **Internships only.** The product serves current students seeking internships. Every candidate receives internship results; there is no job/full-time path. The education `endYear` is still extracted, but only as a **guard**: it classifies the candidate as `student` / `graduated` / `unknown` and records that in the output so a non-student can be surfaced honestly rather than silently treated as a student. It no longer selects between opportunity types. *(Scope change, 2026-08-07 — supersedes the earlier year-routing rule.)*
5. **Every apply URL points to a specific live posting** — not a search page, careers homepage, or aggregator listing.
6. **No hallucinated fields.** Salary, hours, deadline, location must be `null` when not explicitly stated. A wrong salary shown to a student is a trust violation.
7. **End goal:** an internal service the Opportunity Radar backend calls. Service-to-service, no public CORS.

---

## 2. Architecture as it actually runs

```
PDF → Extract text → ai-gateway (build profile / CIP)
    → [inline n8n Code node] build search plan     ← should be search-planner:4200
    → Tavily search → normalize → quality gate + dedup
    → Loop (SEQUENTIAL) → direct GET, fallback render-service:3100 (Playwright)
    → clean HTML → ai-gateway extract → standardize
    → ai-gateway score-fit → Finalize → Geographic Allocator
    → pipeline_execution.json
```

Orchestration: `run_pipeline.sh` boots four services and runs n8n one-shot via `npx n8n execute`. No HTTP entry point. Full run ≈ 5–8 minutes.

| Service | Port | Called by workflow? |
|---|---|---|
| ai-gateway | 4000 | Yes |
| render-service | 3000 | Yes |
| **profile-builder** | **4100** | **No — bypassed** |
| **search-planner** | **4200** | **No — bypassed** |

---

## 3. Verified findings — take as given

### F1 — search-planner and execution-fabric are NOT stubs

A prior handoff doc claims both were "intentionally left as stubs, logic folded into n8n." **That is false.**

```
search-planner/src     1,060 lines
search-planner/test      547 lines   (58 tests: 51 pass, 7 fail)
execution-fabric/src   1,162 lines
```

Commits from 2026-08-02 show active, targeted development:

```
5ebd6b9  feat(search-planner): include full query list in response for n8n consumption
4e6d590  fix(search-planner): make title expansion and exclusions stage-aware
a3cf79a  fix(search-planner): correct extractCipComponents field paths to match CIP v2.0.0
```

This was an unfinished wiring job, not an architectural decision. Do not maintain the inline Code node as the real implementation.

### F2 — The inline Code node contradicts search-planner

The n8n node **"Build Multi-Source Search Plan"** (~18,000 chars) hardcodes `"Intern"` **31 times** and has **zero** references to `careerStage`, `year`, or `graduation`. Meanwhile `search-planner/src/query-builder.js` already routes correctly:

```js
const stageKeyword = careerStage === 'student'      ? 'internship'
                   : careerStage === 'early-career' ? 'entry level'
                   : ...
```

This is why every candidate gets internship results regardless of seniority.

### F3 — `careerStage` granularity gap (NOW MOOT — internships only)

`careerStage` (`ai-gateway/src/tasks/build-profile.js:70`) allows only:

```
"student" | "early-career" | "mid-career" | "senior" | "transitioning"
```

A 2nd-year and a final-year student are **both** `"student"`, and `student → internship`. **So even after wiring search-planner in, final-year students still get internships.**

The data needed already exists: `build-profile.js:57` extracts `literal.education[].endYear`.

> **Moot as of the 2026-08-07 scope change.** The granularity gap described below
> only mattered because `careerStage` had to choose between internships and jobs.
> The product is now internships-only, so a 2nd-year and a final-year student
> being both `"student"` no longer causes a wrong routing decision — both
> correctly receive internships. The `endYear` extraction built for this is
> retained as a student-status guard (see product rule 4), and `careerStage`
> still drives seniority-qualifier stripping. Nothing here needs fixing.

### F4 — 30–58% of scoring calls fail per run, and it poisons everything downstream

Known and documented, but filed as "monitor later." It is the top priority, because:

- **It corrupts weak-resume feedback.** That feature aggregates `missing_requirements` across scored items. If half the scoring failed to rate limits, you aggregate over a randomly mutilated subset — a strong candidate gets told their resume is weak because a provider throttled you. False, discouraging feedback to a student is worse than none.
- **It corrupts the honest count.** "Only 4 good matches exist" and "9 existed but 5 failed to score" are completely different situations that currently look identical in the output.
- OpenRouter has gone 0-for-19 on a real run even with a fresh key.

### F5 — Allocator backfill is half-right

```js
pull('same_state', 7, 'same_state');
pull('same_country', 2, 'same_country');
pull('international', 1, 'international');
const needed = () => 10 - allocated.length;
if (needed() > 0) pull('same_country', needed(), 'backfilled');
if (needed() > 0) pull('international', needed(), 'backfilled');
if (needed() > 0) pull('unresolved_location', needed(), 'backfilled');
```

It pulls **real scored opportunities** from wider buckets — that widening is correct and desirable. The actual bug is narrower: **no minimum score floor**, so a score-8 item gets pulled in to hit 10. Fix the floor, keep the widening.

### F6 — The locked API contract is already violated

`API_CONTRACT` declares `"tier": "same_state | same_country | international"`, but the allocator emits a fourth value, `"backfilled"`. Opportunity Radar's frontend will hit an unhandled tier on the first real run. Either add it to the contract or stop using it as a tier.

### F7 — Runtime

5–8 min, dominated by up to 60 pages scraped and LLM-processed **sequentially** in `Loop Over Items`. The loop is embarrassingly parallel.

### F8 — Repo hygiene

`final_n8n_run.txt` (180M), `n8n_output.json` (89M), `pipeline_execution.json` (81M) are **tracked in git**. Untrack and gitignore. Do not rewrite history.

### F9 — Tested against exactly one resume

Nothing here is proven to generalize.

---

## 4. Tasks, in priority order

**One task at a time. Stop and report after each. Do not chain them.**

### Task 1 — Make scoring failures visible and reduce them

Everything downstream depends on trusting the score set.

- Distinguish **"scored low"** from **"failed to score"** in every output path. A failed score must never be treated as a low score, silently dropped, or counted toward the honest total.
- Add per-item scoring status to the output and a run-level summary (attempted / succeeded / failed).
- Reduce the failure rate: retry with backoff, reorder providers by observed reliability, and consider dropping OpenRouter from the chain given its 0-for-19 record.
- Report the before/after failure rate on a real run. This is the acceptance criterion.

### Task 2 — Year-based routing

Blocks Task 3 — wiring search-planner without this just relocates the bug.

- Derive an opportunity-type target from `literal.education[].endYear` vs the current year:
  - `endYear` ≥ 2 years in the future → `internship`
  - `endYear` is this year or next → `job`, internships as fallback
  - `endYear` in the past → `job` only
  - missing/unparseable → fall back to `careerStage`, and record that the fallback fired
- Use the **most recent** education entry when there are several.
- Thread this as a **new field** through search-planner — do not overload `careerStage`, it has other legitimate uses.
- Unit-test all five branches.

### Task 3 — Wire the workflow to search-planner

- Fix the 7 failing tests first. **Report what each asserted before changing it.** If a test fails because it encodes wrong behavior, say so rather than editing it green.
- Verify search-planner's response shape against what the Tavily node expects. Commit 5ebd6b9 claims it was shaped for this — confirm, don't assume.
- Replace the inline Code node with an HTTP call to `localhost:4200/search-plan/build`.
- Delete the Code node's logic once the replacement runs clean. Do not leave it dormant.
- Decide the same question for `profile-builder:4100`: wire it in or delete it. No third option.

### Task 4 — Score floor in the allocator + fix the tier contract

- Add a minimum score threshold below which nothing is allocated, including via backfill.
- Keep geographic widening. Exclude junk, not distant-but-good matches.
- Make `quota_status` report the honest count instead of `"full"` after padding.
- Resolve the `"backfilled"` tier mismatch (F6).

### Task 5 — Broaden-and-retry, then weak-resume exit

Removing padding without this converts junk results into *empty* results.

- If the first pass yields fewer than 5 qualifying items, **broaden and search again** before giving up: adjacent roles, wider geography, relaxed seniority. Cap the retries.
- Only after broadening fails should the weak-resume path trigger.
- Weak-resume response returns whatever qualified **plus** specific gaps aggregated from `missing_requirements` — e.g. "5 of 8 relevant roles wanted Docker, which your resume doesn't show."
- **Gate this on Task 1.** Do not generate feedback from a score set with unacknowledged failures.

### Task 6 — Parallelize the loop

- Batch `Loop Over Items` 5–10 wide. Report wall-clock before and after.

### Task 7 — Job server (only after 1–6 verified)

- `POST /api/jobs` accepts a PDF, returns `{ job_id, status: "processing" }` immediately; `GET /api/jobs/:job_id` polls.
- Back it with a `pipeline_jobs` table. Sweep stuck jobs on an **interval**, not only at startup.
- Concurrency limit of 1 is fine. Do not build a distributed queue.
- CORS off by default behind a config flag — the Opportunity Radar backend proxies, never the browser.
- Switch n8n from one-shot `execute` to persistent webhook mode.
- Lock `API_CONTRACT.md` only after Tasks 1–6, with a real example response pasted in.

---

## 5. Working rules

- **One task at a time.** Report, then wait for approval.
- **Do not re-audit.** `PROJECT_AUDIT.md` exists; findings above supersede it and the prior handoff doc wherever they conflict.
- **Verify with three real resumes**: a 2nd-year student, a final-year student, and a graduate. Year routing is unproven until all three return the correct opportunity type.
- **Never edit a test green** without explaining what it asserted and why that assertion was wrong.
- Evidence over assertion — cite file and line for claims about current behavior.
- If something is untested, call it untested. Do not call it working.
- Prefer deleting duplicated logic over maintaining two copies of it.
