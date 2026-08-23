# Opportunity Radar — AI Agent

**Resume PDF in, ranked internships out.** This is the AI backend that powers
[Opportunity Radar](https://github.com/Laxmansirvi05/opportunity-radar): a
multi-service pipeline that reads a student's resume, plans a multi-source
search, discovers real internship postings across the web, scores each against
the resume, and returns a ranked, geographically-tiered list — every result
carrying a working apply link.

It is an **internal service**. Opportunity Radar's backend calls it; a browser
never does.

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

---

## Why it exists

Job boards are noisy, and most "internship finders" hand back category pages,
expired listings, or links that never lead to an application. This pipeline is
built around a few hard rules so that what it returns is actually usable:

- **Every returned item has a real `apply_url`** — a specific posting, never a
  listing, category, or careers root.
- **Nothing is invented.** Unstated fields stay `null`; a weak match is dropped,
  not padded.
- **A failed score is never a low score.** Scoring distinguishes `scored`,
  `failed`, and `skipped_no_content` — they are never collapsed.
- **Fewer real results beat more fake ones.**

## Pipeline at a glance

| # | Stage | Does |
|---|---|---|
| 1 | Read PDF | resume text in from disk |
| 2–3 | Build & parse profile | LLM builds a candidate profile from the resume |
| 4 | Plan search | resume → multi-source internship search intelligence |
| 5 | Discover | ~45 queries across 9 source families (via Tavily) |
| 6 | Normalize + gate | dedup, reject listing pages, broaden if results are thin |
| 7–8 | Fetch & clean | direct GET with a headless-browser fallback for JS pages |
| 9–10 | Extract & standardize | LLM extraction → canonical fields |
| 11–12 | Score & rank | resume-match engine, sequential |
| 13 | Allocate | score floor + geographic tiers |
| 14 | Respond | tiered results + resume feedback, projected to the API contract |

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Services

| Service | Port | Purpose | Required? |
|---|---|---|---|
| PostgreSQL | 5432 | job state, candidates, search plans | **yes** |
| ai-gateway | 4000 | all LLM calls, provider failover | **yes** |
| search-planner | 4200 | resume → search plan intelligence | **yes** |
| render-service | 3100 | Playwright fallback for JS-heavy pages | **yes** |
| job-server | 4300 | `POST /api/jobs`, polling | yes, for API use |
| Redis | 6379 | reserved for the Data Plane | not for the pipeline |
| profile-builder | 4100 | validated CIP + candidate persistence | not wired today |

## Quickstart

Every package has its own `node_modules`. A fresh clone has none.

```bash
# 1. Install dependencies (render-service downloads Chromium, ~150 MB)
for d in . ai-gateway search-planner render-service profile-builder \
         execution-fabric data job-server; do
  (cd "$d" && npm install)
done

# 2. Configure — copy each .env.example to .env and fill the [REQUIRED] values
cp .env.example .env                          # GATEWAY_API_KEY, TAVILY_API_KEY, RESUME_INPUT_PATH
cp ai-gateway/.env.example ai-gateway/.env    # provider keys + GATEWAY_API_KEY (must match)

# 3. Infrastructure
docker compose up -d                          # postgres + redis

# 4. Database schema (idempotent)
cd data && node src/migrate.js && cd ..

# 5. Services — each in its own shell
cd ai-gateway     && npm start   # :4000
cd search-planner && npm start   # :4200
cd render-service && npm start   # :3100
cd job-server     && npm start   # :4300

# 6. Load the workflow into n8n
npx n8n import:workflow --input=workflows.json
```

Full operating guide, health checks, and failure diagnosis:
[`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## API

Submit a resume and poll for results:

```
POST /api/jobs      # multipart PDF  → { job_id }
GET  /api/jobs/:id  # → { status, result }
```

The response contract (fields, tiers, `resume_feedback`) is specified in
[`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) and enforced statically by
`node tools/verify-contract.js`.

## Repository layout

| Path | What |
|---|---|
| `workflows.json` | the n8n pipeline — the heart of the system |
| `ai-gateway/` | LLM calls, provider key pool, failover |
| `search-planner/` | resume → search-plan intelligence |
| `render-service/` | Playwright fallback for JS-heavy pages |
| `job-server/` | HTTP API, one job at a time |
| `data/` | Postgres migrations + repositories |
| `execution-fabric/` | provider adapters (greenhouse/lever/ashby) — future execution layer |
| `profile-builder/` | validated candidate profile — not wired today |
| `tools/` | verification + replay scripts |
| `docs/` | architecture, runbook, API contract, security, integration guide |

## Design invariants

Break these and the product breaks — they are documented in full in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):

1. A failed score is never a low score.
2. Never pad — fewer real results beats more fake ones.
3. Every returned item has a real `apply_url` to a specific posting.
4. Nothing is invented; unstated fields stay `null`.
5. `Loop Over Items` `batchSize` stays 1.
6. Scoring is sequential (concurrency hit per-minute token limits hard).
7. Each service gets its own API key.

`tools/verify-workflow-config.js` enforces 3, 5, and 7 statically.

## Security

Secrets live only in `.env` files, which are git-ignored (`.env.example`
templates are tracked). See [`docs/SECURITY.md`](docs/SECURITY.md) for the key
model and handling notes.

## License

Private project — all rights reserved.
