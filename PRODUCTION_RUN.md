# Production Readiness Run

> Paste as your first message to Claude Code. Opus, high reasoning, auto-accept edits.
> Context: `FINAL_REPORT.md`, `API_CONTRACT.md`, `INTEGRATION_GUIDE.md`, `RUNBOOK.md`. **Do not re-audit.**

Goal: make this safe to ship as a feature inside Opportunity Radar. Your last report said "not integration-ready today" and was right. This run closes that.

---

## SPEC CHANGE — read first, it resolves your biggest blocker

**The 5-minimum is dropped.** Returning 3–4 real opportunities is now a *correct* outcome, not a failure — provided the student is told why.

New output tiering:

| Real opportunities found | Response |
|---|---|
| 8–10 | Results only. No warning. |
| 5–7 | Results, plus optional light improvement suggestions |
| 3–4 | Results **plus a clear resume-strength message**: the resume is limiting matches, with specific skills/projects to add |
| 1–2 | Results **plus a strong message**: resume needs significant work before it will match well |
| 0 | No results, plus actionable feedback on what to build first |

Rules:

- **Never pad.** Fewer real results beats more fake ones. This does not change.
- The message must be **specific and constructive**, never discouraging. "Most internships you matched wanted React and a deployed project — add one and your matches should improve" — not "your resume is weak."
- Always attempt to reach 8–10 via broadening first. Short lists are an outcome, never a shortcut.
- Add a `resume_strength` field (`strong` | `moderate` | `needs_work`) and a `resume_feedback` string to the contract. Update `API_CONTRACT.md` and `INTEGRATION_GUIDE.md`.
- The front end will render this. Your job is to return the right data and message.

**This means criterion "always ≥5" is retired.** Replace it with: the tier is always correct for the count, and the message is always specific.

---

## Definition of done

All sixteen must be demonstrably true, with evidence. **If one can't be met, say so plainly. Never redefine a criterion to pass it.**

| # | Criterion | Evidence |
|---|---|---|
| 1 | Result tiering correct at every level | One run per tier: 8–10, 5–7, 3–4, 1–2, 0 |
| 2 | Feedback is specific and constructive | Real messages, quoted, at each short tier |
| 3 | Never pads or fabricates | Every returned item real and applyable |
| 4 | `company` + `description` populated ≥85% | Measured across ≥30 real items |
| 5 | Titles are role titles, not page titles | Same sample |
| 6 | `apply_url` reaches a real posting ≥95% | Sampled and manually confirmed |
| 7 | Geographic targeting works or is honestly disabled | Either resolves, or the field is removed from the contract |
| 8 | Job server live end-to-end | Real PDF → poll → contract-shaped result |
| 9 | 5 varied real resumes complete | All 5, each tier documented |
| 10 | All edge cases documented | Table below, observed behavior for each |
| 11 | Security review clean | §Security, every item addressed |
| 12 | Cost + quota per run measured | Tokens and calls per run, runs/day per tier |
| 13 | Runtime acceptable and measured | Wall-clock, p50 and worst case |
| 14 | All test suites green | Every suite, failures attributed |
| 15 | Clean-machine startup, real pipeline | Fresh clone → working job |
| 16 | Docs current | Contract, integration guide, runbook all match reality |

---

## The rule that overrides everything

**An honest report of what is still broken beats a clean report that isn't true.**

You have been consistently honest across three runs, including reporting 6 of 14 when you could have claimed more. That is why your reports are worth acting on. Keep it up. "13 of 16 met, here's what blocked the rest" is success.

---

## Forbidden — non-negotiable

1. **Never edit, weaken, delete, or skip a test to make it pass.** Report every test file you touch.
2. **Never mark something verified from a stub.** Stub-verified ≠ live-verified.
3. **Never silence an error with try/catch.**
4. **Never fabricate results, metrics, or output.**
5. **Never loosen a threshold to make numbers look better.**
6. **Never pad results.**
7. **Never `git push`, force-push, or rewrite history.**
8. **Never modify applied migrations.**
9. **Never commit secrets.**
10. **Never declare something verified to work around a quota limit.** Mark it unverified.

---

## Budget

Groq free tier is ~2–3 full runs/day. **If quota blocks verification, stop, record exactly what remains unverified, and continue with offline work.** Do not burn the day retrying.

Use the fixture/replay harness for all iteration. State why fixtures couldn't answer a question before spending a live run.

---

## Work order

### Phase 1 — Prove current code still runs (gate)

Nothing since Phase A has executed in n8n. Gate rewrite, broadening, key rotation, `RESUME_INPUT_PATH` — all unexercised. **One live run before anything else.** If it's broken, everything downstream is moot.

### Phase 2 — Result quality (the real product problem)

Your §10 said half of results show no company and no description, and titles are often page titles. A result with no company name is barely usable even when real.

- Diagnose *where* company/description are lost: extraction prompt, HTML cleaning, or the standardize node. Measure before guessing.
- Fix at the source. If the scraped page genuinely lacks the data, decide whether to drop the item or return it flagged — and document the choice.
- Titles must be role titles. Strip site suffixes (`"... | Cutshort"`, `"X is hiring Y"`).
- Target: `company` and `description` populated ≥85% across ≥30 real items.
- `salary` and `deadline` are null 100% of the time. Either make extraction find them when present, or **remove them from the contract** — a field that is always null is worse than no field.

