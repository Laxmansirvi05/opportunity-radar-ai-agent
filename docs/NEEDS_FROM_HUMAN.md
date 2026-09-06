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

## 1. Docker daemon not available on this machine — `OPEN`

**What's needed:** a working Docker daemon (Docker Desktop or colima) on the
dev machine.

**Why:** `docker` is not on `PATH` here and no daemon is reachable. The plan
calls for SearxNG (Phase 3) and optionally `jobspy-api` and `browser-use`
(Phases 3–5) to run as containers via `docker-compose.yml`. The agent can
write those compose entries, but cannot start or verify them.

**How to get it:**

```bash
brew install --cask docker
```

Then launch Docker Desktop once and confirm with `docker ps`. A lighter
alternative that also works:

```bash
brew install colima docker && colima start
```

**Agent workaround in place:** provider layer treats every external search
backend as optional and probes availability at call time, so a missing
SearxNG container degrades to the next provider instead of failing the run.
Not blocking any other task.

---

## 2. SearxNG instance URL — `OPEN`

**What's needed:** a reachable SearxNG base URL in `SEARXNG_BASE_URL`, with
JSON output enabled.

**Why:** SearxNG is the plan's default free search backend for Phase 3
(everything JobSpy doesn't cover: government portals, university pages,
company career pages). It needs either a local container (see item 1) or a
public instance that permits the JSON API — most public instances disable
`format=json`, so self-hosting is the realistic path.

**How to get it:** once item 1 is resolved, the agent-written compose service
covers it and the URL is `http://localhost:8080`. To confirm JSON output is
on:

```bash
curl -s 'http://localhost:8080/search?q=test&format=json' | head -c 200
```

If that returns HTML rather than JSON, add `- json` under `search.formats` in
the SearxNG `settings.yml`.

**Agent workaround in place:** the SearxNG provider is written and unit-tested
against recorded fixtures, and reports itself unavailable when
`SEARXNG_BASE_URL` is unset, so discovery falls through to other providers.

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
