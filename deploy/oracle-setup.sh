#!/bin/bash
# One-time bootstrap for the AI Search agent on a fresh Oracle Cloud
# Ubuntu 22.04 ARM (Ampere A1) VM. Run as the ubuntu user with sudo, from
# the repo root after cloning/copying the repo onto the VM.
#
# Usage: ./deploy/oracle-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1/8: System packages ==="
sudo apt-get update -y
sudo apt-get install -y curl git build-essential

echo "=== 2/8: Node.js 20 LTS ==="
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v && npm -v

echo "=== 3/8: Docker (Postgres + Redis) ==="
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "!!! Added $USER to the docker group. If the next step fails with a"
  echo "!!! permission error, log out, log back in, and re-run this script."
fi

echo "=== 4/8: Infrastructure (Postgres + Redis) ==="
docker compose up -d
echo "Waiting for Postgres to report healthy..."
for i in $(seq 1 30); do
  if docker compose ps postgres 2>/dev/null | grep -q healthy; then break; fi
  sleep 2
done

echo "=== 5/8: Install dependencies per service ==="
for d in . ai-gateway search-planner render-service profile-builder execution-fabric data job-server; do
  echo "--- npm install: $d ---"
  (cd "$d" && npm install)
done
# render-service's own postinstall runs `playwright install --with-deps
# chromium` — pulls the ARM64 browser build + its apt deps automatically.

echo "=== 6/8: Env files (secrets left blank — fill in after this runs) ==="
mkdir -p "$HOME/.n8n-files"

write_env() {
  local path="$1"; shift
  if [ -f "$path" ]; then
    echo "  $path already exists, leaving it alone"
    return
  fi
  printf '%s\n' "$@" > "$path"
  echo "  wrote $path"
}

write_env "./.env" \
  "# n8n itself reads these as \$env.NAME — see RUNBOOK.md §3" \
  "GATEWAY_API_KEY=" \
  "TAVILY_API_KEY=" \
  "RESUME_INPUT_PATH=$HOME/.n8n-files/resume-input.pdf" \
  "RENDER_SERVICE_API_KEY="

write_env "ai-gateway/.env" \
  "PORT=4000" \
  "GATEWAY_API_KEY=" \
  "GEMINI_API_KEY=" \
  "GEMINI_MODEL=gemini-flash-latest" \
  "OPENROUTER_API_KEY=" \
  "OPENROUTER_MODEL=google/gemma-4-26b-a4b-it:free" \
  "GROQ_API_KEY=" \
  "GROQ_MODEL=llama-3.3-70b-versatile"

write_env "render-service/.env" \
  "PORT=3100" \
  "HOST=0.0.0.0" \
  "API_KEY=" \
  "BLOCK_PRIVATE_NETWORK_TARGETS=true"

write_env "data/.env" \
  "PGHOST=localhost" \
  "PGPORT=5432" \
  "PGDATABASE=opportunity_radar" \
  "PGUSER=postgres" \
  "PGPASSWORD=postgres" \
  "TAVILY_API_KEY="

write_env "search-planner/.env" \
  "PGHOST=localhost" \
  "PGPORT=5432" \
  "PGDATABASE=opportunity_radar" \
  "PGUSER=postgres" \
  "PGPASSWORD=postgres"

write_env "job-server/.env" \
  "JOB_SERVER_PORT=4300" \
  "ENABLE_CORS=false" \
  "PGHOST=localhost" \
  "PGPORT=5432" \
  "PGDATABASE=opportunity_radar" \
  "PGUSER=postgres" \
  "PGPASSWORD=postgres" \
  "UPLOAD_DIR=/tmp/opportunity-radar-uploads"

echo ""
echo "!!! Every file above with a blank secret needs a real value before the"
echo "!!! services will work. See deploy/README.md for the full checklist and"
echo "!!! where to get each key. GATEWAY_API_KEY must be IDENTICAL in ./.env"
echo "!!! and ai-gateway/.env. RENDER_SERVICE_API_KEY must be IDENTICAL in"
echo "!!! ./.env and render-service/.env — these are two DIFFERENT secrets"
echo "!!! from each other, not the same value twice."

echo "=== 7/8: Database schema ==="
(cd data && node src/migrate.js)

echo "=== 8/8: Done ==="
echo "Next steps (in order):"
echo "  1. Fill in every blank secret above (deploy/README.md has the list + sources)"
echo "  2. sudo ./deploy/install-services.sh   # systemd units for the 4 services"
echo "  3. npx n8n import:workflow --input=workflows.json"
echo "  4. sudo ./deploy/install-caddy.sh      # reverse proxy, TLS, shared secret"
echo "  5. Verify: curl -sf http://localhost:4300/health (should print {\"status\":\"ok\"})"
