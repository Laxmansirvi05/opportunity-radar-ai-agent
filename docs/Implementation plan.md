# Student AI Search Agent — Implementation Plan (v1.2)

**Source of truth for product behavior:** `Student_AI_Search_Agent_Product_Spec.pdf` (v1.0)
**Baseline implementation:** existing n8n workflow "Opportunity Radar – AI Job Search Agent" + `job-server` / service monorepo
**Mode:** Extend and harden the existing pipeline. No rebuild from scratch. No paid API keys until core logic is validated on free/local/self-hosted alternatives. Maximize reuse of vetted open-source projects over custom implementation wherever they cover a real gap.
**v1.1 change:** incorporated live research on four resources you sourced (`browser-use/browser-use`, `SimplifyJobs/Summer2027-Internships`, `MadsLorentzen/ai-job-search`, `tinyfish.ai`) — see **Part A.5**. Phases 3, 4, and 5 updated accordingly.
**v1.2 change:** answered "is there a closer open-source match" directly — researched and added `speedyapply/JobSpy` (+ `jobspy-api`), `srbhr/Resume-Matcher`, and evaluated `Rayyan9477/AutoApply-AI` as the closest full-stack analog (reference only, not adopted). Folded into Part A.5, Phases 2/3/10, the tooling table, architecture diagram, and risks.

---

## How to use this document

Each phase below is a **self-contained unit of work** with its own dependencies, tasks, tool choices, and a testable Definition of Done (DoD). Feed one phase at a time to your coding agent. Do not let it start Phase *N+1* until Phase *N*'s DoD passes against the resume fixtures in `test-resumes/`. Phase 0 is mandatory and blocks everything else — it replaces my visual guesses with verified facts from your actual code.

---

## Part A — Current State (as observed, with confidence levels)

### A.1 Repository shape (from VS Code screenshot)

```
ai agent/
├── agent/                 ← purpose unconfirmed
├── ai-gateway/             ← likely the LLM proxy behind :4000 calls
├── data/                   ← purpose unconfirmed
├── deploy/
├── docs/
├── execution-fabric/       ← likely where CLI pipeline execution lives
├── fixtures/                ← likely canned/captured responses for STUB_PIPELINE
├── job-server/              ← Node/Express + Postgres job queue (index.js reviewed)
│   └── src/{app,config,job-repository,pipeline-runner,worker}.js
├── profile-builder/         ← likely resume→profile logic
├── render-service/          ← likely final response formatting
├── search-planner/          ← likely search-query generation
├── test-resumes/            ← YOU ALREADY HAVE FIXTURES — use these for every DoD test
├── tools/
├── docker-compose.yml
├── workflows.json           ← ⚠️ EXPORTED N8N WORKFLOW — this is ground truth, read it before touching anything
└── package.json
```

**Confidence: high** (directly visible in screenshot).

### A.2 What `job-server/src/index.js` tells us

- Postgres-backed (`pg.Pool`), database name `opportunity_radar`.
- `createPgRepository(pool)` — a repository/DAO pattern already exists.
- `JobWorker` — a polling/ticking worker (`worker.tick()` fires `onSubmit`).
- **Pipeline execution is abstracted**: `STUB_PIPELINE` env var switches between:
  - `createStubRunner({ fromFile })` — replays a captured JSON response, **zero API calls**. This is exactly the "no paid keys during dev" mechanism you asked for — it already exists. Use it as the default test mode for every phase.
  - `createCliRunner({ repoRoot, logger })` — runs the *real* pipeline via CLI.
- Structured JSON logging already in place (`logger.info/warn/error`).

**Confidence: high** (code directly read).

### A.3 Reconstructed n8n pipeline (⚠️ hypothesis — confirm against `workflows.json` in Phase 0)

