#!/bin/bash
# Installs the 4 systemd units and starts them, in dependency order.
# Run after oracle-setup.sh and after every .env file has a real value.
#
# Usage: sudo ./deploy/install-services.sh
set -euo pipefail
cd "$(dirname "$0")/.."

REPO_DIR="$(pwd)"
if [ "$REPO_DIR" != "/opt/ai-agent" ]; then
  echo "!!! Warning: this repo is at $REPO_DIR, but the .service files hardcode"
  echo "!!! WorkingDirectory=/opt/ai-agent/<service>. Either move the repo to"
  echo "!!! /opt/ai-agent, or edit deploy/systemd/*.service to match."
fi

echo "=== Log directory ==="
mkdir -p /var/log/ai-agent
chown ubuntu:ubuntu /var/log/ai-agent

echo "=== Installing unit files ==="
cp deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload

echo "=== Enabling + starting services (in order) ==="
for svc in ai-gateway search-planner render-service job-server; do
  systemctl enable "$svc"
  systemctl start "$svc"
  sleep 2
  systemctl status "$svc" --no-pager -l | head -5
  echo "---"
done

echo ""
echo "=== Health check ==="
for p in 4000 4200 3100 4300; do
  printf "%s: " "$p"
  curl -sf -m 3 "http://localhost:$p/health" || echo "DOWN"
  echo
done

echo ""
echo "All four should print {\"status\":\"ok\"} above. If any say DOWN:"
echo "  journalctl -u <service-name> -n 50 --no-pager"
echo "render-service is the slowest to report healthy (Chromium launch) —"
echo "give it ~10s and re-check before assuming it's actually broken."
