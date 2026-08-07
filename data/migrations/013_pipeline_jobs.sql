-- 013_pipeline_jobs.sql
--
-- Backing store for the job server (POST /api/jobs -> GET /api/jobs/:id).
--
-- Design notes:
--   - One row per submitted resume. The row IS the job; there is no separate
--     queue. Concurrency is limited to 1, so "the next job" is simply the
--     oldest queued row.
--   - Deliberately NOT linked to candidates(id): the pipeline is stateless and
--     never persists a candidate, so a foreign key here would make every
--     submission fail the way search_plans.candidate_id does.
--   - result holds the locked API_CONTRACT.md §1 payload verbatim once complete.
--   - error holds { code, message } — structured, never free-text, matching the
--     contract's §5 error shape.
--   - started_at is what the stuck-job sweeper reasons about: a row in
--     'running' whose started_at is older than the stuck threshold is swept to
--     'failed' with code PIPELINE_TIMEOUT.
--   - resume_filename/resume_bytes are kept for diagnostics; the PDF itself is
--     written to disk by the server and is not stored in the database.
--   - updated_at trigger applied from migration 008.

BEGIN;

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  status           TEXT         NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  resume_filename  TEXT,
  resume_bytes     INTEGER      CHECK (resume_bytes IS NULL OR resume_bytes >= 0),
  resume_path      TEXT,
  result           JSONB,
  error            JSONB,
  attempts         INTEGER      NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The sweeper scans running jobs by age; the worker picks the oldest queued job.
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status_created
  ON pipeline_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_running_started
  ON pipeline_jobs (started_at)
  WHERE status = 'running';

-- Reuse the shared updated_at trigger installed by migration 008.
DROP TRIGGER IF EXISTS set_updated_at_pipeline_jobs ON pipeline_jobs;
CREATE TRIGGER set_updated_at_pipeline_jobs
  BEFORE UPDATE ON pipeline_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;
