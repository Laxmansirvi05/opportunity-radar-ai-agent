# Needs From Human

Sub-tasks that cannot be completed by the agent because they require a real
signup, an account-bound key, a model download, or a machine-level install.

Rules the agent follows for this file:

- Nothing in the codebase may **require** a paid key to run. Every item below
  has a stub or fallback in place so the rest of the pipeline still runs.
- The agent never idles waiting on an item here. It appends the item, stubs
  the capability, and moves to the next task.
- The human owner resolves these and tells the agent when done.

Status legend: `OPEN` — waiting on human · `DONE` — resolved · `N/A` — no
longer needed.

---

## 1. Docker daemon not available on this machine — `DONE`

**Resolved:** colima + docker CLI installed via `brew install colima docker &&
colima start`. SearxNG container is running on port 8888 with JSON output
enabled.

> **Reboot note:** colima does not auto-start after a machine reboot. Run
> `colima start` after each restart, then
> `docker start <searxng-container-id>` (or re-run the docker command below)
> to bring SearxNG back. Same category as OmniRoute's `omniroute` needing a
> manual restart.
>
> ```bash
> colima start
> docker run -d -p 8888:8080 -v "/Users/laxmansirvi/ai  agent /default-settings.yml":/etc/searxng/settings.yml searxng/searxng
> ```

---

## 2. SearxNG instance URL — `DONE`

**Resolved:** `SEARXNG_BASE_URL=http://localhost:8888` is set in `.env`.
SearxNG is running via colima/docker on port 8888 with a custom
`settings.yml` that enables `format=json`. Verified working: returns 31
relevant results for a real "Frontend Developer Intern Hyderabad" query.

---

## 3. TinyFish free API key — `OPEN`

**What's needed:** `TINYFISH_API_KEY` in the repo-root `.env`.

**Why:** TinyFish Search + Fetch is the plan's second free provider behind the
same interface, used as a cross-check when SearxNG returns thin results, and
as the option for people who'd rather not operate a SearxNG container. Free
tier only — the paid Agent/Browser endpoints are explicitly Phase 15 and must
not be wired now.

**How to get it:** sign up at <https://agent.tinyfish.ai> and copy the key
from the dashboard.

**Agent workaround in place:** provider is implemented and reports itself
unavailable without the key; never selected as default.

---

## 4. Ollama installed with a pulled model — `OPEN`

**What's needed:** Ollama running locally with at least one chat model and one
embedding model pulled.

**Why:** Phase 2 wants an explicit free local-LLM path in `ai-gateway`
alongside the existing hosted providers, and Phase 6's semantic dedup needs a
local embedding model to write into the already-enabled `pgvector` columns
without spending hosted quota. Phases 4–5's `browser-use` escalation is also
specified to run against the free local model.

**How to get it:**

```bash
brew install ollama && ollama serve
```

Then, in a second shell:

```bash
ollama pull llama3.1:8b && ollama pull nomic-embed-text
```

**Agent workaround in place:** the Ollama provider is registered in the
gateway but never chosen unless `OLLAMA_BASE_URL` is set and a health probe
passes, so the existing hosted chain is untouched.

---

## 5. `git push` to GitHub is blocked from the agent sandbox — `OPEN`

**What's needed:** either the human runs `git push origin main` periodically,
or `github.com:443` is allowed for this session's sandbox.

**Why:** the standing directive is commit **and push** after every meaningful
change. Commits are landing fine, but the push fails:

```
fatal: unable to access 'https://github.com/Laxmansirvi05/opportunity-radar-ai-agent.git/':
CONNECT tunnel failed, response 403
deny network-outbound github.com:443 (user denied)
```

The remote itself is configured correctly (`git remote -v` resolves to
`Laxmansirvi05/opportunity-radar-ai-agent`), so this is a sandbox egress
policy, not a repo problem.

**How to resolve:** run this in a normal terminal whenever convenient — every
agent commit is already local and pushes cleanly in one go:

```bash
git push origin main
```

**Agent workaround in place:** work continues and every step is still
committed locally with its own conventional-style message, so nothing is lost
and the whole batch pushes as normal history later. The agent will note in
each PROGRESS entry that the commit is local-only.
