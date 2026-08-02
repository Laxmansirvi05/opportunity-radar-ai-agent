# REPOSITORY AUDIT

**Date:** 2026-08-02
**Scope:** Read-only factual audit of the current repository state.

---

## 1. SERVICE INVENTORY

### `ai-gateway`
- **Purpose:** Routes prompt extraction requests to various LLM providers with fallback logic.
- **Entry point:** `server.js` (started via `node server.js`)
- **Status:** Runnable as-is (Express server).
- **Ports:** Listens on `4000`. Connects to external LLM provider APIs (Groq, OpenRouter, Gemini).
- **Service calls:** None (does not call other internal services).

### `data`
- **Purpose:** Shared library containing PostgreSQL schemas, Redis clients, and repository patterns.
- **Entry point:** `src/index.js` (no start script).
- **Status:** Not a standalone service. Acts as a shared module.
- **Ports:** Connects to PG (`5432`) and Redis (`6379`).
- **Service calls:** Database/Redis connections only.

### `execution-fabric`
- **Purpose:** Dispatches crawling/extraction jobs to workers and handles timeouts/retries.
- **Entry point:** `src/index.js` (no start script).
- **Status:** **Stub/Library**. It lacks an HTTP server (Express boundary) to be triggered externally. Not runnable as a standalone service.
- **Ports:** Connects to PG (`5432`) and Redis (`6379`).
- **Service calls:**
  - `render-service` at `http://localhost:3000` (`RENDER_SERVICE_URL`)
  - `ai-gateway` at `http://localhost:4000` (`GATEWAY_URL`)

### `playwright`
- **Purpose:** Old monolithic headless browser server.
- **Entry point:** `server.js` (no start script).
- **Status:** Runnable, but it is an orphaned stub superseded by `render-service`.
- **Ports:** Listens on `3000`.
- **Service calls:** None.

### `profile-builder`
- **Purpose:** Validates resumes and extracts Candidate Intelligence Profiles via AI.
- **Entry point:** `src/index.js` (no start script).
- **Status:** Not a standalone service. Acts as a shared module.
- **Ports:** Connects to PG (`5432`) and Redis (`6379`).
- **Service calls:**
  - `ai-gateway` at `http://localhost:4000` (`GATEWAY_BASE_URL`)

### `render-service`
- **Purpose:** Production-grade headless browser rendering service with proxy and IP blocking.
- **Entry point:** `src/index.js` (started via `node src/index.js`)
- **Status:** Runnable as-is.
- **Ports:** Listens on `3000`.
- **Service calls:** None (only outward internet).

### `search-planner`
- **Purpose:** Converts candidate profiles into platform-specific search queries.
- **Entry point:** `src/index.js` (no start script).
- **Status:** Not a standalone service. Acts as a shared module.
- **Ports:** None.
- **Service calls:** None.

---

## 2. INTER-SERVICE CONNECTIONS

- **`execution-fabric` -> `render-service`**: Calls `http://localhost:3000`. Matches `render-service` config.
- **`execution-fabric` -> `ai-gateway`**: Calls `http://localhost:4000`. Matches `ai-gateway` config.
- **`profile-builder` -> `ai-gateway`**: Calls `http://localhost:4000`. Matches `ai-gateway` config.
- **FLAG / MISMATCH**: `docker-compose.yml` sets up `postgres` and `redis` as container hostnames, but all `.env.example` files default to `localhost`. If deploying via Docker, the services will fail to resolve the databases unless `.env` overrides are explicitly managed.

---

## 3. IMPLEMENTATION STATUS