### Phase 3 — Tiering and feedback

- Implement the tier table above.
- Wire `resume_strength` and `resume_feedback` into the contract.
- The feedback must draw on real aggregated `missing_requirements`. If those are still empty after Phase 2, say so — do not emit generic advice dressed up as analysis.
- Verify every tier with a real or replayed run.

### Phase 4 — Security review

Address every item. Report findings even where no change is needed.

- **Prompt injection via resume.** Uploaded PDF text goes straight to an LLM. A resume containing instructions ("ignore previous instructions…") is a live attack path. Add defenses: delimit untrusted text, instruct the model to treat resume content as data only, validate that output conforms to schema regardless of input. **Test with a deliberately malicious resume.**
- **SSRF via scraped URLs.** The pipeline fetches arbitrary URLs from search results with a headless browser. Block private IP ranges, `localhost`, `127.0.0.0/8`, `169.254.169.254`, `.internal`, and non-http(s) schemes **before** fetching. Test each.
- **Upload safety.** Enforce type and size before parsing. Confirm a PDF bomb or malformed PDF cannot hang or crash the parser. Confirm uploaded files land outside any web-served directory.
- **Secrets.** Confirm no key in any tracked file. Old key is dead but in history — state that plainly in the report so the repo is treated as having leaked one.
- **Job IDs** must be unguessable UUIDs. Confirm one student cannot read another's results by guessing.
- **PII.** Resumes contain names, emails, phone numbers. Document what is stored, where, for how long, and whether logs capture resume text. Recommend a retention policy.
- **Rate limiting** on `POST /api/jobs` — one caller must not exhaust the pipeline for everyone.
- **Error messages** must not leak internal paths, provider names, or stack traces to the API caller.

### Phase 5 — Efficiency and cost

Your §9 called free-tier quota a hard commercial blocker. Quantify it so a decision can be made.

- Measure per run: total LLM calls, tokens in/out per provider, wall-clock.
- Report **runs per day** achievable on: free tier, and a typical paid tier.
- Estimate **cost per student** on a paid tier.
- Identify the top 3 token consumers and reduce them where possible without hurting quality.
- Re-examine the `batchSize: 1` limit: what would a Merge node before the loop feedback take, and is it worth it? Recommend, don't necessarily build.
- Recommend a caching strategy for repeated postings across students.

### Phase 6 — Full verification

- 5 varied real resumes: strong technical · moderate · thin · no location · non-CS field.
- Per resume: count returned, tier assigned, feedback text, scoring failure rate, runtime, anything wrong.
- Every edge case below.
- Live end-to-end through the job server, including two concurrent submissions and a mid-run crash.
- Clean-machine startup against the **real** pipeline, not a stub.
- Every test suite green.

### Phase 7 — Ship docs

- Update `API_CONTRACT.md` (tiering, `resume_strength`, `resume_feedback`, any removed fields) with a real example per tier.
- Update `INTEGRATION_GUIDE.md`: how the front end renders each tier, what to show while processing, how to handle every error.
- Update `RUNBOOK.md`: quota limits, what a quota failure looks like, how to recover.
- Write `SECURITY.md`: findings, what was fixed, what remains, PII/retention policy.

---

## Edge cases — observed behavior for each

**Resumes:** scanned/image-only PDF · empty PDF · non-PDF with `.pdf` extension · 5+ pages · no education section · multiple degrees · no location · zero technical skills · non-English · non-student · **resume containing prompt-injection text**

**Pipeline:** Tavily zero results · Tavily only junk · every scrape fails · all scoring fails · 0 qualify · >10 qualify · all one geography · duplicates across sources · provider quota exhausted mid-run

**Job server:** oversized · wrong type · missing file · unknown `job_id` · malformed `job_id` · concurrent submissions · crash mid-run · DB unreachable · **guessing another job's ID**

---

## Decisions

Don't block. Choose the option most consistent with the spec, prefer reversible over clever, log under **Decisions Made** with alternatives, continue.

## Hard stops

- A change requires deleting >200 lines of working tested code
- A spec rule is wrong or self-contradictory
- Quota makes verification impossible — record and continue offline
- 5-iteration cap hit on 3+ separate failures
- An action would be irreversible without git

---

## Final report

Update `FINAL_REPORT.md`:

1. **The sixteen criteria** — met / not met, evidence each
2. **Live-verified / stub-verified / replay-only / untested** — four lists, no blurring
3. Per-resume results, all 5, with tier and feedback text
4. Quality metrics: company/description fill rate, title quality, apply_url validity
5. **Security findings** — each item, status, what remains
6. **Cost and quota** — per run, runs/day free vs paid, cost per student
7. Runtime, p50 and worst case
8. Edge case table
9. **Still broken** — everything. Do not shorten.
10. Decisions made on my behalf
11. Every test file modified and why
12. **Production readiness statement** — can this ship inside Opportunity Radar today, yes or no, and precisely what's missing if no
13. Limitations a student would actually hit

Then stop.

**If you finish early:** no new features, no refactoring for elegance. More resumes, more edge cases, a more honest report.
