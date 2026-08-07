# Completion Run — Take the Agent to Done

> Paste this as your first message to Claude Code. Opus, high reasoning, auto-accept edits.
> Prior context: `CLAUDE_CODE_HANDOFF.md`, `FINAL_REPORT.md`, `AUTONOMOUS_LOG.md`. **Do not re-audit.**

---

## Scope change — read first

**The product is internships only.** Job search and the final-year/graduate routing concept are dropped.

- All candidates receive internship results.
- Keep the `endYear` extraction from Task 2 — do **not** revert it. Demote it from a router to a guard: use it only to detect that a candidate isn't a current student, and record that in the output.
- Stop generating full-time/job queries in search-planner and the discovery node. Don't delete the `careerStage` mapping — it still must handle non-student values sanely.
- Update `CLAUDE_CODE_HANDOFF.md` product rule 4 accordingly, and mark F3's granularity gap as moot.

---

## Definition of done

You are done when **all twelve** of these are demonstrably true, each backed by evidence you can point to. Not when you feel finished.

| # | Criterion | Evidence required |
|---|---|---|
| 1 | Full pipeline runs end-to-end in n8n | Real run, real resume, no crash |
| 2 | Batch-5 loses zero items | Item count in vs. out through the loop |
| 3 | Internship routing correct | 3 different real student resumes |
| 4 | Generalizes across resumes | 5 different real resumes, all complete |
| 5 | Scoring failure rate < 10% | Live run, with counts |
| 6 | Runtime measured before/after | Two wall-clock numbers |
| 7 | Weak-resume feedback returns real skill gaps | Actual output showing usable gaps, not field artifacts |
| 8 | Broaden-and-retry works | A thin resume that yields <5, then ≥5 after broadening |
| 9 | Never pads, never fabricates | Output where count < 10 and every item is real |
| 10 | Every test suite green, or failures explained | All suites run, each failure attributed |
| 11 | `API_CONTRACT.md` locked | Real example response pasted in |
| 12 | Job server works end-to-end | POST a PDF → poll → full result |

**If a criterion cannot be met, say so plainly and explain why. Do not redefine it to pass.**

---

## The rule that overrides everything

**An honest report of what is still broken beats a clean report that isn't true.**

You are unsupervised. Nothing protects this project except your own honesty about what actually works. "10 of 12 criteria met, here's what blocked the other 2" is a success. "All 12 met" backed by weakened tests is a failure that costs me more than doing nothing.

---

## Forbidden — non-negotiable

1. **Never edit, weaken, delete, or skip a test to make it pass.** If a test fails: fix the code, or explain why the test encodes wrong behavior before changing it. **Report every test file you touch, even when justified.** This was missed last run.
2. **Never silence an error with try/catch.** Handle it or let it surface.
3. **Never mark something done without real execution.** "Code looks correct" is not verification.
4. **Never fabricate results, output, or metrics.**
5. **Never loosen a threshold or filter to make numbers look better.** If it returns 3 opportunities, report 3.
6. **Never `git push`, force-push, or rewrite history.** Local commits only.
7. **Never modify applied migrations.** Add new ones.
8. **Never commit secrets.**

---

## Budget

The pipeline calls rate-limited APIs. Reuse the existing fixture/replay harness for all iteration. **Budget ~20 live pipeline runs total.** Before each, state why fixtures couldn't answer the question. On sustained rate-limit errors, stop live calls and switch to fixtures.

---

## Work order

Do these in sequence. Commit after each. Append to `AUTONOMOUS_LOG.md`.

### Phase 1 — Verify what exists (gates everything)

Nothing since the last real run has been proven. Do this before writing new code.

- Full live run, real resume. Confirm it completes.
- **Batch-5 correctness.** Count items entering and leaving the loop. `runOnceForEachItem` inside `splitInBatches` has edge cases around `$('NodeName')` resolution that a sandbox replay won't reproduce. **If items are dropped, set `batchSize` back to 1 and report it — correctness beats speed.**
- Internship routing on 3 real student resumes.
- Scoring failure rate and wall-clock, before and after parallelization.
- **Run every test suite in the repo.** ai-gateway is at 8/11. Attribute each failure as pre-existing or yours. Note `ai-gateway/test-extract.js` is a scratch file making live network calls that `node --test` picks up by filename — deal with it properly.