- **`ai-gateway`**: **Implemented** (working code).
- **`data`**: **Implemented** (working code).
- **`execution-fabric`**: **Implemented (Internal logic)** but **Placeholder/Stub (API Boundary)**. Missing the HTTP server wrapper.
- **`playwright`**: **Stub** (orphan).
- **`profile-builder`**: **Implemented (Internal logic)** but missing HTTP server wrapper if it is meant to be a microservice.
- **`render-service`**: **Implemented** (working code).
- **`search-planner`**: **Implemented (Internal logic)** but missing HTTP server wrapper if meant to be a microservice.
- **`ranking-engine`**: **Missing entirely**.
- **`verification-pipeline`**: **Missing entirely**.

---

## 4. DOCUMENTATION AUDIT

| File | Description | Last Modified | Flag |
| :--- | :--- | :--- | :--- |
| `CURRENT_PROJECT_STATUS.md` | Snapshot of project status from Aug 2. | Aug 2, 2026 | |
| `FINAL_ARCHITECTURE.md` | Original architecture design document. | Jul 31, 2026 | ⚠️ Superseded by V2 / PRODUCTION_ARCHITECTURE |
| `FINAL_ARCHITECTURE_REVIEW.md` | AI architect's critique of the architecture. | Aug 2, 2026 | |
| `FINAL_PRODUCTION_ARCHITECTURE.md` | The definitive, updated production pipeline design. | Aug 2, 2026 | |
| `IMPLEMENTATION_PLAN.md` | Initial sprint and execution plan. | Jul 31, 2026 | ⚠️ Superseded by V2 |
| `IMPLEMENTATION_PLAN_V2.md` | Updated sprint plan reflecting current modular refactoring. | Jul 31, 2026 | |
| `PROJECT_AUDIT.md` | The very first evaluation of the repo state from Jul 30. | Jul 30, 2026 | |
| `REPOSITORY_VERIFICATION.md` | A fact-checked verification of the CURRENT_PROJECT_STATUS. | Aug 2, 2026 | |

---

## 5. DEAD / UNUSED FILES

- `playwright/server.js` and `playwright/package.json`: A superseded monolithic stub of the Playwright service. Fully replaced by the `render-service` folder.
- `agent/ai-gateway/`: An empty, orphaned directory tree.
- `dump.rdb`: A leftover Redis persistence dump file.

---

## 6. ENVIRONMENT & CONFIG STATUS

| File | Expected Variables | Actual Config Status |
| :--- | :--- | :--- |
| `.env.example` (root) | Master template containing all vars. | N/A (template) |
| `render-service/.env` | `PORT`, `HOST`, `API_KEY`, tuning flags. | **Filled in** |
| `ai-gateway/.env` | `PORT`, `GATEWAY_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` | **Filled in** |
| `execution-fabric/.env` | `PGHOST`, `PGPASSWORD`, `REDIS_URL`, `RENDER_SERVICE_URL`, `GATEWAY_URL` | **MISSING** (Only `.env.example` exists) |
| `data/.env` | `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `REDIS_*`, `EMBEDDING_*` | **Filled in** |
| `profile-builder/.env` | `GATEWAY_BASE_URL`, `GATEWAY_API_KEY`, `PGHOST`, `PGPASSWORD`, `REDIS_*` | **Filled in** |

---

## 7. WHAT'S MISSING TO CALL THIS A WORKING BACKEND

1. **API Boundaries:** `execution-fabric`, `profile-builder`, and `search-planner` are just JavaScript modules. They export functions but lack HTTP server wrappers (like Express) required to be called by external orchestrators (n8n).
2. **Control Plane / Orchestrator:** The `n8n` workflows (the actual JSON exports) are not committed to the repository, leaving the system with no driver to link these services together.
3. **Execution Fabric State:** The execution fabric relies entirely on local memory (Promise pool) rather than a distributed queue (e.g., BullMQ), meaning it cannot scale beyond one process or survive restarts.
4. **Missing Intelligence Services:** The Ranking Engine and Verification Pipeline do not exist in the codebase.
5. **Git Staging:** Migrations 011 and 012, along with the `search-planner` and `execution-fabric` modules, are currently sitting as untracked files in the Git working directory.