| # | Node (as labeled) | Likely function | Confirm via |
|---|---|---|---|
| 1 | When clicking 'Execute workflow' | Manual dev trigger | — |
| 2 | Read/Write Files from Disk | Loads resume file from local disk | workflows.json |
| 3 | Extract from File | Extract raw text from PDF resume | workflows.json |
| 4 | Message a model (`localhost:4000`) | LLM call — likely resume → structured profile | ai-gateway code |
| 5 | Code in JavaScript | Post-process/validate LLM JSON output | workflows.json |
| 6 | Build Multi-Source Search Plan | Generates queries across source types (company/gov/university/portal) | workflows.json |
| 7 | HTTP Request (`api.tavily.com`) | Executes web search via Tavily (paid-tier API) | — |
| 8 | Normalize + Classify Discovery Results | Normalizes raw search hits, tags source type | workflows.json |
| 9 | Discovery Quality Gate + Dedup | First-pass filter/dedup on raw search hits | workflows.json |
| 10 | Loop Over Items | Iterates per discovered listing | — |
| 11 | HTTP Request1 | Simple (non-JS) fetch of listing URL | — |
| 12 | If | Branches on whether JS-rendering/Playwright is needed | workflows.json |
| 13 | playwright (`127.0.0.1:3100`) | Headless-browser scrape for JS-heavy pages | — |
| 14 | Clean HTML | Strips markup noise | workflows.json |
| 15 | Extract Main Content | Extracts readable job-description text | workflows.json |
| 16 | guard node | Validation/safety guard (content non-empty? malicious?) | workflows.json — **name is ambiguous, must confirm** |
| 17 | If1 | Branches — possibly "already extracted before?" cache check | workflows.json |
| 18 | HTTP Request2 (`127.0.0.1:4000`) | LLM call — structured field extraction from listing text | ai-gateway code |
| 19 | JSON Parse | Parses LLM's structured JSON output | — |
| 20 | Parse + Rank Opportunities | Per-item scoring (partial) | workflows.json |
| 21 | Standardize Opportunity | Normalize into canonical schema | workflows.json |
| 22 | Resume Match Engine | Per-item match score/explanation vs. resume | workflows.json |
| → | *(loops back to #10 until done)* | | |
| 23 | Finalize Results | Aggregate all processed items | workflows.json |
| 24 | Geographic Allocator | Applies country/location distribution rule | workflows.json |
| 25 | Build Response | Formats final output | workflows.json |

**Confidence: medium** — node order and branch directions are read off the canvas; the actual logic inside each Code/HTTP node is unknown to me. This table is a starting hypothesis for your agent to correct, not a spec.

### A.4 The one architectural question that must be answered before Phase 1

Your monorepo has both an n8n workflow **and** a `execution-fabric/` + `createCliRunner` code path. These are two different ways to run "the pipeline." Before building anything new, determine:

- **Option A:** n8n is the production runtime. `job-server` triggers it via webhook/API when a job is queued.
- **Option B:** n8n is the design/prototyping surface only. Validated node logic gets ported into `execution-fabric/` as real Node modules, and `createCliRunner` executes the real pipeline as code — independent of a running n8n instance at request time.

**My recommendation (default if you don't override it): Option B.** Reasons: n8n as a hard runtime dependency for a production request path is fragile (single point of failure, harder to unit test, harder to version-control node logic, harder to run in CI). Keep n8n as the fast iteration/design tool where you prototype a new node, validate it manually, then "graduate" it into a tested module under `execution-fabric/`. This matches what `createCliRunner`/`createStubRunner` already seem built for.

This decision doesn't block Phase 0–1, but it must be made before Phase 3 (Search Planning), since where code lives changes how you structure the provider-abstraction module.

### A.5 Open-source / third-party resources you found (verified via live research)

| Resource | What it actually is | License / cost | Where it plugs in |
|---|---|---|---|
| **`browser-use/browser-use`** | Python library (MIT, ~free) that lets an LLM drive a real Chromium browser via CDP — DOM + vision extraction, multi-tab, custom actions, official CLI any coding agent can call. Works with local models through Ollama, so it costs nothing to self-host. A paid Cloud tier exists (stealth browsers, CAPTCHA-solving) but is optional. | MIT, free self-hosted; Cloud tier optional/paid | **Phase 4** — upgrade path for JS-heavy or multi-step pages beyond what a single Playwright script handles cleanly. **Phase 5** — agentic navigation to *find* the real "Apply" button on a career site, which is a better fit for PDF §8 than search-based link guessing. |
| **`SimplifyJobs/Summer2027-Internships`** (+ sibling repos: Summer2026, New-Grad, Off-Season) | Community + automated internship list, 46k★. Data is machine-readable — a `listings.json` on the `dev` branch, regenerated by GitHub Actions from community-approved submissions *and* Simplify's own hourly company-career-page monitor. Scope: **US/Canada/Remote tech internships only** (SWE, DS/AI, quant, PM, hardware). | Public repo; no explicit data-reuse license — treat as dev-time/reference use, confirm redistribution terms before a hard production dependency | **Phase 3**, two ways: (1) direct-ingest `listings.json` as an already-fresh, already-deduplicated source for the "genuinely remote/international" slice of results (PDF §6); (2) as the **pattern to copy** for a country-specific equivalent — see new Phase 3 task below. |
| **`MadsLorentzen/ai-job-search`** | A Claude-Code-native framework: one small CLI "skill" per job portal (`jobindex-search`, `linkedin-search`, etc.), every one normalized to the identical output contract `{title, company, location, date, url}`. The CV-tailoring/cover-letter reasoning layer needs a paid Claude API key or subscription; the portal-connector pattern itself does not. Community has already forked it per-country (Germany, Netherlands) and for the US using SimplifyJobs data as the source. | Source-available; reasoning layer requires paid Claude access (defer to Phase 15) | **Architecture pattern for Phase 3**, not a dependency to install: one small connector per source, all normalized to one contract, instead of one giant scraper. We replicate this pattern for country-specific sources; our reasoning layer already runs free and local via Ollama (Phase 2), so we don't need their Claude-API-based framework itself. |
| **TinyFish (`tinyfish.ai`)** | Commercial web-agent infrastructure: Search / Fetch / Browser / Agent APIs. **Search and Fetch are free at any account tier** and never draw from the paid balance; Browser and Agent are metered/paid. Ships an official n8n node (`n8n-nodes-tinyfish`), so it drops straight into the existing workflow with no custom HTTP node needed. | Search + Fetch: free (hosted, needs a free API key). Browser + Agent: paid → Phase 15 | **Phase 3** — optional second free search provider behind the same abstraction as SearxNG, useful as a cross-check when SearxNG returns thin results for a query. **Phase 4** — optional alternate "Fetch" provider for clean page content without maintaining Playwright infrastructure for every single page. |
| **`speedyapply/JobSpy`** (Python; TS port: `ts-jobspy`/"JobSpy JS") | The single most relevant *discovery-layer* component found. A mature (16k★+), actively maintained library that queries LinkedIn, Indeed, Glassdoor, Google Jobs, ZipRecruiter, Bayt, BDJobs, and **Naukri** (a major India portal) concurrently and returns one normalized schema (title, company, location, description, salary, remote flag, `job_type` — including `internship`), with built-in dedup. Free, MIT-style, self-hosted, no API key. A Docker-wrapped REST version (`rainmanjam/jobspy-api`) exposes it as a plain HTTP service — the exact pattern your n8n workflow already uses for `ai-gateway`/`playwright`. | Free, self-hosted (library or Docker) | **Phase 3, primary addition**: replaces a large share of the custom "search → scrape → extract" loop for the portals it covers, since it returns structured data directly rather than a URL to go fetch and parse. **Caveat:** it scrapes LinkedIn directly by default — disable `linkedin` in `site_name` to stay consistent with this plan's existing LinkedIn ToS rule; keep the other seven sources. |
| **`srbhr/Resume-Matcher`** | The most mature open-source project for the *matching* half of this problem: 27k★, Apache 2.0, actively developed, **works fully locally with Ollama** (or any remote provider if you want one later). Parses a resume (PDF/DOCX), compares it against a job description, and produces an ATS-compatibility score plus keyword-gap analysis and tailoring suggestions. Built for one-resume-vs-one-job-description use, not one-resume-vs-many-candidate-opportunities-then-rank — so it's a component/algorithm to adapt, not a drop-in service. | Apache 2.0, free | **Phase 2**: its resume-parsing approach is a strong reference for the structured-profile extraction step. **Phase 10**: its ATS/keyword-gap scoring logic is the closest existing open-source implementation of "match one resume against one opportunity" — worth reading its scoring code before writing Phase 10's matching engine from scratch, and reusing what applies. |

**How these fit without derailing the plan:** none of the six replace a phase — each slots into work already scoped. Four are free indefinitely and self-hosted (`browser-use`, `JobSpy`, `Resume-Matcher`, reading SimplifyJobs' public data), one is a pattern to imitate rather than a dependency (`MadsLorentzen`), and one is a hosted free tier with a paid ceiling above it (TinyFish) — exactly the "free default, paid optional behind an interface" shape the rest of this plan already uses.

**Is there a single project that matches the whole product?** No — nothing combines resume parsing, multi-source discovery, trust/dedup/geo/eligibility filtering, direct-link resolution, and ranking the way the PDF spec wants, built specifically for students. The closest full-stack *architectural* analog found is **`Rayyan9477/AutoApply-AI-Agentic-Browser-Automation-for-Job-Search`** (FastAPI + React + Redis + FAISS vector index, a pluggable `JobPlatform` ABC — one connector class per job site, implementing the same connector-per-source pattern recommended above — plus `browser-use` integration and a multi-provider LLM client with fallback). It's worth reading for architecture ideas, particularly the pluggable-platform interface and the LLM-provider-fallback client. But: it's early-stage (32★, 9 forks, several core features explicitly marked "in progress" in its own README, including live platform search itself), and its product intent is **auto-apply** (submitting applications on the student's behalf) rather than **curated discovery with direct links for the student to apply themselves** — a different philosophy from PDF §1's core promise. Treat it as a reference to skim, not a base to fork.

**One India-specific gap check performed:** searched for a SimplifyJobs-equivalent for Indian internships/government postings — nothing comparable exists as a maintained, structured, free open dataset beyond what JobSpy's Naukri connector already covers (only small unmaintained personal scrapers and paid Apify actors were found otherwise, several requiring cookie-based login theft against Internshala, which is itself a signal to treat that site as an anti-bot-hardened third-party source, not a scrape target to invest heavily in). **Conclusion:** for India (or whichever country the target student population is in), Phase 3 needs JobSpy's Naukri connector as a starting point plus its own small set of government/university connectors — following the `MadsLorentzen` one-connector-per-source pattern — rather than expecting to find one ready-made feed that covers everything.

---

## Part B — Non-negotiable product rules (condensed, for agent alignment across all phases)

Keep these visible to whichever AI agent executes each phase — they are the acceptance-test source, not just guidance:

1. **Precision over volume.** Fewer, justified results beat quota-filling. Never pad a weak profile's result set with weak matches.
2. **Adaptive count**, not fixed top-N: weak resume → 1–2, developing → 2–4, good → 4–8, strong → 6–10, very strong → up to 10 internships + up to 3–4 fresher roles (only if eligible).
3. **Country-aware:** ~75–80% same-country by default; 100% same-country is fine; international only when genuinely remote/online and strong.
4. **Direct-link priority:** official company page > official government page > official university/research page > trusted third-party (only if no better path exists).
5. **Trust gates are mandatory**, not optional polish: dedup, link validity, fraud screening, recency, org credibility, description completeness, eligibility consistency, compensation sanity, source consistency.
6. **Explainability:** every surfaced result must carry a defensible "why this matches" grounded in actual resume evidence.
7. **No paid API keys during initial build.** Every external dependency needs a free/local/self-hosted default; paid providers are added later behind the same interface, never hard-coded in.
8. **Student data handling:** resumes are sensitive; minimize retention/exposure; never present unverified employer claims as fact; distinguish "discovered" vs "verified" vs "high-confidence" in the data model itself.

---

## Part C — Target architecture (end state)

```
Resume Upload
   → Profile Builder (LLM-structured extraction, local model; parsing approach informed by Resume-Matcher)
   → Search Planner (multi-source query generation)
   → Search Provider Layer
        + JobSpy (primary structured connector: Indeed/Glassdoor/Google Jobs/ZipRecruiter/Bayt/BDJobs/Naukri)
        + SearxNG + TinyFish free-tier (generic search: gov/university/company pages; Tavily pluggable later)
        + Dedicated Source Connectors (SimplifyJobs listings.json; country-specific gov/university connectors)
   → Discovery Normalizer + First-Pass Gate
   → Per-Item Loop (skipped entirely for JobSpy-sourced items, which arrive pre-structured):
        → Fetch (cheap HTTP → Playwright → browser-use agent, escalating only as needed)
        → Content Extraction (Readability-based, or TinyFish Fetch)
        → Structured Extraction (LLM, local model)
        → Canonical Link Resolver (content signal → search match → browser-use agent, escalating as needed)
        → Standardize Opportunity (canonical schema)
   → Duplicate Detection (exact + fuzzy + semantic/embedding)
   → Trust & Fraud Screening Gate
   → Freshness / Recency Verification
   → Geographic & Eligibility Rules Engine
   → Resume-Opportunity Matching Engine (embeddings + LLM reasoning)
   → Ranking Engine (weighted multi-factor score + diversity re-rank)
   → Adaptive Result Assembly
   → Response (presentation schema)
```

Storage backbone: **existing Postgres**, extended with `pgvector` for embeddings — no new database technology introduced.

Provider abstraction principle: **every external paid-capable dependency (search, LLM, geocoding) sits behind a small interface with a free/local default implementation.** Swapping in a paid key later is a config change, never a rewrite.

---

## Part D — Phased Implementation Plan

### Dependency overview

| Phase | Depends on | Can run in parallel with |
|---|---|---|
| 0. Audit & Baseline Lock-In | — | — |
| 1. Data Foundation | 0 | — |
| 2. Resume Understanding | 0, 1 | 3 |
| 3. Free-First Search Provider | 0, 1 | 2 |
| 4. Discovery Execution & Content Extraction | 3 | — |
| 5. Canonical Link Resolver | 4 | 6 |
| 6. Duplicate Detection | 1, 4 | 5, 7 |
| 7. Trust & Fraud Screening | 4 | 5, 6 |
| 8. Freshness & Recency | 1, 4 | 5, 6, 7 |
| 9. Geographic & Eligibility Rules | 2 | 5–8 |
| 10. Resume-Opportunity Matching | 1, 2, 4 | 9 |
| 11. Ranking Engine | 6, 7, 8, 9, 10 | — |
| 12. Adaptive Result Assembly | 11 | — |
| 13. Safety & Privacy | can start anytime after 1 | ongoing |
| 14. Evaluation Harness | scaffold right after 1, mature throughout | ongoing |
| 15. Production Hardening / Paid-API Upgrade | all core phases done | — |

**Strict rule:** scaffold a minimal version of Phase 14 (eval harness) immediately after Phase 1 and re-run it after every subsequent phase. Don't wait until the end to find out Phase 3 broke Phase 2.

---

### Phase 0 — Audit & Baseline Lock-In

**Objective:** Replace assumptions (mine and yours) with verified facts. Establish a working, reproducible baseline before changing anything.

**Tasks:**
- [ ] Read `workflows.json` in full; extract exact parameters/code/prompts for every node in the reconstructed table (A.3). Correct the table.
- [ ] Read `docker-compose.yml` — list every containerized service (Postgres? Playwright? anything else?) and exposed ports.
- [ ] Read `job-server/src/{app,config,job-repository,pipeline-runner,worker}.js` in full (not just index.js).
- [ ] Read `.env.example` — this reveals every environment variable the system already anticipates (API keys, DB creds, service URLs). List them.
- [ ] Inspect `agent/`, `ai-gateway/`, `execution-fabric/`, `profile-builder/`, `render-service/`, `search-planner/`, `data/`, `tools/` — for each, note: is it empty scaffolding or does it contain real logic? What does `ai-gateway` proxy to (OpenAI? local model? undecided)?
- [ ] Resolve the Part A.4 architecture question (Option A vs B) and write down the decision with reasoning.
- [ ] Run the pipeline once in `STUB_PIPELINE` mode end-to-end with a sample from `test-resumes/`. Confirm it completes without errors.
- [ ] Run the pipeline once in live mode (whatever currently works, even with existing paid keys if already configured) against one weak and one strong test resume. Capture the raw output as a **baseline snapshot** — you'll diff against this after every future phase to catch regressions.

**Deliverable:** a `docs/current-state-audit.md` file containing the corrected pipeline map, the architecture decision, the env-var inventory, and the two baseline output snapshots.

**Definition of Done:** the audit doc exists, is internally consistent with the actual code, and STUB_PIPELINE mode runs clean end-to-end.

---

### Phase 1 — Data Foundation (Postgres + pgvector)

**Objective:** Give every later phase a stable place to write canonical, deduplicated, embeddable opportunity records — instead of records living only as transient n8n item JSON.

**Keep/Change:** ADD — this is new persistent infrastructure; the current pipeline appears to work in-memory/per-run only (confirm in Phase 0).

**Tools:** `pgvector` extension on the existing Postgres instance (free, self-hosted, no new DB engine). Migration tool: `node-pg-migrate` (free, npm) so schema changes are versioned from day one.

**Draft schema (illustrative — finalize during this phase, not before):**

```sql
-- opportunities: one row per CANONICAL opportunity (post-dedup)
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  org_name TEXT NOT NULL,
  org_domain TEXT,
  opportunity_type TEXT,        -- internship | fresher_job | research | government | freelance | ...
  category TEXT,                -- technical | creative | business | ...
  location TEXT,
  country TEXT,
  is_remote BOOLEAN DEFAULT FALSE,
  apply_url TEXT NOT NULL,
  apply_url_tier TEXT NOT NULL, -- official_company | official_ats | official_government | official_university | trusted_third_party
  description TEXT,
  eligibility_notes TEXT,
  status TEXT DEFAULT 'active', -- active | stale | closed | suspicious
  trust_score NUMERIC,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_verified_at TIMESTAMPTZ,
  embedding VECTOR(768),        -- dimension depends on chosen embedding model
  dedup_hash TEXT,
  raw_evidence JSONB
);

-- opportunity_sources: every raw URL/mention that was merged into a canonical opportunity
CREATE TABLE opportunity_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id),
  source_url TEXT NOT NULL,
  source_type TEXT,             -- company_site | govt_site | university_site | job_portal | search_snippet
  fetched_at TIMESTAMPTZ DEFAULT now()
);

-- resumes: one row per processed resume/profile
CREATE TABLE resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  structured_profile JSONB NOT NULL,
  profile_embedding VECTOR(768),
  country TEXT,
  academic_year TEXT
);

-- match_results: per resume × opportunity, the score + explanation
CREATE TABLE match_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id UUID REFERENCES resumes(id),
  opportunity_id UUID REFERENCES opportunities(id),
  match_score NUMERIC,
  match_reason TEXT,
  rank_position INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- run_logs: pipeline run metadata for observability/eval
CREATE TABLE run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id UUID REFERENCES resumes(id),
  stage TEXT,
  metrics JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Tasks:**
- [ ] Enable `pgvector` extension in the existing `opportunity_radar` database.
- [ ] Set up `node-pg-migrate`, write the initial migration from the schema above (adjust based on Phase 0 findings).
- [ ] Extend `job-repository.js` with read/write methods for the new tables (thin repository layer, matching the existing pattern).
- [ ] Choose and pin the embedding vector dimension now (depends on Phase 2/tooling choice — see Phase 2) so the column type is correct.

**Definition of Done:** migrations run cleanly against a fresh DB; `job-repository.js` can insert/query a dummy opportunity and resume row; `pgvector` similarity query (`<=>` operator) returns results on test data.

---

### Phase 2 — Resume Understanding Upgrade (Profile Builder)

**Objective:** Make resume understanding conceptual/human-like per PDF §5, not keyword extraction — and make it run on a free local model.

**Keep/Change:** the "Extract from File" node likely stays for raw text extraction. The "Message a model" node (→ `localhost:4000`) is probably already doing LLM-based structuring — **confirm in Phase 0**, then upgrade rather than replace: tighten the schema, add validation, and confirm `ai-gateway` is pointed at a free local model, not a paid one, during dev.

**Tools:**
- **Ollama** (free, self-hosted, OpenAI-compatible API) serving an open-weight model — `llama3.1:8b`, `qwen2.5:14b`, or `mistral-nemo` are all reasonable starting points on typical dev hardware.
- Point `ai-gateway`'s base URL at `http://localhost:11434/v1` for dev; keep the paid-provider path as a config switch for later (Phase 15).
- JSON-schema-constrained output (Ollama supports structured/JSON output modes) to reduce parsing failures — reduces reliance on a separate "Code in JavaScript" repair step.
- **Reference: `srbhr/Resume-Matcher`** (see A.5) — before writing the extraction prompt/schema from scratch, skim its resume-parsing module; it's a mature (27k★), local-Ollama-first, actively maintained implementation of exactly this sub-problem, and reusing its parsing approach (or its keyword/skill extraction logic specifically) is faster and more battle-tested than a from-scratch prompt.

**Target structured profile schema (conceptual, not full code):**
```
{
  education: { degree, field, institution, current_year },
  skills: { technical: [...], non_technical: [...] },
  projects: [ { title, description, skills_used, evidence_strength } ],
  internships: [ { org, role, duration, skills_used } ],
  achievements: [ { title, description, category } ],  // e.g. photography, competitions
  certifications: [...],
  interests: [...],
  country: string,
  eligibility_tier: "2nd_year" | "3rd_year" | "4th_year" | "4th_year_strong"
}
```

**Tasks:**
- [ ] Confirm current LLM prompt/schema (Phase 0 finding) and diff against the target schema above; add missing fields (esp. `evidence_strength` on projects, `eligibility_tier` derivation, `non_technical` skills — PDF explicitly calls out photography/creative examples).
- [ ] Switch `ai-gateway` default provider to Ollama for local dev; add config flag for future paid swap.
- [ ] Add output validation (schema check + retry-on-malformed-JSON) rather than relying solely on downstream "Code in JavaScript" cleanup.
- [ ] Add a skill-taxonomy normalization pass (e.g., "ML" → "Machine Learning") — simple synonym-map lookup is enough for v1, no need for a trained model.
- [ ] Derive `eligibility_tier` deterministically from `academic_year` + internship/project count, per PDF §3 table — this is a rules function, not an LLM judgment call, and should be deterministic and testable.

**Definition of Done:** running the pipeline against all tiers of resumes in `test-resumes/` (weak/developing/good/strong/very-strong) produces a valid structured profile for each, with correct `eligibility_tier`, and non-technical achievements are captured when present (test with a resume containing a non-technical strength, per PDF's photography example).

---

### Phase 3 — Free-First Search Provider Layer

**Objective:** Remove hard dependency on Tavily (paid-tier) during development, without discarding the current multi-source search-plan logic.

**Keep/Change:** KEEP "Build Multi-Source Search Plan" (query generation logic). REPLACE the direct Tavily HTTP call with a **provider abstraction** that defaults to a free backend.

**Tools:**
- **`speedyapply/JobSpy`** (see A.5) — **the primary structured-discovery connector**, added ahead of generic search for the portals it covers. Run it as its own small service (Python library, or the pre-built `rainmanjam/jobspy-api` Docker/FastAPI wrapper) called with `site_name` excluding `linkedin` (ToS), covering Indeed, Glassdoor, Google Jobs, ZipRecruiter, Bayt, BDJobs, and **Naukri** — the last one is a genuine India-specific win. It returns full structured listings (title, company, location, description, salary, `job_type='internship'` filter, dedup built in) directly, so for the sources it covers, it **replaces the search → scrape → extract chain** from Phases 3–4 entirely, not just the search step.
- **SearxNG** — free, open-source, self-hosted meta-search engine (aggregates Google/Bing/DuckDuckGo/etc. results without needing a paid key per engine). Add as a service in `docker-compose.yml`. Use this for everything JobSpy doesn't cover: government portals, university/research pages, individual company career pages.
- **TinyFish Search + Fetch** (see A.5) — free-tier hosted alternative behind the *same* provider interface, used as a fallback/cross-check when SearxNG returns thin results for a query, or as the primary provider if you'd rather not operate a SearxNG container. Free API key at `agent.tinyfish.ai`; an official `n8n-nodes-tinyfish` node exists if a stage stays in n8n rather than moving to `execution-fabric/`.
- **Additional dedicated connectors, following the `MadsLorentzen/ai-job-search` pattern** (one connector per source, every one normalized to the same output contract `{title, org, location, apply_url, posted_date, source_type}`), for what neither JobSpy nor generic search covers well:
  - `simplify-internships-connector`: direct-ingest `listings.json` from the `dev` branch of `SimplifyJobs/Summer2027-Internships` (and the New-Grad/Off-Season siblings as relevant) — a ready-made, pre-deduplicated feed for the genuinely-remote/US-Canada slice of results (PDF §6's international-when-remote exception). No scraping, no search, just a periodic file fetch.
  - One connector per priority government/university source for the target student population's country (e.g., for India: National Career Service, AICTE internship schemes, state government portals) — built once, reused every run, far more reliable than hoping search surfaces them.
  - Treat remaining large third-party portals (Internshala, etc.) as **search/connector targets of last resort** — the OSS research surfaced multiple hobby scrapers that needed stolen cookies to work against Internshala, which is a strong signal of anti-bot hardening; don't sink effort into defeating it, lean on JobSpy/official/government/company connectors first per PDF §7's own priority order.
- Keep Tavily as a **further pluggable provider** behind the same interface (`searchProvider.search(query, opts)`), selected via env var (`SEARCH_PROVIDER=searxng|tinyfish|tavily`), so adding the paid key later in Phase 15 is a one-line config change, not a rewrite.

**Tasks:**
- [ ] Stand up `JobSpy` (directly, or via `jobspy-api`'s Docker image) as a service; confirm `site_name` excludes `linkedin`; confirm `job_type='internship'` filtering and `is_remote` work as expected.
- [ ] Add SearxNG to `docker-compose.yml`; verify it returns results for representative queries.
- [ ] Implement a thin provider interface in `search-planner/` (or wherever Phase 0 determines search logic lives) with `jobspy` and `searxng` as the two defaults, `tinyfish` and `tavily` as alternates.
- [ ] Sign up for a free TinyFish API key; wire Search+Fetch in as the second provider behind the same interface (do **not** touch the paid Agent/Browser endpoints — those are Phase 15 only).
- [ ] Build the `simplify-internships-connector`: fetch `listings.json` from the `dev` branch on a schedule, map its fields into the standard discovery-item contract, tag `source_type='community_curated_feed'`.
- [ ] Wire "Build Multi-Source Search Plan" output into the new provider interface instead of the direct Tavily HTTP node.
- [ ] Build 3–5 dedicated connectors for the target country's highest-value government/university sources (start small, expand over time) — this replaces the old "curated seed-source config file" idea with actual working connectors, not just a list of URLs to search around.
- [ ] Ensure query generation explicitly targets source *types* per PDF §7 (company career pages, government portals, university/research pages, then general portals as fallback) — audit current "Build Multi-Source Search Plan" logic against this requirement.

**Definition of Done:** `JobSpy` returns real structured internship/job results (with `linkedin` excluded) for a test query including at least one `naukri` result for an India-located query; running discovery for a test resume also returns results sourced from SearxNG (and/or TinyFish's free tier) with zero calls to any paid API; the `simplify-internships-connector` successfully contributes at least one relevant remote/international result for an eligible profile; at least one government/university connector result appears for a same-country query.

---

### Phase 4 — Discovery Execution & Content Extraction Hardening

**Objective:** Make the per-item fetch → scrape → clean → extract loop robust and legally/ethically sound, and replace ad hoc HTML cleaning with a proven library.

**Keep/Change:** KEEP the Loop/If/playwright structure (it's a sound design: cheap fetch first, Playwright fallback for JS-heavy pages). REPLACE "Clean HTML" + "Extract Main Content" custom logic with a standard library. ADD robots.txt compliance and per-domain rate limiting (currently absent, based on visible nodes).

**Tools:**
- `@mozilla/readability` + `jsdom` (Node, free) — the same content-extraction library behind Firefox's Reader View; far more robust than hand-rolled HTML cleaning for job/internship listing pages. This stays the **default** path for the large majority of pages — cheap and fast.
- `robots-parser` (npm, free) — check robots.txt before scraping a new domain.
- `bottleneck` (npm, free) — per-domain request throttling, avoids hammering any single site and reduces block risk.
- **`browser-use`** (see A.5) as an **escalation path**, not a replacement for Playwright: for the subset of pages where a plain Playwright fetch + Readability extraction fails (multi-step application flows, content behind an interaction like "load more" or a consent wall), run a `browser-use` agent instead — it's built exactly for "navigate and extract" tasks and works with the free local Ollama model from Phase 2, no paid LLM required. Since it's Python, run it as its own small service (mirroring the existing pattern where Playwright already runs as a separate service at `127.0.0.1:3100`), called only when the cheap path fails, to keep it off the hot path.
- **TinyFish Fetch** (free tier, see A.5) as an optional alternate for the "get clean content from a URL" step — useful if you'd rather not operate/maintain a Playwright container at all; can run side-by-side with self-hosted Playwright behind a simple `contentFetcher.fetch(url)` interface and compared for quality before picking a default.
- **Explicitly exclude LinkedIn from direct scraping** — its ToS prohibits it. Use it (if at all) only as a discovery *signal* via search snippets, never as a scrape target; always resolve to the official employer page per PDF §8 anyway, so this costs nothing functionally.

**Tasks:**
- [ ] Confirm current "Clean HTML"/"Extract Main Content" implementation (Phase 0), then swap in Readability+jsdom, run both in parallel briefly to compare extraction quality before fully cutting over.
- [ ] Add robots.txt check before first fetch of any new domain; skip/flag domains that disallow.
- [ ] Add per-domain rate limiter wrapping both the simple-fetch and Playwright paths.
- [ ] Confirm what "guard node" and "If1" actually check (Phase 0) — if they're already doing something like "skip re-extraction for a known/cached URL," keep and formalize that logic against the new `opportunity_sources` table from Phase 1 (i.e., check DB before re-scraping a URL seen in the last N days).
- [ ] Stand up `browser-use` as a small standalone service, called only as the escalation path when the cheap fetch+Playwright path returns empty/low-quality content; wire it into the existing "If" branch logic as a third tier, not a replacement for the first two.
- [ ] Explicitly hard-block LinkedIn (and any other ToS-restrictive domain you identify) from the scrape path in code, not just by convention.

**Definition of Done:** discovery loop runs against a batch of real search results, respects robots.txt (verifiable via logs), never issues a raw scrape request to a blocked domain, content-extraction quality (spot-checked manually on 10 sample listings) is equal or better than the current baseline snapshot from Phase 0, and the `browser-use` escalation path successfully recovers at least one listing that the cheap path failed on.

---

### Phase 5 — Canonical / Direct Application Link Resolver *(new capability)*

**Objective:** Implement PDF §8's link-priority policy explicitly — this doesn't appear as a distinct step in the current node list and is one of the product's core differentiators.

**Keep/Change:** ADD. This is new logic, likely inserted between "Standardize Opportunity" and the dedup/trust gates, or as part of standardization itself.

**Approach (no paid API required):**
1. If the listing text/HTML contains a clear official employer domain (email domain, "apply on our website" link, canonical `<link rel="canonical">` tag) — use it directly. Cheapest, try first.
2. Otherwise, issue a SearxNG/TinyFish-Search query like `"{org_name} careers {role}"` and prefer results matching a domain that plausibly belongs to the organization (simple heuristic: domain contains a normalized form of the org name, or is a `.gov`/`.edu`/`.ac.in`-style official TLD pattern for government/university).
3. **If both of the above fail to produce a confident match** (e.g., the org's career site uses a non-obvious ATS domain, or the specific role isn't directly linkable from a search hit): escalate to a `browser-use` agent (same free local-LLM-backed service from Phase 4) with a narrow task like *"go to {org_name}'s official careers page and find the direct application link for the {role} posting"* — this mirrors what a human would actually do and is a better fit for PDF §8 than pattern-matching search results, at the cost of being slower, so reserve it for cases 1–2 couldn't resolve.
4. Maintain a growing **org-name → official-domain registry** in Postgres (new small table or reuse `org_domain` on `opportunities`), populated as you resolve links via any of the three strategies above — this cache reduces repeated search/agent cost over time and improves accuracy as the dataset grows.
5. **Fully resolve redirect chains** (follow HTTP redirects to their final destination, verify final status is 200) before accepting a URL as the `apply_url`.
6. Tag every resolved link with `apply_url_tier` per the PDF §8 priority order (official_company > official_ats > official_government > official_university > trusted_third_party).

**Tasks:**
- [ ] Add `org_registry` table (or extend `opportunities.org_domain`) for the caching mechanism.
- [ ] Implement canonical-tag/domain-in-content detection as the first, cheapest resolution strategy.
- [ ] Implement the SearxNG/TinyFish-based fallback resolution strategy.
- [ ] Implement the `browser-use` agentic escalation strategy for listings the first two strategies leave unresolved; cap it with a task-step budget so a stuck agent can't run indefinitely.
- [ ] Implement full redirect-chain resolution with a max-hop limit (e.g., 5) and dead-link detection.
- [ ] Implement `apply_url_tier` classification logic.

**Definition of Done:** for a batch of 20 sample discovered listings, resolver output is manually spot-checked: official/government/university links are correctly preferred over portal links when both exist; broken/dead links are correctly rejected; every output row has a non-null `apply_url_tier`; the `browser-use` escalation path correctly resolves at least one listing that the first two strategies couldn't.

---

### Phase 6 — Duplicate Detection Upgrade

**Objective:** Move from (assumed) simple URL-based dedup to a multi-signal approach per PDF §10.

**Keep/Change:** UPGRADE "Discovery Quality Gate + Dedup" (confirm its current logic in Phase 0 first — it may already do more than URL matching).

**Tools:**
- Exact match: normalized URL/domain comparison (already likely present).
- Fuzzy match: `fast-fuzzy` or `string-similarity` (npm, free) on `title + org_name`.
- Semantic match: embeddings via the same Ollama embedding model chosen in Phase 2 (`nomic-embed-text` or similar), compared via `pgvector` cosine distance — catches "same internship, differently worded" cases that string matching misses.

**Tasks:**
- [ ] Implement three-tier dedup: exact URL → fuzzy title/org → embedding similarity threshold (tune threshold empirically on real duplicates found in test runs).
- [ ] On detected duplicate, merge into the canonical `opportunities` row: keep the **best** `apply_url_tier`, append all source URLs to `opportunity_sources`, don't create a second row.
- [ ] Log dedup decisions to `run_logs` for auditability (how many raw hits collapsed into how many canonical opportunities).

**Definition of Done:** running discovery for a resume that surfaces a known duplicate (same internship on a company site and a job portal) produces exactly one canonical opportunity in the output, with the official link attached.

---

### Phase 7 — Trust & Fraud Screening Gate *(new capability)*

**Objective:** Implement PDF §9/§11's trust filters — largely absent as an explicit step in the current node list.

**Keep/Change:** ADD. Rule-based first; no ML training needed for v1.

**Approach (free, no paid API):**
- Suspicious-keyword heuristics (payment/fee requests, "pay to apply", OTP/password requests, unrealistic-offer language) — maintain as an editable keyword/pattern list, not hardcoded inline, so it's easy to extend.
- Domain-organization consistency check (does the apply-domain plausibly match the stated organization name?).
- Description completeness scoring (missing role/eligibility/location info → down-rank, don't necessarily exclude).
- Optional, rate-limited: `whois-json` (npm, free) for domain-age signal — treat as a soft signal, cache aggressively, don't make it a hard dependency (WHOIS services can be flaky).
- Output is **three-way**, not binary: `trusted` / `needs_review` / `excluded` — matches PDF §11's instruction that suspicious listings should be "excluded or clearly segregated," not silently kept.

**Tasks:**
- [ ] Build the keyword/pattern heuristic module as an external, editable config file.
- [ ] Build the domain-org consistency check.
- [ ] Build description-completeness scoring.
- [ ] Wire the three-way trust classification into the `opportunities.status`/`trust_score` fields.
- [ ] Ensure `needs_review`/`excluded` items never enter the primary ranked result set (per PDF §11: "the primary student experience should not be contaminated").

**Definition of Done:** a deliberately crafted suspicious test listing (e.g., "pay ₹500 processing fee to apply") is correctly flagged `excluded` and does not appear in final output; a normal, well-formed listing is correctly classified `trusted`.

---

### Phase 8 — Freshness & Recency Verification *(new capability)*

**Objective:** Track and enforce PDF §9's recency/activity requirement.

**Keep/Change:** ADD. Reuses the existing `JobWorker`/`tick()` polling infrastructure from `job-server` — no new scheduling mechanism needed.

**Tasks:**
- [ ] Populate `first_seen_at`/`last_verified_at` on every `opportunities` write.
- [ ] Add a lightweight periodic re-verification routine (piggyback on the existing worker tick, or a separate scheduled job): HEAD-request `apply_url` for opportunities not verified in N days; mark `status='closed'` on 404/dead link, `status='stale'` if unverified beyond a threshold.
- [ ] Optional: LLM-based "is this posting still open" classification on the scraped page text (catches "position filled" text that a status-code check would miss) — reuse the same local LLM from Phase 2, no new dependency.
- [ ] Exclude/deprioritize `stale`/`closed` items from the ranked output.

**Definition of Done:** a manually-marked test opportunity with a dead `apply_url` is correctly transitioned to `status='closed'` after the verification routine runs, and is excluded from a fresh pipeline run's output.

---

### Phase 9 — Geographic & Eligibility Rules Engine

**Objective:** Formalize PDF §6 (country ratio) and §3 (eligibility by year) as explicit, testable rules — not implicit LLM judgment.

**Keep/Change:** UPGRADE "Geographic Allocator" (confirm current logic in Phase 0).

**Tools:**
- No paid geocoding API. For MVP: a static country/city keyword-matching table is sufficient (most listings state country/city as text). For broader coverage later: **GeoNames** (free, open-license gazetteer dataset, downloadable dump) for city→country resolution.

**Tasks:**
- [ ] Implement deterministic country/location extraction from opportunity text (string match against country/city gazetteer; fall back to "unknown" rather than guessing).
- [ ] Implement the 75–80% same-country allocation rule as an explicit post-ranking step (not a ranking *feature* — an allocation *constraint* per PDF §6: "if there are enough strong local results, do not force international opportunities merely to diversify").
- [ ] Implement eligibility filtering from `resumes.eligibility_tier` (Phase 2 output) per PDF §3 table: internships-only for 2nd–4th year by default; up to 3–4 fresher roles unlocked only for `4th_year_strong` AND only where the employer explicitly accepts freshers (detect from listing text).

**Definition of Done:** for an India-based very-strong 4th-year test resume, output contains predominantly India-based internships, at most 3–4 fresher roles, and any international results are verifiably remote/online; for a 2nd-year test resume, zero fresher jobs appear regardless of profile strength.

---

### Phase 10 — Resume-Opportunity Matching Engine Upgrade

**Objective:** Make matching "human-like" per PDF §5/§15 — combine semantic similarity with explainable reasoning, not keyword overlap.

**Keep/Change:** UPGRADE "Resume Match Engine" (confirm current logic in Phase 0).

**Tools:**
- Embedding similarity: resume-profile embedding (Phase 1's `resumes.profile_embedding`) vs. opportunity embedding (`opportunities.embedding`) via `pgvector` cosine similarity — cheap, fast, free, runs entirely local.
- LLM reasoning (same local model from Phase 2) for the **explanation only** — given the top-N candidates by embedding similarity, ask the LLM to produce a short "why this matches" grounded strictly in listed resume evidence (education/projects/internships/skills/achievements), per PDF §15. Constrain the prompt to only reference facts present in the structured profile, to avoid fabricated justifications.
- **Reference: `srbhr/Resume-Matcher`** (see A.5) — its ATS-style scoring + keyword-gap-analysis logic is the closest existing open-source implementation of "score a resume against one job description." It's built for a single resume-vs-single-JD comparison, so it needs to be called once per candidate opportunity (or its core scoring function extracted and reused directly) rather than adopted as a service wholesale — but reading its scoring module before writing this phase's scoring function from scratch will save real time and avoid reinventing a well-tested approach.
- Hard eligibility gate runs **before** scoring (Phase 9 output) — a role that fails eligibility should never reach the matching/ranking stage regardless of textual similarity.

**Tasks:**
- [ ] Generate and store `opportunities.embedding` at standardization time (Phase 4/5 output).
- [ ] Implement embedding-similarity scoring as the base match signal.
- [ ] Read `Resume-Matcher`'s scoring/keyword-gap module and decide: reuse its scoring function directly, or use it purely as a design reference for this phase's own implementation — document the decision either way.
- [ ] Implement the constrained "why this matches" LLM explanation step for candidates above a similarity threshold.
- [ ] Write `match_results` rows (score + explanation) per resume × opportunity.

**Definition of Done:** for a test resume with a distinctive non-technical achievement (e.g., photography), a photography/creative opportunity in the fixture data set is retrieved and its explanation correctly cites the achievement — not a generic/fabricated justification.

---

### Phase 11 — Ranking Engine Formalization

**Objective:** Implement PDF §12's weighted ranking philosophy as a transparent, tunable formula.

**Keep/Change:** UPGRADE "Parse + Rank Opportunities" (confirm current logic in Phase 0) — likely needs to move from "partial per-item scoring" to a proper aggregate ranking pass after all gates (dedup/trust/freshness/geo/match) have run.

**Approach:**
- Map PDF §12's qualitative weights to numeric multipliers, e.g.: Very high = 3, High = 2, Medium-high = 1.5, Medium = 1. Dimensions: resume/capability fit, eligibility fit, country/location fit, remote compatibility (when international), application quality/directness, trust/credibility, freshness/active status, role quality/learning value, evidence strength, source quality, diversity.
- Compute a weighted composite score per opportunity from the outputs of Phases 5–10 (each phase already produces one or more of these signals — this phase mainly **combines** them, it shouldn't need much new data collection).
- Add a diversity re-ranking pass (simple **Maximal Marginal Relevance**-style logic: penalize near-duplicate categories/orgs dominating the top of the list) — no special library needed, straightforward to implement from the embeddings already computed.

**Tasks:**
- [ ] Implement the weighted composite scoring function as an isolated, testable module (so weights can be tuned without touching pipeline plumbing).
- [ ] Implement MMR-style diversity re-ranking on top of the base ranking.
- [ ] Store final `rank_position` in `match_results`.

**Definition of Done:** for a fixture resume with both a clearly stronger and a clearly weaker matching opportunity present in the candidate pool, the stronger one ranks first; output is not dominated by 8 near-identical internships from the same two companies when more varied strong matches exist.

---

### Phase 12 — Adaptive Result Assembly & Presentation Layer

**Objective:** Implement PDF §4's adaptive-count logic and §14's presentation requirements.

**Keep/Change:** UPGRADE "Finalize Results" + "Build Response" (confirm current logic in Phase 0).

**Tasks:**
- [ ] Implement confidence-threshold-based cutoff (not fixed top-N): walk the ranked list, stop admitting results once composite score drops below a tier-appropriate confidence threshold, respecting the illustrative ranges in PDF §4's table as *guidance*, not hard quotas — a weak profile should legitimately be allowed to return just 1 result.
- [ ] Assemble final response fields per PDF §14: title, org, opportunity type, location/remote flag, apply link + tier, eligibility notes, match explanation, trust/freshness indicators, no duplicate entries.
- [ ] Explicitly tag confidence level (`discovered` / `verified` / `high-confidence`) on each result per PDF §16's requirement to preserve that distinction.

**Definition of Done:** running all five resume tiers from `test-resumes/` produces result counts broadly consistent with PDF §4's table (allowing for legitimate under-shooting when data is weak, never over-padding), and every result in the response contains all required presentation fields.

---

### Phase 13 — Safety, Privacy & Trust Labeling

**Objective:** Implement PDF §16 as explicit, checkable controls, not just a mindset.

**Tasks:**
- [ ] Audit logging (job-server's structured logger, already in place) to ensure resume text/PII is never logged in plaintext — log resume IDs, not raw content.
- [ ] Add a data-retention policy for uploaded resumes (e.g., configurable TTL, delete raw file after profile extraction if not needed longer-term) — implement as a config flag so it's easy to tighten later.
- [ ] Ensure the "confidence tagging" from Phase 12 is enforced end-to-end (no field in the API response implies verification that wasn't actually performed).
- [ ] Add a static disclaimer/check in the presentation layer: never surface a listing that requests payment/OTP/password as if it were normal (this should already be `excluded` by Phase 7, but add a defense-in-depth check at the presentation layer too).

**Definition of Done:** grep of application logs for a processed test resume shows no raw resume text; retention policy is configurable and demonstrably deletes data after the configured window in a test run.

---

### Phase 14 — Evaluation Harness, Observability & Regression Testing

**Objective:** Make every phase's DoD checkable automatically, and catch regressions as the pipeline evolves.

**Tools:** n8n's built-in **Evaluations** tab (visible in your screenshots — already available, not something to build from scratch) for workflow-level regression tests against fixed inputs/expected-output assertions. Combine with `run_logs` (Phase 1) for pipeline-level metrics.

**Tasks:**
- [ ] Scaffold immediately after Phase 1 (don't wait): create n8n Evaluation test cases using the `test-resumes/` fixtures (one per profile tier).
- [ ] Define pass/fail assertions directly from PDF tables: result-count range per tier (§4), country-ratio bounds (§6), zero duplicate `apply_url`s, `apply_url_tier` distribution skewed toward official sources, zero `excluded`-status items in final output.
- [ ] Log per-run metrics to `run_logs`: raw hits found → post-dedup count → post-trust-gate count → final returned count (a funnel view makes it easy to see which phase is over/under-filtering).
- [ ] Re-run the full eval suite after every phase from 2 onward; treat a regression against the Phase 0 baseline snapshot as a blocker, not a note.

**Definition of Done:** eval suite runs against all fixture resumes and reports pass/fail per PDF-derived assertion; funnel metrics are visible in `run_logs` for the latest run.

---

### Phase 15 — Production Hardening & Paid-API Upgrade Path *(deferred)*

**Objective:** Only after Phases 0–14 are validated on free/local infrastructure, selectively add paid providers where they add clear, measured value — never as a default.

**Tasks (do not start until explicitly requested):**
- [ ] Swap `SEARCH_PROVIDER` to Tavily/Serper (or similar) behind the existing interface from Phase 3, A/B compare result quality against SearxNG before committing.
- [ ] Optionally swap the local LLM for a hosted model (behind the existing `ai-gateway` abstraction from Phase 2) for higher-quality reasoning/explanations, again A/B compared, not blindly assumed better.
- [ ] Replace the manual "Execute workflow" trigger with a proper production trigger (webhook from `job-server`'s `onSubmit`, or a schedule trigger for periodic re-discovery).
- [ ] Add secrets management (don't commit real keys to `.env`; use the existing `.env.example` pattern properly), rate limiting, and monitoring/alerting on the `run_logs` funnel metrics.

---

## Part E — Open-Source Tooling Reference

| Function | Recommended tool | Type | Notes |
|---|---|---|---|
| PDF text extraction | `pdf-parse` / `pdfjs-dist` | npm | Likely already used by n8n's Extract-From-File node |
| Local LLM serving | Ollama | self-hosted | Free, OpenAI-compatible API, easy model swap |
| LLM models | Llama 3.1 8B / Qwen2.5 14B / Mistral Nemo | open-weight | Free via Ollama |
| Embeddings | `nomic-embed-text` / `mxbai-embed-large` | via Ollama | Free, avoids paid embedding API |
| Vector search | `pgvector` | Postgres extension | Free, reuses existing DB |
| Meta search engine | SearxNG | self-hosted (Docker) | Free, aggregates engines, no per-query key |
| Alt search + fetch provider | TinyFish (Search + Fetch APIs) | hosted, free tier | Free at any tier for Search/Fetch; official n8n node available; Agent/Browser are paid (Phase 15 only) |
| **Primary structured job/internship connector** | `speedyapply/JobSpy` (+ `rainmanjam/jobspy-api` Docker wrapper) | free, self-hosted (Python lib or Docker/REST) | 16k★+, covers Indeed/Glassdoor/Google Jobs/ZipRecruiter/Bayt/BDJobs/Naukri in one normalized schema with built-in dedup; exclude `linkedin` from `site_name` (ToS); returns full structured listings, skipping scrape+extract for these sources |
| Curated internship data feed | `SimplifyJobs/Summer2027-Internships` `listings.json` (`dev` branch) | public GitHub data | Free, auto-updated; scope is US/Canada/Remote tech internships — treat as supplementary, not primary, for non-US students |
| **Resume parsing / ATS-style matching reference** | `srbhr/Resume-Matcher` | Apache 2.0, free, self-hosted (local-Ollama-first) | 27k★, most mature open-source implementation of resume↔JD scoring found; reference/reuse its parsing and keyword-gap scoring logic for Phases 2 and 10 rather than building from zero |
| Agentic browsing (escalation tier) | `browser-use/browser-use` | MIT, self-hosted (Python) | Free with local Ollama model; used only when Playwright+Readability fails or for finding "Apply" links |
| Source-connector architecture pattern | `MadsLorentzen/ai-job-search` (pattern, not the framework itself) | reference only | One small connector per source, one shared output contract — replicate for country-specific sources |
| Full-stack architecture reference (not adopted) | `Rayyan9477/AutoApply-AI` | reference only, early-stage (32★) | Pluggable `JobPlatform` ABC + LLM-provider-fallback client are worth reading; product intent (auto-apply) differs from this plan's curated-discovery philosophy, and core features are still marked "in progress" upstream |
| Headless scraping | Playwright | npm | Already in use — keep as the default JS-rendering tier |
| Lightweight fetch | `undici` / `node-fetch` | npm | For pages that don't need JS rendering |
| Main content extraction | `@mozilla/readability` + `jsdom` | npm | Same engine as Firefox Reader View |
| robots.txt compliance | `robots-parser` | npm | Free |
| Per-domain rate limiting | `bottleneck` | npm | Free |
| Fuzzy string matching | `fast-fuzzy` / `string-similarity` | npm | For title/org dedup |
| Domain-age signal | `whois-json` | npm | Optional, soft signal only, cache aggressively |
| Geo gazetteer | GeoNames dump | static dataset | Free, open license |
| Schema migrations | `node-pg-migrate` | npm | Versioned Postgres schema |
| Regression testing | n8n Evaluations tab | built-in | Already available in your instance |

---

## Part F — Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Anti-bot blocking on scrape targets | robots.txt compliance, per-domain rate limiting, prefer official sources over scraping restrictive portals |
| ToS exposure (esp. LinkedIn) | Hard-block direct LinkedIn scraping in code; use only as a discovery signal, always resolve to official link anyway |
| Local LLM lower ceiling than hosted models | Strong schema-constrained prompting + validation/repair; accept lower ceiling during free-dev phase; budget for Phase 15 upgrade |
| SearxNG instance gets rate-limited/blocked upstream | Reasonable query pacing, mix of backend engines, fallback to targeted `site:` queries against seed domains |
| Trust screening false positives/negatives | Three-way classification (`trusted`/`needs_review`/`excluded`) instead of binary, human-auditable `needs_review` bucket |
| Schema churn as requirements evolve | `node-pg-migrate` from Phase 1 onward — every change is a reviewable migration |
| Scope creep across 16 phases | Strict phase gating — DoD must pass on fixtures before next phase starts |
| SimplifyJobs `listings.json` reuse terms are unwritten | Use as a dev-time/reference data source; before treating it as a permanent production feed, check current repo guidelines/contact maintainers; never present it to students as your own original discovery without attribution |
| SimplifyJobs data is US/Canada/Remote-only | Don't let it dominate a non-US student's result set — it only ever feeds the "genuinely remote/international" slice per PDF §6, gated the same as any other international source |
| `browser-use` agent runs are slower/costlier (in compute) than a plain fetch | Use strictly as an escalation tier (Phase 4/5), never the default path; cap step budget per task |
| TinyFish's free tier is a business decision by a third party, not a guarantee | Keep it behind the same provider interface as SearxNG so it can be demoted to optional/removed without touching pipeline logic if terms change |
| Internshala and similar large India portals are anti-bot-hardened (evidenced by hobby scrapers needing stolen login cookies) | Don't invest engineering effort defeating their bot protection; treat as last-resort trusted-third-party fallback per PDF §8, prioritize the government/university/company connectors instead |
| `JobSpy` scrapes LinkedIn by default alongside the other seven boards | Explicitly exclude `linkedin` from `site_name` in every call — this is a config setting, not a code change, so it's easy to get wrong during a refactor; add a test that asserts no LinkedIn results ever reach the pipeline |
| `JobSpy`'s non-LinkedIn boards (Indeed, Glassdoor, etc.) can also rate-limit/block aggressively per its own documentation | Respect its built-in guidance (`results_wanted`, `hours_old`, proxy support); treat a blocked board as "temporarily unavailable," not a pipeline failure — the source-connector pattern means other connectors keep working |
| `Resume-Matcher`'s scoring approach is built for one-resume-vs-one-JD, not one-resume-vs-many-ranked-opportunities | Treat it as a reference/reusable module for the scoring *function*, not a service to call as-is; Phase 10 still owns the loop, thresholding, and integration with eligibility/trust/freshness gates |

---

## Part G — Immediate Next Steps

1. Review this plan (now v1.2 — OSS findings in Part A.5, folded into Phases 2, 3, 4, 5, and 10); flag any phase you want reordered, merged, or dropped.
2. Execute **Phase 0** with your coding agent. Its sole deliverable is `docs/current-state-audit.md` — no pipeline changes yet.
3. Bring the Phase 0 audit back for review (especially the Part A.4 architecture decision) before Phase 1 begins.
4. If you find more candidate open-source resources as you go, bring them back the same way you did here — a link/repo name is enough, I'll research and fold in the finding rather than you having to evaluate it yourself.
