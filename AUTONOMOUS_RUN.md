# Autonomous Run Instructions

> Paste this as your first message to Claude Code. Run with Opus, high reasoning, auto-accept edits.

---

## Your mandate

Work through **Tasks 1–6** in `CLAUDE_CODE_HANDOFF.md` autonomously, in order, without asking me for approval between tasks. I am away. Keep working until Tasks 1–6 are genuinely complete or you hit a documented stop condition.

**Stop before Task 7 (job server).** That task changes how the whole system boots and must not run unattended.

Read `CLAUDE_CODE_HANDOFF.md` first. Its findings were verified against the code — treat them as given and **do not re-audit the repo.** Three audits already exist. Re-auditing is the single biggest waste of budget available to you.

---

## The one rule that overrides everything

**An honest report of what is still broken is worth infinitely more to me than a clean report that isn't true.**

You are running unsupervised. Nobody is checking your work in real time. That means the only thing protecting this project is your own honesty about what actually works.

I would rather read "Task 4 is incomplete, the score floor works but broaden-and-retry is unreliable and here's why" than "all tasks complete" backed by tests that were quietly weakened.

---

## Forbidden actions — these are non-negotiable

Violating any of these makes the entire run worthless to me:

1. **Never edit, weaken, delete, or skip a test to make it pass.** If a test fails, either the code is wrong (fix the code) or the test encodes wrong behavior (explain why in the log, then change it). Deleting an assertion to go green is the worst possible outcome.
2. **Never wrap a failing operation in try/catch to silence it.** Handle the error meaningfully or let it surface.
3. **Never mark something complete that you have not verified with real execution.** "The code looks correct" is not verification.
4. **Never fabricate test results, run output, or metrics.** If you didn't run it, say you didn't run it.
5. **Never lower a threshold, loosen a filter, or relax a constraint purely to make numbers look better.** If the pipeline returns 3 opportunities, report 3. Do not tune until it returns 10.
6. **Never `git push`, force-push, rewrite history, or touch `.git` internals.** Local commits only.
7. **Never delete or modify anything in `data/migrations/` that is already applied.** Add new migrations only.
8. **Never commit secrets.** `.env` stays untracked.
9. **Do not start Task 7.**

---

## Budget discipline — read this before you run anything

The pipeline calls paid/rate-limited external APIs (Tavily, Gemini, Groq, OpenRouter). Scoring already fails 30–58% of the time because of throttling. **A naive run-fix-run loop will exhaust quota and make the very problem you're fixing worse.**

So:

- **First thing you build, before any task work: a fixture/replay harness.** Capture one real pipeline run's intermediate outputs to disk (discovery results, scraped HTML, extraction outputs, scoring responses). Then iterate against those fixtures with zero network calls.
- Do the overwhelming majority of your development and testing against fixtures.
- **Budget yourself roughly 12 full live pipeline runs for this entire session.** Spend them on verification, not on iteration.
- Before each live run, state in the log why a fixture run wouldn't have answered the question.
- If you hit sustained rate-limit errors, **stop making live calls**, switch to fixtures, and note it. Do not retry in a tight loop.

---

## Working loop

For each task, in order:

1. **Plan** — write what you're about to change and how you'll prove it works.
2. **Implement.**
3. **Unit test** against fixtures — cover the edge cases listed for that task, plus any you identify.
4. **Verify** — run the relevant slice of the pipeline. Full live run only when the task's acceptance criterion requires it.
5. **If broken** → diagnose root cause, fix, return to step 3. Cap at **5 iterations** on a single failure; if it still fails, record it in the blockers list, leave the code in the best working state you can, and move to the next task. Do not thrash.
6. **Commit** — one commit per task, message `task-N: <what changed>`. This lets me bisect if something is wrong.
7. **Append to `AUTONOMOUS_LOG.md`** — what you did, what you verified, what you decided, what's still open.
8. Next task.

---

## When you need a decision I'd normally make

Do not block waiting for me. Instead:

1. Pick the option most consistent with the product rules in `CLAUDE_CODE_HANDOFF.md` §1.
2. Prefer the reversible choice over the clever one.
3. Log it in `AUTONOMOUS_LOG.md` under **Decisions Made**, with the alternatives and why you chose as you did.
4. Continue.

I'll review these decisions when I'm back. Making a reasonable, documented choice and moving on is correct. Stalling is not.

---

## Hard stop conditions

Stop all work, write the final report, and wait for me if any of these occur:

- A change would require deleting or rewriting more than ~200 lines of working, tested code
- You conclude a product rule in §1 is wrong or self-contradictory
- Sustained API failures make verification impossible even with fixtures
- You've hit the 5-iteration cap on 3 or more separate failures — something systemic is wrong
- Any action would be irreversible without git
- You're about to begin Task 7

---

## Edge cases to cover

Beyond each task's own criteria, the system must behave sanely on all of these. Test them, and state the actual observed behavior for each in the final report:

**Resume inputs**
- Scanned/image-only PDF (no extractable text)
- Empty or near-empty PDF
- Non-PDF file with a `.pdf` extension
- Very long resume (5+ pages)
- Resume with no education section (affects year routing — F3)
- Resume with multiple degrees and overlapping years
- Resume with no location anywhere
- Resume with zero technical skills
- Non-English resume
- Resume of an experienced professional, not a student

**Year routing (the F3 rule) — must verify all branches**
- 2nd-year student → internships
- Final-year student → jobs
- Graduated (past `endYear`) → jobs
- Missing/unparseable `endYear` → documented fallback, and the fallback is recorded as having fired

**Pipeline conditions**
- Tavily returns zero results
- Tavily returns only aggregator/junk pages
- Every scrape fails
- Scoring fails for every item (must NOT be reported as "all scored low")
- Fewer than 5 qualify after broadening → weak-resume path, not an empty list
- More than 10 qualify → exactly 10, best-ranked
- All results in one geographic bucket
- Duplicate postings across different sources

---

## Final report

When Tasks 1–6 are done or you've stopped, write `FINAL_REPORT.md` containing:

1. **Status per task** — Complete / Partial / Not done, with the evidence that proves it
2. **What I verified with real execution** vs. **what is only unit-tested** vs. **what is untested** — three separate lists, no blurring
3. **Scoring failure rate: before and after**, from real runs, with run counts
4. **Runtime: before and after** parallelization
5. **Edge case table** — every case above, with observed behavior
6. **Still broken** — everything that doesn't work, with root cause where known. Do not omit anything to make this section shorter.
7. **Decisions I made on your behalf** — with alternatives considered
8. **Recommended next steps**, ordered
9. **Task 7 readiness** — what's in place, what's missing, what I'd need to decide

Then stop.

---

## Final note

If you finish early, do not invent new features or refactor for elegance. Spend remaining effort on: more edge case coverage, hardening scoring reliability further, and improving the honesty and specificity of the final report.

Completeness of understanding matters more than completeness of checkboxes.
