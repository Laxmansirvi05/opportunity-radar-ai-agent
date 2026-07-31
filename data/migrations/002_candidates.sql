-- 002_candidates.sql
--
-- Stores versioned Candidate Intelligence Profiles.
--
-- Design notes:
--   - resume_hash (SHA-256 of raw resume bytes) is the natural dedup key.
--     Uploading the same resume twice produces an upsert, not a duplicate row.
--   - profile_json holds the full structured profile produced by the Profile
--     Builder.  It is stored as JSONB for queryability (partial index on
--     career_stage, etc.) and versioned via profile_schema_version so
--     historical profiles remain readable as the schema evolves.
--   - embedding dimension is injected at migration time from EMBEDDING_DIM
--     env var via the migration runner's template substitution.
--     {EMBEDDING_DIM} is replaced before this SQL is executed.
--     CHANGING THIS AFTER MIGRATION REQUIRES A NEW ALTER TABLE MIGRATION.
--   - status = 'deleted' soft-deletes a candidate (GDPR deletion path)
--     without cascading hard deletes that would corrupt ranking history.

CREATE TABLE IF NOT EXISTS candidates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_hash           TEXT        NOT NULL UNIQUE,
  raw_resume_path       TEXT,
  profile_json          JSONB       NOT NULL DEFAULT '{}',
  profile_schema_version TEXT       NOT NULL DEFAULT '1.0.0',
  profile_model_version TEXT        NOT NULL DEFAULT 'unknown',
  career_stage          TEXT,
  embedding             vector({EMBEDDING_DIM}),
  status                TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'deleted')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidates_resume_hash
  ON candidates (resume_hash);

CREATE INDEX IF NOT EXISTS idx_candidates_status
  ON candidates (status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_candidates_created_at
  ON candidates (created_at DESC);
