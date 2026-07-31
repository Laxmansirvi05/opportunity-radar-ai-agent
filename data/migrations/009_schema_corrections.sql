-- 009_schema_corrections.sql
--
-- Corrects two categories of issues identified in Sprint 1 QA:
--
-- 1. DUPLICATE INDEXES
--    When a column is declared UNIQUE, PostgreSQL automatically creates a
--    unique B-tree index to enforce the constraint.  Explicitly creating an
--    additional plain index on the same column results in:
--      • Double write overhead on every INSERT / UPDATE / DELETE.
--      • Double storage consumption for the indexed column.
--      • No query-planning benefit — the planner uses the unique constraint
--        index first and ignores the redundant index.
--
--    Affected indexes (safe to drop; the UNIQUE constraint index remains):
--      candidates:       idx_candidates_resume_hash     (duplicates candidates_resume_hash_key)
--      opportunities:    idx_opportunities_content_hash (duplicates opportunities_content_hash_key)
--      dedup_signatures: idx_dedup_signatures_signature_hash
--                                                      (duplicates dedup_signatures_signature_hash_key)
--
-- 2. MISSING RANGE CONSTRAINT ON final_rank
--    ranking_results.final_rank is an unconstrained INTEGER.
--    Rank 0 or negative values are meaningless in the context of this system
--    and would produce incorrect ordering in queries.  Adding CHECK (final_rank >= 1)
--    enforces the business rule at the database level.
--
--    Note: ranking_results has no rows yet so the constraint is added without
--    a table scan.  This migration adds a NOT VALID clause for correctness on
--    systems where this migration might run against populated tables in future
--    re-deployments — NOT VALID allows the constraint to be added without
--    a full-table scan, and it can later be validated with VALIDATE CONSTRAINT.
--
-- Both changes are transactional (wrapped in BEGIN/COMMIT by the runner).

-- ---------------------------------------------------------------------------
-- 1. Drop redundant plain indexes (UNIQUE constraint indexes still enforce
--    uniqueness and are used by the query planner).
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS idx_candidates_resume_hash;
DROP INDEX IF EXISTS idx_opportunities_content_hash;
DROP INDEX IF EXISTS idx_dedup_signatures_signature_hash;

-- ---------------------------------------------------------------------------
-- 2. Add lower-bound constraint on ranking_results.final_rank.
-- ---------------------------------------------------------------------------

ALTER TABLE ranking_results
  ADD CONSTRAINT chk_ranking_results_final_rank_positive
  CHECK (final_rank >= 1) NOT VALID;

-- Immediately validate since the table is empty at this migration point.
-- This is a no-op on an empty table but documents intent and allows
-- future scripts to know the constraint is trusted for existing rows.
ALTER TABLE ranking_results
  VALIDATE CONSTRAINT chk_ranking_results_final_rank_positive;
