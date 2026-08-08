# Runbook — Opportunity Radar internship agent

Operating guide: how to bring the system up, tell whether it is healthy, and
diagnose the failures that actually happen. Written from real runs, not theory.

---

## 1. What the system is

A student uploads a resume PDF. The system returns internships with working
apply links. Six moving parts:

| Service | Port | Purpose | Required? |
|---|---|---|---|
| PostgreSQL | 5432 | job state, candidates, search plans | **yes** |
| Redis | 6379 | reserved for the Data Plane | not for the pipeline |
| ai-gateway | 4000 | all LLM calls, provider failover | **yes** |
| search-planner | 4200 | resume → search plan intelligence | **yes** |
| render-service | 3100 | Playwright fallback for JS-heavy pages | **yes** |
| job-server | 4300 | `POST /api/jobs`, polling | yes, for API use |
| profile-builder | 4100 | validated CIP + candidate persistence | **not wired** |

n8n runs the pipeline as a one-shot CLI execution (`n8n execute`), invoked by
the job server. It is **not** in webhook mode.

---

## 2. Startup order

Order matters: the pipeline calls the services by name, so they must be
listening before n8n starts.

```bash
# 0. Dependencies — every package has its own node_modules. A fresh clone has
#    none, and nothing runs until this completes.
for d in . ai-gateway search-planner render-service profile-builder \
         execution-fabric data job-server; do
  (cd "$d" && npm install)
done
# render-service's postinstall downloads Chromium (~150 MB, several minutes).
```

```bash
# 0b. Configuration — copy the relevant section of .env.example into each
#     service's own .env, then fill in the [REQUIRED] values.
cp .env.example .env                    # then edit: GATEWAY_API_KEY, TAVILY_API_KEY,
                                        #            RESUME_INPUT_PATH
cp ai-gateway/.env.example ai-gateway/.env   # then edit: the three provider keys
                                             #  + GATEWAY_API_KEY (must match ./.env)
```

```bash
# 1. Infrastructure
docker compose up -d              # postgres + redis
```

```bash
# 2. Database schema (idempotent; safe to re-run)
cd data && node src/migrate.js
```

```bash
# 3. Services — each in its own shell, or backgrounded
cd ai-gateway     && npm start    # :4000
cd search-planner && npm start    # :4200
cd render-service && npm start    # :3100
cd job-server     && npm start    # :4300
```

```bash
# 4. Import the workflow whenever workflows.json changes
npx n8n import:workflow --input=workflows.json
```

### Is it up?

```bash
for p in 4000 4200 3100 4300; do printf "%s: " $p; curl -sf -m 3 http://localhost:$p/health || echo DOWN; echo; done
```

All four must return `{"status":"ok"}`. `render-service` is the slowest to
start (it launches Chromium) — allow ~10s.

---

## 3. Environment

`.env.example` at the repo root documents **every** variable for every service
and is the authoritative reference. Copy the relevant section into each
service's own `.env`.

Two files must agree or every LLM call 401s:

- `ai-gateway/.env` → `GATEWAY_API_KEY` (what the gateway validates)
- `./.env` → `GATEWAY_API_KEY` (what n8n sends as `$env.GATEWAY_API_KEY`)

The root `./.env` also needs:

- `TAVILY_API_KEY` — the search provider
- `RESUME_INPUT_PATH` — absolute path the workflow reads the resume PDF from.
  The job server writes each upload here before invoking n8n, so **both must
  agree**. The job server loads the root `.env` for exactly this reason. Any
  absolute path works; the directory is created automatically.

`.env` files are gitignored and must stay that way.

---

## 4. Running one job

```bash
curl -X POST http://localhost:4300/api/jobs -F "resume=@/path/to/resume.pdf"
```

Returns `{ "job_id": "...", "status": "processing" }`. Then poll:

```bash
curl http://localhost:4300/api/jobs/<job_id>
```

Expect **5–15 minutes**. Observed on real runs: 78s (11 opportunities) to 781s
(24). Runtime scales with how many pages get scraped and scored, and degrades
badly when the LLM providers are throttled.

---

## 5. Telling whether a run is healthy

**Progress, live:**

```bash
grep -c request_completed /path/to/ai-gateway.log      # LLM calls made
grep -c "Fetch request completed" /path/to/render-service.log   # pages rendered
```

**Provider outcomes:**

```bash
grep request_completed ai-gateway.log | grep -o '"status":[0-9]*' | sort | uniq -c
```

`200` is good. A run that is mostly `503` means every provider is refusing —
see §6.

**Final result:** the job's `result.scoring` and `result.allocation` tell you
what actually happened:

```json
"scoring":    { "attempted": 46, "succeeded": 46, "failed": 0 },
"allocation": { "returned": 4, "below_score_floor": 1,
                "excluded_no_apply_url": 6, "excluded_aggregator_page": 9 }
```

A failed score is **never** silently treated as a low score. If
`scoring.failed` is high, the result set is short because of *us*, not because
of the student.

---

## 6. Failures that actually happen

### All LLM calls fail (`PROVIDERS_UNAVAILABLE`, HTTP 503)

