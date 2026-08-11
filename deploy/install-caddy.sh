#!/bin/bash
# Installs Caddy and points it at deploy/Caddyfile.
#
# Before running:
#   1. Point a real DNS A record at this VM's public IP (Caddy needs a
#      real domain to provision TLS — see deploy/Caddyfile's own comment).
#   2. Edit deploy/Caddyfile: replace ai-search.YOURDOMAIN.com.
#   3. Open port 80 and 443 in the Oracle security list (in addition to
#      the port 22 you already opened for SSH) — Caddy needs 80 for the
#      ACME HTTP challenge and 443 for the actual proxy.
#   4. export INTERNAL_SHARED_SECRET=<a long random value> — the SAME
#      value Opportunity Radar's INTERVIEW_AGENT_INTERNAL_SECRET-style env
#      var must send as X-Internal-Secret. Generate one with:
#        openssl rand -hex 32
#
# Usage: sudo INTERNAL_SHARED_SECRET=... ./deploy/install-caddy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${INTERNAL_SHARED_SECRET:-}" ]; then
  echo "!!! INTERNAL_SHARED_SECRET is not set. Generate one and re-run:"
  echo "!!!   export INTERNAL_SHARED_SECRET=\$(openssl rand -hex 32)"
  echo "!!!   echo \$INTERNAL_SHARED_SECRET   # save this — Opportunity Radar needs it too"
  exit 1
fi

if grep -q "YOURDOMAIN" deploy/Caddyfile; then
  echo "!!! deploy/Caddyfile still has the placeholder domain. Edit it first."
  exit 1
fi

echo "=== Installing Caddy ==="
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update -y
sudo apt-get install -y caddy

echo "=== Installing config ==="
sudo mkdir -p /etc/caddy/env
echo "INTERNAL_SHARED_SECRET=$INTERNAL_SHARED_SECRET" | sudo tee /etc/caddy/env/secret > /dev/null
sudo chmod 600 /etc/caddy/env/secret
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile

sudo mkdir -p /etc/systemd/system/caddy.service.d
cat <<EOF | sudo tee /etc/systemd/system/caddy.service.d/env.conf > /dev/null
[Service]
EnvironmentFile=/etc/caddy/env/secret
EOF
sudo systemctl daemon-reload

echo "=== Starting Caddy ==="
sudo systemctl enable caddy
sudo systemctl restart caddy
sleep 3
sudo systemctl status caddy --no-pager -l | head -10

echo ""
echo "=== Verify ==="
echo "From another machine (not this VM):"
echo "  curl -i https://\$(grep -oP '(?<=^)[a-z0-9.-]+(?=\s*\{)' deploy/Caddyfile | head -1)/api/jobs"
echo "  -> should be 403 without the header, and reach job-server WITH it:"
echo "  curl -i -H \"X-Internal-Secret: \$INTERNAL_SHARED_SECRET\" https://<domain>/health"
echo ""
echo "Give Opportunity Radar these two values:"
echo "  AI_AGENT_URL=https://<your domain>"
echo "  (a matching INTERNAL_SHARED_SECRET-style var, wired into the backend's"
echo "   fetch calls to send X-Internal-Secret — see deploy/README.md)"
