# Architecture — Opportunity Radar internship service

How the system is put together and where to change things. For the request
contract see `API_CONTRACT.md`; for integration see `INTEGRATION_GUIDE.md`; for
running it see `RUNBOOK.md`.

---

## Boundary

This is an **internal service**. Opportunity Radar's backend calls it; a browser
never does. It owns one job: resume PDF in, ranked internships out.

```
Opportunity Radar backend
        │  POST /api/jobs (PDF)  ·  GET /api/jobs/:id
        ▼
   job-server :4300 ──── pipeline_jobs (Postgres)
        │  spawns one job at a time
        ▼
   n8n workflow (workflows.json)
        │
        ├─ ai-gateway     :4000   all LLM calls, provider failover
        ├─ search-planner :4200   resume → internship search intelligence
        └─ render-service :3100   headless-browser fallback for JS pages
```

Nothing else in the repo is on the request path.

---

## Pipeline stages

| # | Stage | Where | Notes |
|---|---|---|---|
| 1 | Read PDF | `Read/Write Files from Disk` | path from `$env.RESUME_INPUT_PATH` |
| 2 | Build profile | `Message a model` → ai-gateway | resume text is delimited untrusted input |
| 3 | Parse profile | `Code in JavaScript` | tolerant of 3 observed skill shapes |
| 4 | Plan search | `Build Multi-Source Search Plan` → search-planner | internship intelligence; provider-specific expansion stays local |
| 5 | Discover | `HTTP Request` → Tavily | ~45 queries across 9 source families |
| 6 | Normalize + gate | `Discovery Quality Gate + Dedup` | dedup, reject listing pages, **broaden if thin** |
| 7 | Fetch each | `HTTP Request1` → `If` → `playwright` | direct GET, render-service fallback |
| 8 | Restore identity | `Clean HTML` | re-attaches url/domain/geography lost by the fetch |
| 9 | Extract | `guard node` → `HTTP Request2` → `JSON Parse` | LLM extraction merged **onto** the item |
| 10 | Standardize | `Standardize Opportunity` | canonical field names |
| 11 | Score | `Resume Match Engine` | sequential; skips items with no content |
| 12 | Rank | `Finalize Results` | scored items only |
| 13 | Allocate | `Geographic Allocator` | score floor, product rule 5, geographic tiers |
| 14 | Respond | `Build Response` | tiering, `resume_feedback`, contract projection |

---

## Invariants — break these and the product breaks

1. **A failed score is never a low score.** Three distinct outcomes:
   `scored`, `failed`, `skipped_no_content`. Never collapse them.
2. **Never pad.** Fewer real results beats more fake ones.
3. **Every returned item has a real `apply_url`** to a specific posting — never
   a listing, category or careers root.
4. **Nothing is invented.** Unstated fields stay `null`.
5. **`Loop Over Items` batchSize stays 1.** The `If` branches reconverge into
   the loop; batching makes the done-branch fire repeatedly and emit partial
   results. Fixing it needs a Merge node before the feedback edge.
6. **Scoring is sequential.** Concurrency drove an 85% failure rate against
   per-minute token limits.
7. **Each service gets its own key.** ai-gateway uses `GATEWAY_API_KEY`;
   render-service uses `RENDER_SERVICE_API_KEY`. Conflating them silently
   breaks every render with 401 and yields blank pages.

`tools/verify-workflow-config.js` enforces 3, 5 and 7 statically.

---

## Not on the request path

| Component | Status |
|---|---|
| `profile-builder` :4100 | **Not wired.** Produces a validated CIP and persists a candidate row — needed if `/search-plan/build` is ever used instead of `/search-plan/preview` |
| `execution-fabric` | **Not wired.** Holds provider adapters (greenhouse/lever/ashby) for a future execution layer |
| `data/` | Migrations + repositories. Only `pipeline_jobs` (013) is used today |

Both are kept because the architecture references them and both are fully
tested. Delete only with a deliberate decision.

---

## Changing things safely

- **Response shape** → `Build Response`, then update `API_CONTRACT.md` and run
  `node tools/verify-contract.js`.
- **What counts as a real posting** → the listing patterns in
  `Discovery Quality Gate + Dedup` *and* `Geographic Allocator`. Both must agree.
- **Tier bands or feedback wording** → `Build Response`, then
  `node tools/verify-tiering.js`.
- **Scoring behaviour** → `ai-gateway/src/tasks/score-fit.js`.
- **Search strategy** → `search-planner/src/query-builder.js` for intelligence;
  the discovery node for provider-specific expansion.

After any workflow edit: `npx n8n import:workflow --input=workflows.json`.
