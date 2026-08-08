# Security — Opportunity Radar internship service

Findings, what was fixed, what remains, and the PII/retention position.

Every control below is exercised by `node tools/verify-security.js` (22 checks,
no LLM calls). Run it after any change to the pipeline or job server.

---

## Threat model in one paragraph

A student uploads a PDF they control. The system extracts its text, sends it to
an LLM, searches the public web, then fetches and renders arbitrary third-party
URLs with a headless browser and sends *those* pages to an LLM too. Two of the
three inputs — the resume and the scraped pages — are attacker-controllable.
The service is internal: Opportunity Radar's backend calls it, never a browser.

---

## 1. Prompt injection — FIXED (live test outstanding)

**Finding.** Resume text was appended raw to the profile prompt with no
delimiting and no instruction to treat it as data. Scraped page text reached
`extract_opportunity` and `score_fit` the same way. A resume containing
*"ignore previous instructions…"* was a live attack path against all three.

**Fixed.** Every prompt now carries an explicit untrusted-input boundary:

- the untrusted region is delimited (`<<<RESUME_BEGIN>>>` / `<<<RESUME_END>>>`)
- it is declared to be **data, not instructions**
- the model is told never to change output format, never to reveal the prompt,
  and never to let injected text invent skills or inflate a score
- text that looks like an instruction is explicitly reframed as ordinary content

**Defence in depth.** Even if a model were persuaded, the output is schema-
validated: `parseAndValidate` rejects anything that is not the exact expected
JSON shape, and the workflow's own guards (score floor, apply-URL requirement,
aggregator filter) are enforced in code the model cannot reach.

**Outstanding.** A live end-to-end test with a deliberately malicious resume
has **not** been run. The defence is implemented and unit-covered; it is not yet
empirically proven against a real model. Treat as mitigated, not verified.

---

## 2. SSRF — VERIFIED

The pipeline fetches URLs discovered by web search, so the target set is
attacker-influenceable. `render-service` blocks private and reserved
destinations before fetching, and re-checks the **resolved address** after DNS
resolution, which closes the DNS-rebinding/TOCTOU gap that a hostname-only check
leaves open.

Verified empirically against the running service — all rejected:

| Target | Result |
|---|---|
| `http://localhost:22/` | blocked |
| `http://127.0.0.1:5432/` | blocked |
| `http://0.0.0.0/` | blocked |
| `http://10.0.0.1/`, `http://192.168.1.1/`, `http://172.16.0.1/` | blocked |
| `http://169.254.169.254/latest/meta-data/` (cloud metadata) | blocked |
| `http://[::1]/` | blocked |
| `file:///etc/passwd`, `gopher://`, `data:` | blocked |

Unauthenticated `POST /fetch` returns 401.

---

## 3. Upload safety — VERIFIED

| Control | Behaviour |
|---|---|
| Type | Validated by **magic bytes** (`%PDF-`), not by extension. A `.docx` renamed `.pdf` is rejected with 415 |
| Size | 5 MB cap enforced **while streaming**, before parsing or buffering |
| Malformed PDF | Neither hangs nor crashes the server; the HTTP layer stays responsive |
| Location | Uploads land in `UPLOAD_DIR` (default `/tmp/opportunity-radar-uploads`), outside any web-served path. The job server serves no static files |

---

## 4. Job IDs and access control — VERIFIED

Job IDs are `gen_random_uuid()` v4 UUIDs, never sequential. Guessing returns
404 with no body — verified against sequential guesses, `null`, and a path
traversal attempt.

**Limitation, stated plainly: there is no per-user authorization.** Anyone who
holds a valid `job_id` can read that job's result. Unguessability is the only
control. That is acceptable for an internal service behind Opportunity Radar's
backend — **it is not acceptable if this is ever exposed directly to browsers.**
If that changes, add an ownership check.

---

## 5. Secrets — FIXED, with a permanent caveat

