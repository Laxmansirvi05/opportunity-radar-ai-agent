#!/bin/bash
# live-run.sh — one instrumented live pipeline run.
#
# Usage: tools/live-run.sh <resume.pdf> <run-label>
#
# Starts the four services, imports the current workflows.json, runs n8n once,
# and records wall-clock. Postgres/Redis are assumed already up (docker compose
# is not invoked here — the CLI is not available in this shell).

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

RESUME="${1:?usage: live-run.sh <resume.pdf> <label>}"
LABEL="${2:?usage: live-run.sh <resume.pdf> <label>}"
N8N_FILE="${RESUME_INPUT_PATH:-$HOME/.n8n-files/resume-input.pdf}"
mkdir -p "$(dirname "$N8N_FILE")"
OUTDIR="$ROOT/live-runs/$LABEL"
mkdir -p "$OUTDIR"

echo "=== live run: $LABEL ==="
echo "resume: $RESUME"

# --- stage the resume at the path the workflow reads ---
cp "$RESUME" "$N8N_FILE" || { echo "FAILED to stage resume"; exit 1; }

# --- stop anything already listening ---
for p in 4000 4100 4200 3000; do
  lsof -ti:$p | xargs kill -9 2>/dev/null
done
sleep 1

# --- start services ---
(cd ai-gateway     && node server.js     > "$OUTDIR/ai-gateway.log" 2>&1) &
(cd profile-builder && node src/server.js > "$OUTDIR/profile-builder.log" 2>&1) &
(cd render-service && node src/index.js     > "$OUTDIR/render-service.log" 2>&1) &
(cd search-planner && node src/server.js > "$OUTDIR/search-planner.log" 2>&1) &

echo "waiting for services..."
for i in $(seq 1 30); do
  ok=0
  curl -sf -m 2 http://localhost:4000/health >/dev/null 2>&1 && ok=$((ok+1))
  curl -sf -m 2 http://localhost:4200/health >/dev/null 2>&1 && ok=$((ok+1))
  curl -sf -m 2 http://localhost:3100/health >/dev/null 2>&1 && ok=$((ok+1))
  [ "$ok" -ge 3 ] && break
  sleep 1
done
echo "service health: ai-gateway=$(curl -sf -m 2 http://localhost:4000/health >/dev/null 2>&1 && echo up || echo DOWN) search-planner=$(curl -sf -m 2 http://localhost:4200/health >/dev/null 2>&1 && echo up || echo DOWN) render=$(curl -sf -m 2 http://localhost:3100/health >/dev/null 2>&1 && echo up || echo DOWN)"

# --- import current workflow ---
npx --yes n8n import:workflow --input=workflows.json > "$OUTDIR/import.log" 2>&1
echo "workflow imported (rc=$?)"

# --- execute, timed ---
set -a; [ -f .env ] && source .env; set +a
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false

START=$(date +%s)
npx --yes n8n execute --id "3bwLRC7IC0yDFog7" > "$OUTDIR/execution.json" 2> "$OUTDIR/execution.err"
RC=$?
END=$(date +%s)
ELAPSED=$((END - START))

echo "$ELAPSED" > "$OUTDIR/wall_clock_seconds.txt"
echo "=== run complete: rc=$RC wall_clock=${ELAPSED}s ==="
echo "output: $OUTDIR/execution.json"

# --- stop services ---
for p in 4000 4100 4200 3000; do
  lsof -ti:$p | xargs kill -9 2>/dev/null
done

exit $RC
