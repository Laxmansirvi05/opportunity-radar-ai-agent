# Integration Guide — Opportunity Radar internship service

For the team building Opportunity Radar's backend. Everything needed to
integrate without asking us. Field-level detail lives in
[`API_CONTRACT.md`](API_CONTRACT.md); operational detail in
[`RUNBOOK.md`](RUNBOOK.md).

> **Read §7 before you ship.** The service currently returns **1–4**
> opportunities per resume, not the 5–10 the product describes. That is a real
> limitation, not a temporary blip, and your UI has to handle it.

---

## 1. Shape of the integration

Service-to-service only. **Your backend calls us; the browser never does.**
CORS is off by default and should stay off.

```
student → your frontend → your backend → job-server :4300 → pipeline
```

Two calls: submit a PDF, then poll.

---

## 2. Submitting a resume

```bash
curl -X POST http://localhost:4300/api/jobs \
  -F "resume=@student-resume.pdf"
```

**202 Accepted**

```json
{ "job_id": "72ea77a5-4c33-4b3c-b5fb-6bf994a778df", "status": "processing" }
```

Rules we enforce:

- `multipart/form-data`, one file part. The field name is not checked; the
  first file part wins.
- **PDF only, validated by magic bytes** (`%PDF-`). A `.pdf` extension on a
  text file is rejected — do not rely on your own extension check alone.
- **5 MB maximum** (`MAX_UPLOAD_BYTES`).

Store the `job_id`. It is the only handle to the result.

---

## 3. Polling

```bash
curl http://localhost:4300/api/jobs/72ea77a5-4c33-4b3c-b5fb-6bf994a778df
```

| `status` | Meaning | What you do |
|---|---|---|
| `processing` | queued or running | keep polling |
| `complete` | `result` holds the payload | render it |
| `failed` | `error` holds `{code, message}` | show a retry affordance |

`processing` covers both queued and running — we do not expose queue position.

### Polling interval

**Poll every 15 seconds. Give up at 30 minutes.**

Observed end-to-end runtimes on real runs: **78s, 402s, 484s, 781s**. Runtime
scales with how many pages get scraped and scored, and degrades sharply when
the LLM providers throttle. Anything under 10s of polling interval is wasted
requests.

At 30 minutes our own sweeper marks the job `failed` with `PIPELINE_TIMEOUT`,
so polling longer than that tells you nothing new.

**Concurrency: we run one job at a time.** Additional submissions are accepted
immediately (you still get a `job_id`) and queued. A second job sits in
`processing` until the first finishes, so a queued job can legitimately take
2× the normal time. Do not treat slow as failed before 30 minutes.

---

## 4. The result

Full field list in [`API_CONTRACT.md §1`](API_CONTRACT.md). What matters when
building UI:

```json
{
  "status": "ok",
  "opportunity_count": 7,
  "opportunities": [ /* … */ ],
  "scoring":    { "attempted": 46, "succeeded": 46, "failed": 0 },
  "allocation": { "returned": 7, "quota_status": "partial", "min_score": 50,
                  "below_score_floor": 1, "excluded_no_apply_url": 6,
                  "excluded_aggregator_page": 9, "geographic_target_met": false },
  "discovery":  { "broadening_applied": true, "primary_admitted": 5,
                  "broadened_admitted": 17 }
}
```

### Guarantees you can build on

Every item in `opportunities`:

- has a **non-null `apply_url`** pointing at a specific posting — never a
  search page, listing page, or careers homepage;
- was **successfully scored** (`score` is always a number, never null);
- scored **at or above `allocation.min_score`**.

`opportunity_count` is never padded. If we found 3 real matches, you get 3.

### Fields that are frequently `null` — and how to render them

This is the part that will bite you. `null` means *the posting did not state
it*, and we refuse to invent it. Do not render "Unknown" as if it were data.

| Field | How often populated (real run of 10) | Render guidance |
|---|---|---|
| `title` | 10/10 | Always show. May be a **page title**, not a clean role name — e.g. `"Rejolut is hiring Frontend Developer Intern \| Cutshort"`. Truncate sensibly. |
| `apply_url` | **10/10, guaranteed** | The primary call to action |
| `score` | **10/10, guaranteed** | 0–100 |
| `reasoning` | 10/10 | One sentence, good for "why this matched" |
| `location` | 10/10 object, **but every part can be null** | Hide the block if `city`/`state`/`country` are all null |
| `company` | 5/10 | **Hide the field when null.** Do not print "Unknown company" |
| `description` | 2/10 | Hide when null; the apply link carries the detail |
| `employment_type`, `work_mode` | 5/10 | Hide when null |
| `salary`, `deadline` | **0/10** | Assume absent. Never show a placeholder — a wrong salary is a trust violation |
| `requirements`, `skills` | often `[]` | Hide empty arrays |
| `is_paid` | 10/10 | `false` frequently means *not stated*, not *unpaid*. Treat with caution |

Rule of thumb: **render what is present, omit what is null.** Never
substitute placeholder text for missing data.