By far the most common. The chain is groq → gemini → openrouter; when all three
refuse, the run dies.

Diagnose by asking each provider directly — the gateway deliberately does not
leak provider errors to callers:

```bash
set -a; source ai-gateway/.env; set +a
curl -s -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"hi"}],"max_tokens":5}'
```

The error body names the exact limit. Real examples seen:

| Symptom | Meaning | Fix |
|---|---|---|
| `tokens per day (TPD): Limit 100000, Used 99132` | Groq daily budget gone | Wait for reset, or upgrade tier |
| `Rate limit ... please try again in 13s` | Groq **per-minute** tokens | Wait a minute; it self-heals |
| Gemini `429 RESOURCE_EXHAUSTED` | 20 requests/day free tier | Wait for reset |
| Gemini `404 no longer available to new users` | The pinned model was retired | Use `GEMINI_MODEL=gemini-flash-latest` |

**A small test request can succeed while real ones fail.** A 36-token probe
fits in leftover daily budget that a 1,200-token scoring call does not. Always
probe with a realistic payload before concluding the provider is healthy.

### Run dies at `Message a model` (the first LLM step)

Same cause as above — it is simply the first call to hit the wall.

### Run dies at `playwright`

render-service is down or crashed (it has been seen to die mid-run after many
Chromium pages). Check `/health` on :3100 and restart it. The node is
`onError: continueRegularOutput`, so one bad page degrades one item rather than
killing the run — but the service being *gone* still fails it.

### Job stuck in `processing`

The worker sweeps any job running longer than `JOB_STUCK_AFTER_MS` (default 30
min) to `failed` with `PIPELINE_TIMEOUT`. The sweep runs on an interval, not
only at startup, so a job that hangs hours after boot is still reclaimed.

If n8n processes linger after a job is swept:

```bash
pgrep -f "n8n execute" | xargs kill
```

The runner spawns n8n detached and kills the whole process **group** on
timeout, so this should not happen — but check after any hard crash of the job
server itself, which would leave the group unowned.

### Database unreachable

Everything that touches jobs fails. Check:

```bash
nc -z localhost 5432 && echo up || echo DOWN
docker compose ps
```

### Provider quota — how much a run actually costs

Measured across four real runs: **~33 LLM calls and ~68,800 tokens per
student**, plus ~45 Tavily searches.

| Tier | Budget | Runs/day |
|---|---|---|
| Groq free | 100,000 tokens/day | **~1** |
| Gemini free | 20 requests/day | cannot carry one run (~33 calls) |
| Paid | — | $0.006–$0.041 per student depending on model |

`node tools/measure-cost.js` recomputes this from any captured run.

The free tier supports roughly **one student per day**. This is a commercial
limit, not an engineering one — no code change removes it.

### Tavily quota

The pipeline dies at the search step with *"exceeds your plan's set usage
limit"*. Each run spends ~45 searches. Budget accordingly.

---

## 7. Where the logs are

Services log JSON lines to stdout. When started via `tools/live-run.sh`, each
run gets its own directory:

```
live-runs/<label>/
  execution.json       full n8n execution dump (large)
  ai-gateway.log
  render-service.log
  search-planner.log
  wall_clock_seconds.txt
```

Summarise any captured run without re-running it:

```bash
node tools/analyze-run.js live-runs/<label>
```

This prints per-node throughput, item conservation through the loop, the
scoring failure rate, routing decisions, and the final response.

---

## 8. Working without spending quota

Most iteration needs no API calls at all. `tools/replay.js` executes the **real
node code** from `workflows.json` against captured fixtures:

```bash
node tools/verify-task1.js             # scoring-failure visibility
node tools/verify-task4.js             # score floor + tier contract
node tools/verify-task5.js             # weak-resume exit
node tools/verify-contract.js          # response matches API_CONTRACT.md
node tools/verify-gate-specificity.js  # gate admits postings, not listing pages
node tools/verify-edge-cases.js        # 18 edge cases
```

Test suites (also offline):

```bash
cd ai-gateway && npm test        # 17
cd search-planner && npm test    # 78
cd profile-builder && npm test   # 53
cd execution-fabric && npm test  # 57
cd job-server && npm test        # 17
```

The job server can run end-to-end without touching n8n by pointing it at a
captured response:

```bash
STUB_PIPELINE=$PWD/tools/.contract-example-ok.json npm start --prefix job-server
```

---

## 9. Deliberate design choices that look odd

- **`Loop Over Items` batchSize is 1.** Not an oversight. The `If` node's two
  branches reconverge and feed back into the loop separately, so a batch
  spanning both makes `splitInBatches`' done-branch fire repeatedly and emit
  partial results. Raising it silently corrupts output. Fixing it properly
  needs a Merge node before the loop feedback.
- **Scoring is sequential inside the loop.** Concurrent scoring drove an 85.7%
  failure rate against Groq's per-minute token limit.
- **`profile-builder` is not wired in.** It is kept, not dead: it is the only
  thing that produces a validated CIP and persists a candidate row, which
  `/search-plan/build` requires.
