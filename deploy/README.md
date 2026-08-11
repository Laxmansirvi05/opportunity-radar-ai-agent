# Deploying to Oracle Cloud

Written so the actual deployment day is a checklist, not a research
session. Everything here assumes an Ubuntu 22.04 ARM (Ampere A1) Always
Free instance, per `docs/AI-FEATURES-HANDOFF.md`'s recommendation in the
main Opportunity Radar repo.

## Before you start

- The VM exists, is running, and you have SSH access to it.
- Only port 22 is open in the Oracle security list so far.
- You have (or will get during this process): `GEMINI_API_KEY`,
  `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TAVILY_API_KEY` — see the root
  `.env.example` for where each comes from.
- A domain (or subdomain) you can point at this VM's public IP. TLS
  requires a real domain — see `deploy/Caddyfile`'s own comment for why.

## Steps, in order

1. **Get the code onto the VM.** Either `git clone` this repo there
   directly, or `scp -r` a copy from this laptop. Either way, land it at
   `/opt/ai-agent` — the systemd unit files hardcode that path.

2. **Bootstrap:**
   ```bash
   cd /opt/ai-agent
   ./deploy/oracle-setup.sh
   ```
   Installs Node 20, Docker, all service dependencies, brings up
   Postgres + Redis, runs the DB migration, and writes empty `.env` files
   for you to fill in.

3. **Fill in the real secrets.** The script tells you exactly which files
   got created. `GATEWAY_API_KEY` must be identical in `./.env` and
   `ai-gateway/.env`. `RENDER_SERVICE_API_KEY` must be identical in
   `./.env` and `render-service/.env` — and must be a **different** value
   from `GATEWAY_API_KEY`, not the same secret twice (this exact mix-up
   is called out in the agent's own `docs/SECURITY.md` as the most damaging
   failure mode this system has had — silent 401s that look like blank
   pages, not an error).

4. **Start the four services:**
   ```bash
   sudo ./deploy/install-services.sh
   ```
   Installs systemd units, starts everything in dependency order, and
   runs the health checks for you.

5. **Import the n8n workflow** (needed once, and again any time
   `workflows.json` changes):
   ```bash
   npx n8n import:workflow --input=workflows.json
   ```

6. **Point a domain at the VM**, then:
   ```bash
   export INTERNAL_SHARED_SECRET=$(openssl rand -hex 32)
   echo $INTERNAL_SHARED_SECRET   # save this — Opportunity Radar needs it in step 7
   # edit deploy/Caddyfile: replace ai-search.YOURDOMAIN.com
   sudo INTERNAL_SHARED_SECRET=$INTERNAL_SHARED_SECRET ./deploy/install-caddy.sh
   ```
   Opens the only path in from the internet — job-server, gated by the
   shared secret, TLS auto-provisioned. Then open ports 80 + 443 (not
   4000/4200/3100/4300) in the Oracle security list.

7. **Wire up Opportunity Radar's side.** In its production environment
   (Vercel project settings, not committed to git):
   ```
   AI_AGENT_URL=https://<your domain>
   AI_AGENT_INTERNAL_SECRET=<the same value from step 6>
   ```
   `lib/ai-search/agent-client.ts` already sends this as `X-Internal-Secret`
   on every call — nothing else to change there.

8. **Prove it end to end**, from your own machine (not the VM):
   ```bash
   curl -X POST https://<your domain>/api/jobs \
     -H "X-Internal-Secret: $INTERNAL_SHARED_SECRET" \
     -F "resume=@/path/to/a/real/resume.pdf"
   ```
   Then poll `GET /api/jobs/<job_id>` the same way until `status` is
   `complete`. Expect 5–20 minutes — see `docs/RUNBOOK.md` for what a healthy
   run looks like.

## When something's wrong

`docs/RUNBOOK.md` is the actual operating guide — startup order,
how to tell if a run is healthy, and the specific failure modes that have
actually happened (`PROVIDERS_UNAVAILABLE`, a dead `render-service`, a
stuck job). Read that before guessing.

For the systemd layer specifically:
```bash
journalctl -u ai-gateway -n 50 --no-pager
journalctl -u caddy -n 50 --no-pager
systemctl status job-server
```

## What this does NOT cover

- **DeepInterview's own deployment** — separate service, separate VM
  recommended (`AI-FEATURES-HANDOFF.md` explicitly warns against sharing
  one free VM between the two). See DeepInterview's own `deploy/` if it
  has one, or its `docker-compose.yml`.
- **Ongoing paid-tier costs.** Free LLM tiers support roughly one student
  per day (`docs/RUNBOOK.md` §"Provider quota"). Scaling past that needs a paid
  tier — $0.006–$0.041/student, not a code change.
