# API Contract — Opportunity Radar internship service

**Version:** 2.0.0 · **Status:** locked · **Last verified live:** `SHOWCASE-1-strong`
(6 opportunities · company 100% · description 100% · apply_url 100% · geography 83% resolved · 0 scoring failures)

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
| `status` | `"ok"` \| `"partial"` \| `"weak_profile"` | See the tier table below |
| `result_tier` | `"full"` \| `"good"` \| `"limited"` \| `"very_limited"` \| `"none"` | Which band the count fell in |
| `resume_strength` | `"strong"` \| `"moderate"` \| `"needs_work"` | How much the resume is limiting matches |
| `resume_feedback` | string \| null | Student-facing message. `null` only for a full list |
| `opportunity_count` | integer | Length of `opportunities`. **Never padded** |
| `opportunities` | array | 0–10 items, shape below, ranked by `score` desc |
| `scoring` | object | Run-level scoring outcome |
| `allocation` | object | How the final set was chosen |
| `discovery` | object \| null | Whether search was broadened before concluding |
| `weak_profile` | object | Present whenever the list is short (count < 8) |

### Result tiering

**A short list is a correct outcome, not a failure.** We never pad. The service
always tries to reach 8–10 by broadening first; when it cannot, it says why.

| Real opportunities | `result_tier` | `status` | `resume_strength` | `resume_feedback` |
|---|---|---|---|---|
| 8–10 | `full` | `ok` | `strong` | `null` — no warning |
| 5–7 | `good` | `partial` | `strong` | light suggestions |
| 3–4 | `limited` | `weak_profile` | `moderate` | clear resume-strength message |
| 1–2 | `very_limited` | `weak_profile` | `needs_work` | strong message |
| 0 | `none` | `weak_profile` | `needs_work` | what to build first |

`resume_feedback` is built from **real aggregated evidence** — the skills that
actually recurred across the postings this candidate nearly matched. When there
is no such evidence the copy says so and gives structural advice instead; it
never dresses generic advice up as analysis.

**A scoring outage is never blamed on the resume.** If most scoring calls fail,
`resume_feedback` owns it explicitly:

> "We could not score 9 of 11 matches because of a temporary problem on our
> side, so this list is shorter than it should be. Please try again shortly —
> this is not a reflection of your resume." 

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
| `attempted` | integer | Opportunities considered |
| `succeeded` | integer | Scored successfully |
| `failed` | integer | Provider errors |
| `skipped_no_content` | integer | Pages with no readable job details — deliberately not scored |

`skipped_no_content` is a **third outcome**, distinct from both. A page that
yielded no company, description, requirements or skills gives the model nothing
to match on, so no scoring call is spent. Counting it as `failed` would
overstate provider problems; counting it as a low score would conflate "we
could not read it" with "it is a poor match".

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
| `geographic_target_met` | boolean | True when ≥7 are `same_state`. **Currently false on every run** — see Known gaps |
| `scoring` | object | Nested copy of §1.3 |

`quota_status` is never `full` unless 10 genuinely qualifying items were found.

### 1.5 `weak_profile` (present only when `status` is `weak_profile`)

| Field | Type | Notes |
|---|---|---|
| `returned` | integer | What genuinely qualified |
| `target` | integer | 8 — what a full list looks like. **Not** a minimum we pad to |
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

Verbatim from live run `SHOWCASE-1-strong`. **No synthetic data.** Two of six
opportunities shown.

```json
{
  "status": "partial",
  "result_tier": "good",
  "resume_strength": "strong",
  "resume_feedback": "Good match rate. Adding a deployed project or an internship to your resume typically widens the range of roles you match.",
  "opportunity_count": 6,
  "opportunities": [
    {
      "title": "Frontend Developer Intern",
      "company": "Anvaya AI",
      "description": "Work on live projects under mentor guidance, apply React, JavaScript, HTML and CSS…",
      "location": { "city": "Hyderabad", "state": "Telangana", "country": "India", "display": "Hyderabad, Telangana, India" },
      "apply_url": "https://myinternships.in/job/anvaya-ai-is-hiring-frontend-developer-intern-hyderabad-44bab7",
      "employment_type": "internship",
      "work_mode": "onsite",
      "salary": null,
      "is_paid": false,
      "deadline": null,
      "requirements": ["Pursuing a relevant degree", "React", "JavaScript"],
      "skills": ["React", "JavaScript", "HTML", "CSS"],
      "score": 98,
      "reasoning": "Strong overlap between the candidate's React and JavaScript project work and this internship's stated requirements.",
      "missing_requirements": [],
      "tier": "same_state",
      "allocation_reason": "quota"
    }
    /* … 5 more … */
  ],
  "scoring": { "attempted": 13, "succeeded": 6, "failed": 0, "skipped_no_content": 7 },
  "allocation": {
    "returned": 6, "target": 10, "quota_status": "partial",
    "scored_candidates": 6, "below_score_floor": 0,
    "excluded_no_apply_url": 0, "excluded_aggregator_page": 0,
    "min_score": 50, "geographic_target_met": false,
    "geography_resolved_pct": 83, "same_state": 3,
    "scoring": { "attempted": 13, "succeeded": 6, "failed": 0, "skipped_no_content": 7 }
  },
  "discovery": { "broadening_applied": true, "primary_admitted": 9, "broadened_admitted": 8 },
  "weak_profile": { "target": 8, "reasons": [], "gaps": [], "gaps_note": "…" }
}
```

A `result_tier: "full"` response is identical with 8–10 opportunities,
`status: "ok"` and `resume_feedback: null`.

---

## 3. Known gaps

Documented rather than hidden. Current and measured.

1. **Short lists are the norm.** Live counts have ranged 0–6, not 8–10. This is
   a correct outcome, surfaced through `result_tier` and `resume_feedback` —
   never padding.
2. **`salary` and `deadline` are rarely populated.** Most postings do not state
   them, and the service refuses to invent them.
3. **`weak_profile.gaps` is often empty.** It only reports a skill appearing in
   ≥2 scored postings, which a short run rarely produces. `resume_feedback`
   still carries usable advice in that case.
4. **`geographic_target_met` is usually false** — it requires 7 same-state
   results, unreachable on a short list. Use **`geography_resolved_pct`**
   (83% live) and `same_state` instead; those reflect whether geography
   actually worked.
5. **Throughput is one job at a time**, 5–20 minutes each, and free provider
   tiers support roughly one run per day.

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