---

## 5. Fewer than 5 results, and zero results

When fewer than 5 qualify, `status` is `weak_profile` and a `weak_profile`
block is present. **You still get whatever genuinely qualified** — it is not an
empty list.

```json
"status": "weak_profile",
"opportunity_count": 3,
"weak_profile": {
  "returned": 3,
  "minimum_expected": 5,
  "reasons": [
    "1 scored below the minimum fit threshold of 50 and were not padded into the results.",
    "Search was already broadened before reaching this conclusion (5 strict matches, +17 after relaxing)."
  ],
  "gaps": [],
  "gaps_note": "No skill gap appeared in at least 2 of the 20 scored postings, so none is reported as a pattern."
}
```

### How to present each case

**`status: "ok"`** — normal. Render the list.

**`status: "weak_profile"` with `opportunity_count > 0`** — render the results
you got, plus an honest note. Do not hide the list behind an error state.

**`opportunity_count: 0`** — no usable matches. Offer a retry and, if `gaps` is
non-empty, show them.

**Read `reasons` before blaming the student.** The two situations below look
identical in a bare count and must not be presented the same way:

- `"8 of 10 opportunities could not be scored (provider errors)"` — **our
  fault.** Say something went wrong on our side and offer a retry. Never imply
  the resume was weak.
- `"4 scored below the minimum fit threshold of 50"` — genuinely few matches.

**`gaps` is usually empty today.** See §7. When populated, each entry has a
ready-made `message`:

> "5 of 8 internships wanted Docker, which your resume doesn't show."

`gaps_note` explains *why* it is empty — surface it to yourselves in logs, not
to the student.

---

## 6. Errors

Every error has the same shape:

```json
{ "error": { "code": "FILE_TOO_LARGE", "message": "Resume exceeds the 5242880 byte limit" } }
```

**Switch on `code`. Never parse `message` — messages will change.**

| Code | HTTP | Cause | What to do |
|---|---|---|---|
| `MISSING_FILE` | 400 | no file part, or not multipart | Fix the request; it will never succeed as sent |
| `INVALID_FILE_TYPE` | 415 | not a PDF by magic bytes | Ask for a PDF. Common when a student uploads a `.docx` renamed `.pdf` |
| `FILE_TOO_LARGE` | 413 | over 5 MB | Ask for a smaller file |
| `JOB_NOT_FOUND` | 404 | unknown or malformed `job_id` | Do not retry |
| `INTERNAL_ERROR` | 500 | unexpected | Retry once, then surface a failure |

And on a `failed` job (HTTP 200, inside the body):

| Code | Cause | What to do |
|---|---|---|
| `PIPELINE_FAILED` | the run crashed | Retry is reasonable — many causes are transient |
| `PIPELINE_TIMEOUT` | exceeded 30 min and was swept | Retry, ideally later; usually means providers were throttled |

Client errors (400/413/415) are permanent for that request. Job failures are
usually worth one retry.

---

## 7. Limitations you must design around

Honest list. These are current, measured, and not hypothetical.

1. **The 5-minimum is not met.** Across five real runs the service returned
   **4, 4, 1, 1, 1** usable opportunities. Expect `weak_profile` to be the
   common case, not the exception. Design the UI for 1–4 results first and treat
   5–10 as the happy path.
2. **`weak_profile.gaps` is effectively always empty.** The underlying scoring
   model returns posting-side field names ("job description", "location")
   rather than candidate-side skill gaps, and we filter those out rather than
   show nonsense. A prompt fix is written but **not yet verified**. Do not build
   a feature that depends on gaps being present.
3. **Extraction quality is uneven.** `company` and `description` are null about
   half the time; `title` is sometimes a page title rather than a role name.
4. **`salary` and `deadline` were null on every item we have seen.** Treat them
   as absent.
5. **Geographic targeting does not work yet.** `geographic_target_met` has been
   `false` on every run; most results come back `unresolved_location`. Do not
   build a location filter on `tier` yet.
6. **Runtime is long and variable** (78s–781s). This is a background job, not a
   request/response API. Never block a student on it.
7. **One job at a time.** Under load, queueing dominates latency. If you need
   throughput, that is a scaling change on our side, not a config flag.
8. **n8n runs as a one-shot CLI process**, not webhook mode. Restarting the job
   server mid-run orphans that run; it will be swept to `failed` at 30 minutes.

---

## 8. Checklist before you ship

- [ ] Poll every 15s, stop at 30 min
- [ ] Handle `weak_profile` as a **normal** outcome, not an error
- [ ] Distinguish scoring-failure `reasons` from genuinely-few-matches, and never blame the student for ours
- [ ] Hide every null field rather than showing a placeholder
- [ ] Never display `salary` or `deadline` unless non-null
- [ ] Switch on error `code`, never on `message`
- [ ] Expect 1–4 results as the common case
- [ ] Keep CORS off; call from your backend only
- [ ] Treat `apply_url` as the primary action — it is the one field always present
