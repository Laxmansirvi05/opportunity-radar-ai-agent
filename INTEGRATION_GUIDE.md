# Integration Guide — Opportunity Radar internship service

For the team building Opportunity Radar's backend. Everything needed to
integrate without asking us. Field-level detail lives in
[`API_CONTRACT.md`](API_CONTRACT.md); operational detail in
[`RUNBOOK.md`](RUNBOOK.md).

> **Read §7 before you ship.** Result lists are short by design — observed live
> counts range **0–6**, not 8–10. That is a *correct* outcome, and the service
> tells the student why via `result_tier` and `resume_feedback`. Your UI must
> render those two fields; never treat a short list as an error.

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

### Result tiering — the single most important thing to render

**A short list is a correct outcome, not an error.** The service never pads. It
always tries to reach 8–10 by broadening first; when it cannot, it tells the
student why in `resume_feedback`.

| Count | `result_tier` | `status` | `resume_strength` | What to render |
|---|---|---|---|---|
| 8–10 | `full` | `ok` | `strong` | Results only. `resume_feedback` is `null` — show no banner |
| 5–7 | `good` | `partial` | `strong` | Results, plus `resume_feedback` as a light, dismissible tip |
| 3–4 | `limited` | `weak_profile` | `moderate` | Results, plus `resume_feedback` prominently above or beside them |
| 1–2 | `very_limited` | `weak_profile` | `needs_work` | Results, plus `resume_feedback` as the primary message |
| 0 | `none` | `weak_profile` | `needs_work` | No list. `resume_feedback` becomes the whole screen |

**Render `resume_feedback` verbatim.** It is written to be specific and
constructive, and it already reflects whether the shortfall was the resume or
our own scoring failing. Do not substitute your own copy, and do not add
language like "your resume is weak" — the message is deliberately never phrased
that way.

Practical rules:

- **Switch on `result_tier`, not on `opportunity_count`.** The bands may be
  retuned; the tier names will not.
- `status` is a coarse signal for logging. `result_tier` is what the UI should
  branch on.
- **Never treat `weak_profile` as an error state.** It is a successful run with
  a short list. Show the results you got.
- If `resume_feedback` mentions a problem "on our side", offer a retry button.
  That text appears only when scoring genuinely failed, and the student's resume
  is not at fault.

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

| Field | Populated (live, `SHOWCASE-1`) | Render guidance |
|---|---|---|
| `apply_url` | **6/6 — guaranteed** | The primary call to action. Always present |
| `title` | **6/6 (100%)** | Clean role title, site suffixes stripped |
| `company` | **6/6 (100%)** | Show it |
| `description` | **6/6 (100%)** | Show it |
| `score` | **6/6 — guaranteed** | 0–100 |
| `reasoning` | **6/6** | One sentence — good for "why this matched" |
| `location` | object; **83% have a resolved city/state/country** | Hide the block when all parts are null |
| `tier` | **6/6** | `same_state` / `same_country` / `international` / `unresolved_location` |
| `employment_type`, `work_mode` | partial | Hide when null |
| `requirements`, `skills` | often `[]` | Hide empty arrays |
| `is_paid` | present | `false` often means *not stated*, not *unpaid*. Treat with caution |
| `salary`, `deadline` | **rarely populated** | Assume absent. Never show a placeholder — a wrong salary is a trust violation |

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
  "target": 8,
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

Current, measured, and not hypothetical.

1. **Short lists are normal.** Live counts have ranged **0–6**, not 8–10. Build
   for the `limited` and `very_limited` tiers first; treat `full` as the happy
   path. This is by design — the service never pads.
2. **Quota is the hard ceiling.** On free provider tiers the pipeline supports
   roughly **one student per day**. A paid tier costs **$0.006–$0.041 per
   student**. Nothing in the code changes this.
3. **Runtime is 5–20 minutes**, and **one job runs at a time**. This is a
   background job, never a request/response API. A queued submission can take
   twice as long.
4. **`salary` and `deadline` are rarely populated.** Treat as absent.
5. **`weak_profile.gaps` is often empty.** When it is, `resume_feedback` still
   carries useful structural advice — render the message, not the array.
6. **A run can fail outright on provider exhaustion** after several minutes.
   Handle `PIPELINE_FAILED` / `PIPELINE_TIMEOUT` with a retry affordance.
7. **No per-user authorization.** Anyone holding a `job_id` can read that job.
   Unguessable UUIDs are the only control — fine behind your backend, **unsafe
   if you ever expose this to browsers directly**.

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