- All four workflow nodes read keys from `$env` rather than literals.
- Each service gets **its own** key: `GATEWAY_API_KEY` for ai-gateway,
  `RENDER_SERVICE_API_KEY` for render-service. (These were once the same
  hardcoded literal; conflating them silently broke every render with 401.)
- The gateway key value was rotated.
- A tracked-file scan for OpenRouter/Groq/Tavily/retired-gateway key patterns
  is part of the security harness and runs clean.
- `.env` files are gitignored and untracked.

**Caveat that cannot be fixed here.** The retired gateway key is present in git
**history**. Removing it requires a history rewrite, which is out of scope.
**Treat this repository as having leaked a credential.** The leaked key is dead,
but anyone with clone access has seen a real secret — assume the same discipline
applies to anything else ever committed.

---

## 6. Rate limiting — ADDED

`POST /api/jobs` is limited per client IP: **10 submissions/hour** by default
(`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`), returning 429 with `Retry-After`.

This matters more than usual here: the pipeline runs **one job at a time**, so a
single caller submitting in a loop can starve every other student.

`GET /api/jobs/:id` is deliberately **not** limited — callers are told to poll
every 15 seconds and must not be punished for complying.

The limiter is in-memory and single-instance. If the service is ever scaled
horizontally this becomes per-instance and needs a shared store.

---

## 7. Error hygiene — VERIFIED

No API response leaks filesystem paths, `node_modules`, stack traces, or
provider names. ai-gateway deliberately collapses all provider failures to
`PROVIDERS_UNAVAILABLE`, so a caller cannot learn which upstream is failing.

Verified against malformed IDs, non-multipart posts, and unknown routes.

---

## 8. PII and retention

### What is collected

Resumes contain names, email addresses, phone numbers, education and work
history. This is personal data and should be treated as such.

### What is stored, where, and for how long

| Data | Location | Retention |
|---|---|---|
| Resume PDF | `UPLOAD_DIR` on disk | **Deleted when the job reaches a terminal state** (success or failure). An interval sweep removes anything orphaned by a crash after `UPLOAD_RETENTION_MS` (default 24h) |
| Resume filename, byte size | `pipeline_jobs` row | Indefinite |
| Result payload | `pipeline_jobs.result` | Indefinite |
| Resume **text** | nowhere persistent | Passed in memory to the LLM provider only |
| Candidate name, email, phone | **not** in the result payload | — |

Verified: the result payload contains no email addresses and no candidate name,
and no resume text reaches the logs.

### What leaves the system

Resume text is sent to whichever LLM provider serves the request — Groq,
Google (Gemini), or OpenRouter. **Students should be told their resume is
processed by third-party AI providers.** That disclosure is Opportunity Radar's
to make; this service cannot make it.

### Recommended retention policy

Not yet implemented — this is a recommendation, not a control in place:

1. **Delete `pipeline_jobs` rows after 30 days.** The result is only useful
   while the student is looking at it, and the row currently persists forever.
2. **Do not store the resume filename** beyond the run. It frequently contains
   the student's full name (`aarav_sharma_resume.pdf`).
3. Add a documented deletion path so a student can have their data removed.
4. If the DB is ever backed up, ensure the backups inherit the same retention.

---

## 9. What remains

| Item | Status |
|---|---|
| Malicious-resume live test | **Not run.** Injection defence is implemented and unit-covered but not empirically proven |
| Retired key in git history | **Cannot be fixed** without a rewrite. Repo must be treated as having leaked |
| Per-user authorization on job results | **Absent by design.** Unguessable IDs only — unsafe if ever browser-facing |
| `pipeline_jobs` retention | **Unbounded.** Rows and results persist forever |
| Resume filename in DB | Often contains a real name; retained indefinitely |
| Rate limiter across instances | In-memory only; per-instance if scaled |
| Third-party AI disclosure to students | Not this service's to make, but required |
