# DeepInterview — Fit Evaluation

> Clone https://github.com/ngoanpv/DeepInterview, open it in Claude Code, paste this.
> **This run is evaluation only. Do not modify the codebase.** The output is a report.

---

## Context — what this has to fit into

I run **Opportunity Radar**, a platform for Indian engineering students. I already have a working AI agent that:

- Takes a student's resume PDF (no other input)
- Searches the live internet and returns 1–10 real internship opportunities
- Each with: `company`, `title`, `description`, `location`, `apply_url`, `fit_score` (0–100), `fit_reasoning`, `tier`
- Also returns `resume_strength` (`strong` | `moderate` | `needs_work`) and `resume_feedback`
- Runs as an async job server: `POST /api/jobs` (upload PDF) → `GET /api/jobs/:job_id` (poll)
- Stack: Node.js, n8n orchestration, Postgres, Express microservices

**The feature I want to add:** a student picks one matched internship and does a voice mock interview *for that specific role*, then gets scored feedback.

**Key synergy to evaluate:** DeepInterview needs a CV + a job description. I already have both — the resume they uploaded, and the `description` of the opportunity they selected. Assess how cleanly my existing output maps to DeepInterview's expected input.

**My users:** Indian engineering students, 2nd–4th year. Mostly English, Indian accents, variable audio quality, often on mobile, often on unreliable networks.

---

## Your task

Clone, run, read the code, and answer honestly. **Do not fix anything.** If something is broken, document it — that's the point of this exercise.

Start by actually running it — the README says `docker compose up` brings the base stack up healthy with **zero API keys** on mock adapters. Verify that claim first. Everything else is cheaper to judge once you've seen it run.

---

## Questions to answer with evidence

Cite file paths and line numbers. If you can't find evidence, say "no evidence found" — do not guess.

### A. Does it actually work?

1. Does `docker compose up` really come up healthy with zero keys? What exactly starts, on what ports?
2. Run the offline path (`pnpm install && pnpm build && pnpm test`). What passes, what fails?
3. Run the Python agent tests (`uv --directory apps/agent run pytest`). Results?
4. Can you complete a full mock interview loop on mock adapters end to end? Describe what actually happens.
5. What genuinely requires paid API keys and cannot be evaluated without them?

### B. Fit with my system

6. What exactly does it need as input for CV and JD? Show the schema/contract.
7. **Map my opportunity output to its JD input.** Does `company` + `title` + `description` suffice, or does it expect structured requirements/responsibilities I don't have? Be specific about what's missing.
8. Can a session be started programmatically via API — passing CV text and JD directly — or does it require going through its own upload UI?
9. Its CV parsing uses markitdown + Gemini fallback. **I already parse resumes into a structured profile.** Can I pass my parsed output instead and skip its parsing? Where would that plug in?
10. What is the API surface between `apps/web` and `apps/agent`? Is it documented and stable enough to build my own UI against?
11. Does it assume Supabase? The README says auth/billing is hosted-only — verify the self-host path truly has no Supabase dependency.

### C. Architecture and code quality

12. Read `docs/ARCHITECTURE.md`, then verify it against the code. Where do they disagree?
13. Map the actual data flow: CV upload → prep → live interview → scoring → report. Name every service and agent.
14. How is the `InterviewContext` blackboard passed between prep/live/post? Where does it live — memory, DB, file?
15. Is the provider adapter pattern real and clean, or leaky? Could I swap in a different LLM without touching multiple files?
16. Assess code quality honestly: test coverage, error handling, obvious debt, TODO/FIXME density.
17. What's the LangGraph pipeline actually doing in prep? Is it necessary complexity or over-engineering for my use case?

### D. Robustness — my users will break this

18. What happens on: student with a strong Indian accent · noisy background · network drop mid-interview · student silent for 30s · student talks over the interviewer constantly · very short answers · student speaks Hindi mid-sentence?
19. Is there transcript checkpointing? The README claims a killed process loses seconds, not everything. Verify.
20. What happens if the LLM/STT/TTS provider rate-limits or fails **mid-interview**? Does it degrade or die?
21. Mobile browser support — does the LiveKit WebRTC path work on Android Chrome and iOS Safari? Any evidence either way?
22. What's the minimum viable network for a usable interview? Any adaptive bitrate or fallback?

### E. Cost — I am already quota-constrained

23. Trace exactly which paid calls a single 15-minute interview makes: STT minutes, LLM tokens (prep + live + scoring), TTS characters.
24. **Estimate cost per interview** at current public pricing for the default stack (Deepgram nova-3 + Gemini + Cartesia). Show your working.
25. Which stage dominates cost, and what's the cheapest viable configuration that keeps quality acceptable?
26. Are there free-tier or self-hosted options for any stage (faster-whisper for STT, XTTS for TTS)? The README calls these "planned" — verify whether they exist yet.
27. Is LiveKit self-hostable, or does it require LiveKit Cloud? What does that cost?

### F. Security and privacy

28. Student resumes are PII — names, emails, phone numbers. What is stored, where, for how long?
29. Are interview audio recordings or transcripts persisted? Where?
30. **Prompt injection:** CV and JD text goes into LLM prompts. Is untrusted input delimited or sanitized?
31. Is there authorization on session results, or can any session ID be read by anyone?
32. Read `SECURITY.md` and assess whether it matches the code.

### G. Maintenance reality

33. Commit frequency, contributor count, open issue count and age, maintainer responsiveness.
34. How much of the README is shipped vs. "in progress"? It marks these — verify a sample of the shipped claims.
35. If I fork and modify UI, how painful will upstream merges be? Which directories would I touch, and how often do those change?
36. Is there a clean seam where I could keep my changes isolated from theirs?

---

## Output

Write `DEEPINTERVIEW_FIT.md` with:

1. **Verdict** — 5 sentences. Is this a good fit for my project, yes or no, and why?
2. **What actually works** — verified by running it
3. **What's broken or incomplete** — with severity
4. **Fit gaps** — where my system's data doesn't match what it expects, and what bridging each would take
5. **Recommended integration path** — with the specific seam to build against
6. **Cost per interview** — with working shown
7. **Robustness risks** for Indian students on mobile networks
8. **Security and privacy findings**
9. **Maintenance assessment** — fork vs. run-as-service, with a recommendation
10. **Effort estimate** — to a working integrated feature, and to production
11. **What I'd need to decide** before starting

---

## Rules

- **Do not modify the codebase.** Diagnosis only.
- Evidence over assertion — file path and line for every claim about behavior.
- Run things. "The code looks correct" is not verification.
- If the project is less mature than the README implies, say so directly.
- Do not spend money. Use mock adapters. If a question can only be answered with paid keys, say so and move on.
- Be blunt. I would rather hear "this is a bad fit" now than after three weeks of integration work.
