# API Contract — Opportunity Radar internship service

**Version:** 1.0.0 · **Status:** locked for Tasks 1–6 · **Last verified:** live run `runD-final`

Service-to-service only. Opportunity Radar's backend calls this; the browser never does.
CORS is off by default (see [Job server](#job-server)).

**The product is internships only.** Every candidate receives internship results.
The education end year is a *guard*, not a router: it classifies student status
and is reported, but does not select an opportunity type.

---

## 1. Pipeline response

The value produced by the `Build Response` node. This is the payload the job
server returns in `GET /api/jobs/:job_id` under `result`.

### 1.1 Top level

| Field | Type | Notes |
|---|---|---|
| `status` | `"ok"` \| `"weak_profile"` | `weak_profile` when fewer than 5 opportunities qualify |
| `opportunity_count` | integer | Length of `opportunities`. Never padded |
| `opportunities` | array | 0–10 items, shape below, ranked by `score` desc |
| `scoring` | object | Run-level scoring outcome |
| `allocation` | object | How the final set was chosen |
| `weak_profile` | object | **Only present when `status` is `weak_profile`** |

### 1.2 `opportunities[]` — exact keys, nothing else

Every key is always present. **Anything not explicitly stated in the source
posting is `null`** — never inferred, never guessed (product rule 6).

| Field | Type | Notes |
|---|---|---|
| `title` | string \| null | |
| `company` | string \| null | |
| `description` | string \| null | |
| `location` | object \| null | `{ city, state, country, display }`, each nullable |
| `apply_url` | string | **Always present and non-null.** A specific posting |
| `employment_type` | string \| null | e.g. `"internship"` |
| `work_mode` | string \| null | e.g. `"onsite"`, `"remote"`, `"hybrid"` |
| `salary` | string \| number \| null | `null` unless stated |
| `is_paid` | boolean \| null | |
| `deadline` | string \| null | `YYYY-MM-DD` |
| `requirements` | string[] | `[]` when unknown |
| `skills` | string[] | `[]` when unknown |
| `score` | integer 0–100 | Always a number. Never `null` |
| `reasoning` | string \| null | Why it matched |
| `missing_requirements` | string[] | Gaps this posting wants |
| `tier` | enum | `same_state` \| `same_country` \| `international` \| `unresolved_location` |
| `allocation_reason` | enum | `quota` \| `widened` |

**Guarantees.** Every returned opportunity: has a non-null `apply_url`; was
successfully scored (`score` is a number); scored at or above `allocation.min_score`;
is not an aggregator, search, or listing page.

#### The `backfilled` tier mismatch — resolved

The allocator previously emitted `"backfilled"` as a fourth `tier` value, which
no consumer expected. **`tier` is now strictly geographic.** The widening signal
moved to the separate `allocation_reason` field:

- `quota` — filled its own geographic quota
- `widened` — pulled from a wider bucket to approach the target of 10

Widening still happens (it surfaces real, well-scored opportunities from wider
geographies); only the mislabelling is gone. `"backfilled"` is never emitted.

### 1.3 `scoring`

| Field | Type | Notes |
|---|---|---|
| `attempted` | integer | Opportunities sent for scoring |
| `succeeded` | integer | Scored successfully |
| `failed` | integer | Provider errors |

A failed score is **never** treated as a low score. Failed items are excluded
from results and from the honest count, and the failure is reported here.

### 1.4 `allocation`

| Field | Type | Notes |
|---|---|---|
| `returned` | integer | Same as `opportunity_count` |
| `target` | integer | Always 10 |
| `quota_status` | enum | `full` (10) \| `partial` (5–9) \| `insufficient` (<5) |
| `scored_candidates` | integer | Successfully-scored items considered |
| `below_score_floor` | integer | Excluded for scoring below `min_score` |
| `excluded_no_apply_url` | integer | Excluded for having no apply URL |
| `excluded_aggregator_page` | integer | Excluded as a search/listing page |
| `min_score` | integer | Currently 50 |
| `geographic_target_met` | boolean | True when ≥7 are `same_state` |
| `scoring` | object | Nested copy of §1.3 |

`quota_status` is never `full` unless 10 genuinely qualifying items were found.

### 1.5 `weak_profile` (present only when `status` is `weak_profile`)

| Field | Type | Notes |
|---|---|---|
| `returned` | integer | What genuinely qualified |
| `minimum_expected` | integer | 5 |
| `reasons` | string[] | Why the list is short, in plain language |
| `gaps` | array | `{ skill, postings_requiring, of_postings_analyzed, message }` |
| `gaps_note` | string | Explains how gaps were derived, or why none are reported |

`reasons` distinguishes causes that look identical in a bare count — e.g.
*"8 of 10 opportunities could not be scored (provider errors)"* versus
*"4 scored below the minimum fit threshold of 50"*.

Gaps are aggregated **only** over successfully-scored postings, and only when a
gap appears in at least 2 of them. See [Known gaps](#3-known-gaps) — this
currently yields zero gaps on real data.

---

## 2. Real example

Verbatim from live run `runD-final` (46 opportunities discovered, 46 scored,
0 scoring failures), replayed through the current response shaper. **No
synthetic data.** Two opportunities shown of four; abbreviated only where marked.

```json
{
  "status": "weak_profile",
  "opportunity_count": 4,
  "opportunities": [
    {
      "title": "Rejolut is hiring Frontend Developer Intern job in Mumbai (Remote friendly) | Cutshort",
      "company": null,
      "description": null,
      "location": { "city": null, "state": null, "country": null, "display": null },
      "apply_url": "https://cutshort.io/job/Frontend-Developer-Intern-Mumbai-Rejolut-Technology-Solutions-Pvt-Ltd--5Dnj741N",
      "employment_type": null,
      "work_mode": null,
      "salary": null,
      "is_paid": false,
      "deadline": null,
      "requirements": [],
      "skills": [],
      "score": 80,
      "reasoning": "The candidate's skills and experience in frontend development, particularly with React, align well with the opportunity for a frontend developer intern, despite the lack of information about the company and specific requirements.",
      "missing_requirements": ["Specific company requirements", "Detailed job description"],
      "tier": "unresolved_location",
      "allocation_reason": "widened"
    }
    /* … 3 more … */
  ],
  "scoring": { "attempted": 46, "succeeded": 46, "failed": 0 },
  "allocation": {
    "returned": 4,
    "target": 10,
    "quota_status": "insufficient",
    "scored_candidates": 20,
    "below_score_floor": 1,
    "excluded_no_apply_url": 6,
    "excluded_aggregator_page": 9,
    "min_score": 50,
    "geographic_target_met": false,
    "scoring": { "attempted": 46, "succeeded": 46, "failed": 0 }
  },
  "weak_profile": {
    "returned": 4,
    "minimum_expected": 5,
    "reasons": ["1 scored below the minimum fit threshold of 50 and were not padded into the results."],
    "gaps": [],
    "gaps_note": "No skill gap appeared in at least 2 of the 20 scored postings, so none is reported as a pattern."
  }
}
```

A `status: "ok"` response is identical minus the `weak_profile` block, with
`opportunity_count` between 5 and 10.

---

## 3. Known gaps

Documented rather than hidden. These are real and current.

1. **The service does not yet meet the 5-minimum.** Enforcing product rule 5
   drops real runs to 1–4 usable opportunities. Measured across five captured
   runs: 0, 1, 1, 4, 4. Broaden-and-retry (Phase 3) is what should close this;
   it is not implemented.
2. **Extraction quality is poor on aggregator-adjacent pages.** In the example
   above `company`, `description`, and every `location` part are `null`, and
   `title` is a page title rather than a role title.
3. **`weak_profile.gaps` is empty on real data.** `missing_requirements` comes
   back as field-level artifacts ("Detailed job description") rather than
   candidate-side skill gaps. Prompt work is staged but unverified.
4. **`geographic_target_met` is false on every run so far** — the ~7 same-state
   target is not being reached.

---

## 4. Job server

### `POST /api/jobs`

`multipart/form-data`, field `resume`, a PDF up to 5 MB.

**202 Accepted**
```json
{ "job_id": "8f14e45f-ceea-467a-9f2b-9c1a63b6a1c2", "status": "processing" }
```

### `GET /api/jobs/:job_id`

| `status` | Meaning |
|---|---|
| `processing` | Still running |
| `complete` | `result` holds the §1 payload |
| `failed` | `error` holds the §5 shape |

```json
{ "job_id": "…", "status": "complete", "created_at": "…", "completed_at": "…", "result": { /* §1 */ } }
```

### Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4300` | |
| `ENABLE_CORS` | `false` | **Off by default.** The backend proxies; the browser never calls directly |
| `CORS_ORIGIN` | – | Required when `ENABLE_CORS=true` |
| `MAX_UPLOAD_BYTES` | `5242880` | 5 MB |
| `JOB_STUCK_AFTER_MS` | `1800000` | 30 min before a running job is swept |
| `SWEEP_INTERVAL_MS` | `60000` | Sweep runs on an interval, not only at startup |

Concurrency is limited to **1** job at a time. Additional submissions are
accepted and queued.

---

## 5. Errors

```json
{ "error": { "code": "FILE_TOO_LARGE", "message": "Resume exceeds the 5MB limit" } }
```

| Code | HTTP | Cause |
|---|---|---|
| `MISSING_FILE` | 400 | No `resume` field |
| `INVALID_FILE_TYPE` | 415 | Not a PDF |
| `FILE_TOO_LARGE` | 413 | Over `MAX_UPLOAD_BYTES` |
| `JOB_NOT_FOUND` | 404 | Unknown `job_id` |
| `PIPELINE_FAILED` | — | In the job's `error`; the run crashed |
| `PIPELINE_TIMEOUT` | — | In the job's `error`; swept as stuck |
| `INTERNAL_ERROR` | 500 | Unexpected |

Error codes are stable; messages are not. Never parse messages.
