# Final Run — Finish the Agent, Make It Integration-Ready

> Paste as your first message to Claude Code. Opus, high reasoning, auto-accept edits.
> Context: `COMPLETION_RUN.md`, `FINAL_REPORT.md`, `AUTONOMOUS_LOG.md`, `API_CONTRACT.md`. **Do not re-audit.**

Current state: ~85%. Pipeline live-verified. Contract locked. Job server stub-verified (15/15). Phase 2 staged but unverified. Broaden-and-retry not built.

This run finishes the agent and makes it safe for another team to integrate against.

---

## Definition of done

All fourteen must be demonstrably true, each with evidence. **If one can't be met, say so plainly. Do not redefine it to pass.**

| # | Criterion | Evidence |
|---|---|---|
| 1 | Broaden-and-retry works | Thin resume: <5 before, ≥5 after |
| 2 | Never pads, never fabricates | Output with count <10, every item real |
| 3 | Weak-resume feedback returns real skill gaps | Live output showing usable gaps |
| 4 | Weak-resume triggers only after broadening fails | Ordered trace |
| 5 | Job server live end-to-end | POST real PDF → poll → contract-shaped result |
| 6 | 5 different real resumes complete | All 5, varied, end-to-end |
| 7 | Internship routing holds across all 5 | Per-resume evidence |
| 8 | Scoring failure rate <10% | Live counts |
| 9 | All test suites green | Every suite, failures attributed |
| 10 | Every edge case has documented behavior | Table below |
| 11 | Concurrent submissions handled | Two at once, both correct |
| 12 | Crash recovery works | Kill mid-run → job marked failed, not stuck |
| 13 | `INTEGRATION_GUIDE.md` written | Another dev can integrate without asking me |
| 14 | Clean-machine startup verified | Fresh env, documented steps, it runs |

---

## The rule that overrides everything

**An honest report of what is still broken beats a clean report that isn't true.**

"12 of 14 met, here's what blocked the other 2" is a success. "All 14 met" backed by weakened tests or stub-only verification is a failure that costs me more than doing nothing. You have been good about this. Keep it up.

---

## Forbidden — non-negotiable

1. **Never edit, weaken, delete, or skip a test to make it pass.** Fix the code, or explain why the test is wrong before changing it. **Report every test file you touch.**
2. **Never mark something verified from a stub.** Stub-verified and live-verified are different words. Use them precisely.
3. **Never silence an error with try/catch.**
4. **Never fabricate results or metrics.**
5. **Never loosen a threshold to make numbers look better.** Returns 3? Report 3.
6. **Never `git push`, force-push, or rewrite history.**
7. **Never modify applied migrations.** Add new ones.
8. **Never commit secrets.**
9. **Never work around a quota limit by declaring something verified.** Mark it unverified and move on.

---

## Budget

Reuse the fixture/replay harness for all iteration. **~25 live runs total.** State why fixtures couldn't answer the question before spending one. On sustained rate limits, stop live calls and continue on fixtures — do not retry in a tight loop.

Note: Groq's limit is tokens/minute (recovers in a minute); Gemini's is 20/day (recovers at reset). Plan accordingly.

---

## Work order

### Phase A — Broaden-and-retry (no quota needed to design)

Padding is gone and nothing replaced it, so thin resumes return 3–4 results.

- If the first pass yields <5 qualifying items, broaden and search again: adjacent roles, wider geography, relaxed seniority. Cap at 2 retries.
- Weak-resume path triggers **only** after broadening fails.
- Last session found the `If` node's branches reconverge into the loop, which is why `batchSize` is 1. **Check whether a cyclic graph hits the same problem.** If it does, implement broadening as a second query set in the initial plan instead, and explain the tradeoff rather than forcing the cycle.
- Verify: deliberately thin resume, <5 before, ≥5 after.

### Phase B — Validate the staged Phase 2

- Run the rewritten `score_fit` prompt against real scoring calls.
- Confirm `missing_requirements` now returns candidate-side skill gaps, not posting-side field artifacts.
- Confirm aggregated feedback is specific and useful: "5 of 8 internships wanted Docker, which your resume doesn't show."
- Confirm the empty case works — a strong resume should produce few or no gaps, and that's correct, not a bug.
- **If the prompt still can't produce clean gaps after reasonable effort, say so and stop.** Do not add filtering. Report it as a known limitation and move on.

