-- 003_opportunities.sql
--
-- Stores extracted, schema-validated job/fellowship/internship opportunities.
--
-- Design notes:
--   - content_hash (SHA-256 of normalised extracted fields) is the pre-LLM
--     dedup key.  It corresponds to FINAL_ARCHITECTURE.md § 25 "content-hash
--     dedup (pre-LLM)".  Identical mirrored postings share the same hash and
--     produce an upsert rather than a duplicate row.
--   - source_url is the URL the content was fetched from (may differ from
--     apply_url; both are stored).
--   - source_tier maps to FINAL_ARCHITECTURE.md § 18 (A/B/C/D).
--   - raw_json stores the full validated JSON from the AI Gateway extraction
--     for auditability without needing to re-fetch.
--   - embedding uses {EMBEDDING_DIM} (runner-substituted) matching the
--     candidates table so cosine similarity queries can be run across both.
--   - quality_score is computed by the Ranking Engine (§ 32); stored here so
--     it is available without re-scoring on every query.
--   - last_verified_at implements FINAL_ARCHITECTURE.md § 37 (freshness).
--     NULL = never verified by the re-validation job (fresh from extraction).
--   - fraud_flagged / scam_flagged are independent booleans matching the two
--     distinct detection stages (§ 35, § 36); collapsing them into one field
--     would make independent tuning and audit harder.

CREATE TABLE IF NOT EXISTS opportunities (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url       TEXT        NOT NULL,
  source_tier      TEXT        NOT NULL DEFAULT 'C'
                     CHECK (source_tier IN ('A', 'B', 'C', 'D')),
  content_hash     TEXT        NOT NULL UNIQUE,
  title            TEXT,
  company          TEXT,
  location         TEXT,
  workplace_type   TEXT
                     CHECK (workplace_type IN ('remote', 'hybrid', 'onsite', 'unknown')),
  employment_type  TEXT
                     CHECK (employment_type IN ('internship', 'full-time', 'part-time',
                                               'contract', 'temporary', 'unknown')),
  description      TEXT,
  requirements     JSONB       NOT NULL DEFAULT '[]',
  skills           JSONB       NOT NULL DEFAULT '[]',
  apply_url        TEXT,
  deadline         DATE,
  compensation_raw TEXT,
  raw_json         JSONB       NOT NULL DEFAULT '{}',
  embedding        vector({EMBEDDING_DIM}),
  quality_score    NUMERIC(5,2),
  status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive', 'flagged', 'expired')),
  fraud_flagged    BOOLEAN     NOT NULL DEFAULT false,
  scam_flagged     BOOLEAN     NOT NULL DEFAULT false,
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_content_hash
  ON opportunities (content_hash);

CREATE INDEX IF NOT EXISTS idx_opportunities_source_url
  ON opportunities (source_url);

CREATE INDEX IF NOT EXISTS idx_opportunities_status
  ON opportunities (status);

CREATE INDEX IF NOT EXISTS idx_opportunities_company
  ON opportunities (company)
  WHERE company IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opportunities_active_unverified
  ON opportunities (last_verified_at ASC NULLS FIRST)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_opportunities_created_at
  ON opportunities (created_at DESC);
