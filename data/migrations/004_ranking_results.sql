-- 004_ranking_results.sql
--
-- Stores per-candidate ranking results from each discovery run.
--
-- Design notes:
--   - run_id groups all results from one execution of the discovery pipeline,
--     allowing historical runs to be compared and individual runs replayed.
--   - quality_score and fit_score are stored independently (not only the
--     combined final_score) so the weighting can be re-audited post-hoc
--     and changed without losing the underlying signals.  This is the
--     "versioned weights" requirement from FINAL_ARCHITECTURE.md § 27.
--   - weights_version tracks which weighting config produced this result,
--     aligning with FINAL_ARCHITECTURE.md § 7 "versioned everything".
--   - explanation_json holds the structured explanation produced by the
--     Explainability Engine (§ 29) — the same signals that drove the score,
--     not a separately-generated narrative.
--   - UNIQUE(run_id, candidate_id, opportunity_id) prevents duplicate
--     scoring rows for the same candidate-opportunity pair within one run
--     even if the pipeline retries a segment.

CREATE TABLE IF NOT EXISTS ranking_results (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           UUID        NOT NULL,
  candidate_id     UUID        NOT NULL REFERENCES candidates(id)   ON DELETE CASCADE,
  opportunity_id   UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  quality_score    NUMERIC(5,2) NOT NULL,
  fit_score        NUMERIC(5,2) NOT NULL,
  final_score      NUMERIC(5,2) NOT NULL,
  final_rank       INTEGER     NOT NULL,
  explanation_json JSONB       NOT NULL DEFAULT '{}',
  weights_version  TEXT        NOT NULL DEFAULT '1.0.0',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (run_id, candidate_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_ranking_results_run_id
  ON ranking_results (run_id);

CREATE INDEX IF NOT EXISTS idx_ranking_results_candidate_latest
  ON ranking_results (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ranking_results_opportunity
  ON ranking_results (opportunity_id);
