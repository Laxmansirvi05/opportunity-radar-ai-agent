# Implementation Progress Log

Append-only. Newest entry at the bottom. The last entry always ends with a
`RESUME FROM HERE` line naming the exact next atomic step.

This file plus `git log` must be enough for an agent with zero memory of the
originating conversation to pick up correctly. Read it together with:

- `docs/Implementation plan.md` — the plan being executed
- `docs/current-state-audit.md` — verified ground truth about the codebase
  (already done; do **not** re-audit)
- `docs/NEEDS_FROM_HUMAN.md` — sub-tasks blocked on a real signup/key that
  the human owner is handling

## Standing directives (carried from the originating session)

1. **n8n stays the production runtime.** `job-server/src/pipeline-runner.js`
   spawns `n8n execute`. Do not port pipeline logic into `execution-fabric/`
   as pure code — that is a rebuild, and the rule here is extend, don't
   rebuild. Future ideas of that shape get noted in this file, not acted on.
2. **Do not rename working things** to match the plan's illustrative names.
   `content_hash` (not `dedup_hash`), `fraud_flagged`/`scam_flagged` (not a
   single `trust_score`), custom `data/src/migrate.js` (not
   `node-pg-migrate`) — all already satisfy the intent. Leave them.
3. **Open source first.** Before >~15 lines of custom logic, check JobSpy,
   SearxNG, browser-use, TinyFish, SimplifyJobs `listings.json`,
   srbhr/Resume-Matcher, `@mozilla/readability` + `jsdom`, `robots-parser`,
   `bottleneck`, `fast-fuzzy`, `pgvector` (already enabled), Ollama.
4. **Free-first, no exceptions.** Nothing built here may require a paid key
   to run. If a sub-task genuinely needs an external signup, append it to
   `docs/NEEDS_FROM_HUMAN.md`, stub it so nothing else is blocked, and move
   on. Never idle waiting on a key.
5. **Commit + push after every individually-meaningful change**, not per
   phase. Conventional-style messages.
6. Phases 9–14 are 70–100% done. Close only the specific gap the audit
   named. Bulk of effort goes to Phases 3–8 and 15.

## Work order

1. ~~Fix A — Node 7 `batchSize` bug~~ (in progress)
2. Fix B — RENDER-SERVICE vs `GATEWAY_API_KEY` mismatch + loud startup check
3. Phase 3 — free-first search provider layer (top priority; Tavily is
   hardcoded and blocks discovery without a paid key)
4. Phase 4 — discovery execution & content extraction
5. Phase 5 — canonical link resolver
6. Phase 6 — duplicate detection (fuzzy + semantic on top of `content_hash`)
7. Phase 7 — trust & fraud screening → existing `fraud_flagged`/`scam_flagged`
8. Phase 8 — freshness & recency re-verification on the existing worker tick
9. Phases 9–14 — spot-check, close named gaps only
10. Phase 2 — add Ollama as a configurable free local-LLM path in ai-gateway
11. Phase 1 — only genuinely new tables (e.g. `org_registry` for Phase 5)
12. Phase 15 — last, after 3–8 are solid

---

## 2026-09-06 — Session 1

### Entry 1 — baseline established, no code changes yet

Read `docs/current-state-audit.md` (treated as ground truth, not re-derived),
`docs/Implementation plan.md` phases 3–8, and the live workflow graph.

Facts established beyond what the audit already recorded, needed for Fix A:

- Workflow id `3bwLRC7IC0yDFog7`, name "Opportunity Radar - AI Job Search
  Agent", 25 nodes. Present in `workflows.json` and in the local n8n sqlite DB
  at `~/.n8n/database.sqlite`. Locally installed n8n is **2.31.7**.
- `Loop Over Items` is `splitInBatches` typeVersion 3, currently
  `batchSize: 1`. Output 0 = done → `Finalize Results`. Output 1 = loop →
  `HTTP Request1`.
- **There are two unmerged fan-in points inside the loop body, not one.** The
  audit and the node's own inline note mention the `If` split; the second one
  matters just as much:
  - `Clean HTML` input 0 receives from **both** `If`(false) and `playwright`
  - `JSON Parse` input 0 receives from **both** `If1`(false) and
    `HTTP Request2`
  Neither has a Merge node. The loop-return edge is
  `Resume Match Engine → Loop Over Items`.
- `git remote -v` → `origin
  https://github.com/Laxmansirvi05/opportunity-radar-ai-agent.git`. Remote is
  configured, so ground rule 3 (stop if no remote) does not trigger.
- Sandbox note for future sessions: `~/.n8n` is **not** writable from the
  agent sandbox. To run n8n locally, set `N8N_USER_FOLDER` to a path under
  `$TMPDIR` — that gets a throwaway DB in a writable location.
- No Docker daemon on this machine (`docker` is not on PATH). Anything the
  plan describes as "add a service to `docker-compose.yml`" can be *written*
  but cannot be *run* here; it needs a Node-side fallback or a
  NEEDS_FROM_HUMAN entry so the pipeline still runs without it.

Files touched: `docs/PROGRESS.md` (new), `docs/NEEDS_FROM_HUMAN.md` (new).
Test status: n/a — documentation only.

RESUME FROM HERE: build the standalone n8n topology probe under `scratch/`
that reproduces `splitInBatches → If → {extra node, direct} → reconverge →
back to loop` with no network calls, run it at `batchSize` 1 and 5 under
`N8N_USER_FOLDER=$TMPDIR/...`, and record how many times the done-branch node
executes in each case. That measurement is Fix A's evidence.