**Report Phase 1 results before continuing.** If the pipeline is broken, everything downstream is moot.

### Phase 2 — Make weak-resume feedback actually work

Currently returns **zero** usable gaps on real data. `missing_requirements` comes back as extraction artifacts ("job description", "location", "workplace type") — the LLM listing missing *fields*, not missing *skills*.

- Fix at the source: rewrite the `score_fit` prompt so `missing_requirements` returns only concrete candidate-side gaps (skills, tools, experience, qualifications). Never field names, never metadata.
- Add explicit negative examples to the prompt showing what not to emit.
- Verify against real scoring output that gaps are now usable.
- Then aggregate into feedback: "5 of 8 internships wanted Docker, which your resume doesn't show."
- **If prompt work can't produce clean gaps after reasonable effort, say so and stop.** Do not paper over it with filtering — that's what produces zero gaps today.

### Phase 3 — Broaden-and-retry

Padding is gone and nothing replaced it, so thin resumes now return 3–4 results.

- If the first pass yields fewer than 5 qualifying items, broaden and search again: adjacent roles, wider geography, relaxed seniority. Cap retries (2 is fine).
- Only after broadening fails does the weak-resume path trigger.
- This needs a cyclic n8n graph. If that proves unworkable, implement broadening as a second query set in the initial plan instead, and explain the tradeoff.
- Verify with a deliberately thin resume: <5 before, ≥5 after.

### Phase 4 — Lock the contract

- Write `API_CONTRACT.md` with the exact response shape.
- **Resolve the `"backfilled"` tier mismatch** — either add it to the declared values or stop emitting it.
- Include a real example response from a live run, not a synthetic one.
- Document error shapes.

### Phase 5 — Job server

- `POST /api/jobs` — accepts PDF (validate type, max 5MB), returns `{ job_id, status: "processing" }` immediately.
- `GET /api/jobs/:job_id` — poll; returns full result on complete, error details on failure.
- Back with a `pipeline_jobs` table via a **new** migration.
- Sweep stuck jobs on an **interval**, not only at startup.
- Concurrency limit of 1. Do not build a distributed queue.
- CORS **off** by default behind a config flag — Opportunity Radar's backend proxies, never the browser.
- n8n switches from one-shot `execute` to persistent webhook mode. **Commit immediately before this change** — it alters how the whole system boots and is the most likely thing to need reverting.
- Verify end-to-end: POST a real PDF, poll, receive a result matching the contract.

### Phase 6 — Generalization

- Run **5 different real resumes** end-to-end through the job server.
- Vary them: strong, thin, no location, unusual formatting, non-CS field.
- All 5 must complete and return honest results.
- Report each one's outcome.

---

## Edge cases — state observed behavior for each

**Resumes:** scanned/image-only PDF · empty PDF · non-PDF with `.pdf` extension · 5+ pages · no education section · multiple degrees · no location · zero technical skills · non-English · experienced professional (non-student)

**Pipeline:** Tavily returns zero results · Tavily returns only junk · every scrape fails · all scoring fails (must NOT read as "all scored low") · fewer than 5 after broadening · more than 10 qualify · all results one geography · duplicates across sources

**Job server:** oversized file · wrong file type · missing file · unknown `job_id` · two concurrent submissions · pipeline crash mid-run

---

## Decisions

Don't block. Pick the option most consistent with the product rules, prefer reversible over clever, log it under **Decisions Made** with alternatives, continue.

## Hard stops

- A change requires deleting >200 lines of working tested code
- A product rule is wrong or self-contradictory
- Sustained API failures make verification impossible
- 5-iteration cap hit on 3+ separate failures — something systemic is wrong
- An action would be irreversible without git

---

## Final report

Update `FINAL_REPORT.md`:

1. **The twelve criteria** — met / not met, with evidence for each
2. **Verified by real execution** vs **unit-tested only** vs **untested** — three separate lists
3. Scoring failure rate, before and after, with counts
4. Runtime, before and after
5. Edge case table with observed behavior
6. **Still broken** — everything. Do not shorten this section.
7. Decisions made on my behalf
8. Every test file modified and why
9. Recommended next steps

Then stop.

**If you finish early:** do not add features or refactor for elegance. Spend the time on more resumes, more edge cases, and a more honest report.
