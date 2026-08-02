-- 012_execution_runs.sql
--
-- Stores execution run metadata produced by the Execution Fabric.
--
-- Design notes (FINAL_ARCHITECTURE.md § 7 Execution Plane):
--   - One row per call to executeSearchPlan().
--   - search_plan_id references the exact immutable plan version executed,
--     enabling deterministic replay and regression comparison.
--   - provider_stats: per-provider timing/error counts { "greenhouse": {
--     requestCount, successCount, failureCount, avgDurationMs }, ... }
--   - error_log: append-only array of { queryId, providerName, error,
--     code, attempt, timestamp } — structured, never free-text.
--   - duration_ms is NULL until the run completes/fails (completed_at set).
--   - 'partial' status: at least one worker succeeded, at least one failed.
--     Distinguished from 'failed' (all workers failed) and 'completed'
--     (all workers either succeeded or cleanly skipped duplicates).
--   - updated_at trigger applied from migration 008 for real-time monitoring.

BEGIN;

CREATE TABLE IF NOT EXISTS execution_runs (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id         UUID         NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  search_plan_id       UUID         NOT NULL REFERENCES search_plans(id),
  status               TEXT         NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  opportunities_found  INTEGER      NOT NULL DEFAULT 0
                       CHECK (opportunities_found >= 0),
  queries_total        INTEGER      NOT NULL DEFAULT 0
                       CHECK (queries_total >= 0),
  queries_completed    INTEGER      NOT NULL DEFAULT 0
                       CHECK (queries_completed >= 0),
  queries_failed       INTEGER      NOT NULL DEFAULT 0
                       CHECK (queries_failed >= 0),
  provider_stats       JSONB        NOT NULL DEFAULT '{}',
  error_log            JSONB        NOT NULL DEFAULT '[]',
  started_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  duration_ms          INTEGER      CHECK (duration_ms >= 0),
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Apply the project-standard updated_at trigger.
CREATE TRIGGER set_updated_at_execution_runs
  BEFORE UPDATE ON execution_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Fast lookup: all runs for a candidate, newest first.
CREATE INDEX IF NOT EXISTS idx_execution_runs_candidate_id
  ON execution_runs (candidate_id, created_at DESC);

-- Lookup by search plan for reproducibility audits.
CREATE INDEX IF NOT EXISTS idx_execution_runs_search_plan_id
  ON execution_runs (search_plan_id);

-- Monitor in-flight runs.
CREATE INDEX IF NOT EXISTS idx_execution_runs_running
  ON execution_runs (started_at ASC)
  WHERE status = 'running';

COMMIT;