### Phase C — Job server, live

- One real PDF through `POST /api/jobs` → poll → full result matching `API_CONTRACT.md` exactly, field by field.
- **Two concurrent submissions.** Confirm both complete correctly and neither corrupts the other. Concurrency limit is 1, so confirm queueing works rather than collision.
- **Crash recovery:** kill the pipeline mid-run. Confirm the job ends up `failed` with a reason, not stuck in `processing` forever. Confirm the interval sweep catches it.
- Every job-server edge case: oversized file, wrong type, missing file, unknown `job_id`, malformed request.

### Phase D — Generalization (5 real resumes)

Vary them deliberately: strong technical · thin/sparse · no location stated · unusual formatting · non-CS field (mechanical, commerce, design).

For each, report: opportunities returned, whether all are internships, scoring failure rate, whether feedback fired and whether it was useful, and anything that looked wrong.

All 5 must complete without crashing. Fewer than 5 results is acceptable if honest — a crash is not.

### Phase E — Integration readiness

This is what makes it safe for another team to build against.

**Write `INTEGRATION_GUIDE.md`** covering:

- How Opportunity Radar's backend calls this: exact request/response, with working `curl` examples
- Expected latency and the recommended polling interval
- Every error case and what the caller should do about each
- What to show a student while a job is processing
- How to handle: fewer than 5 results, zero results, weak-resume feedback present
- Which fields can be `null` and how the UI should render each
- Rate limits and concurrency the caller must respect

**Write `RUNBOOK.md`** covering:

- Every service, its port, and startup order
- All required env vars, what each does, which are optional
- Health-check endpoints and how to tell the system is up
- How to tell if a run failed and where to look
- Common failures and fixes (quota exhausted, render-service down, DB unreachable)

**Fix the operational blockers:**

- **Rotate the gateway API key.** It's cleartext in `workflows.json` and in git history. Move all three nodes to `={{ $env.GATEWAY_API_KEY }}`, matching the Tavily node's existing pattern.
- **Reconcile model config.** `.env` says `gemini-3.5-flash`; `.env.example` and `config.js` default say `gemini-2.5-flash`. Pick one, make all three agree.
- Confirm `.env` is untracked and `.env.example` documents every var.

**Clean-machine check:** from a fresh clone and a fresh env built only from `.env.example` plus `RUNBOOK.md`, bring the system up and run one job end-to-end. If any undocumented step is needed, document it. This is the real test of whether someone else can run this.

---

## Edge cases — state observed behavior for each

**Resumes:** scanned/image-only PDF · empty PDF · non-PDF with `.pdf` extension · 5+ pages · no education section · multiple degrees · no location · zero technical skills · non-English · non-student

**Pipeline:** Tavily returns zero · Tavily returns only junk · every scrape fails · all scoring fails (must NOT read as "all scored low") · <5 after broadening · >10 qualify · all one geography · duplicates across sources

**Job server:** oversized · wrong type · missing file · unknown `job_id` · concurrent submissions · crash mid-run · DB unreachable

---

## Decisions

Don't block. Pick the option most consistent with the product rules, prefer reversible over clever, log under **Decisions Made** with alternatives, continue.

## Hard stops

- A change requires deleting >200 lines of working tested code
- A product rule is wrong or self-contradictory
- Sustained API failures make verification impossible
- 5-iteration cap hit on 3+ separate failures
- An action would be irreversible without git

---

## Final report

Update `FINAL_REPORT.md`:

1. **The fourteen criteria** — met / not met, evidence for each
2. **Live-verified** vs **stub-verified** vs **unit-tested only** vs **untested** — four separate lists, no blurring
3. Per-resume results for all 5
4. Scoring failure rate and runtime, with counts
5. Edge case table with observed behavior
6. **Still broken** — everything. Do not shorten this section.
7. Decisions made on my behalf
8. Every test file modified and why
9. **Integration readiness statement** — can another team build against this today, yes or no, and what's missing if no
10. Known limitations a student might actually hit

Then stop.

**If you finish early:** no new features, no refactoring for elegance. More resumes, more edge cases, a more honest report.
