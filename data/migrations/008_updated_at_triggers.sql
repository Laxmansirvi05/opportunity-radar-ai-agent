-- 008_updated_at_triggers.sql
--
-- Adds automatic updated_at maintenance to tables that have mutable rows.
--
-- Problem being solved:
--   PostgreSQL does NOT auto-update column values on UPDATE.  Without a
--   trigger, the updated_at column on candidates, opportunities, and
--   review_queue always equals created_at, making it useless for:
--     • Change-detection in the re-validation job (opportunities.updated_at)
--     • Profile freshness tracking (candidates.updated_at)
--     • Review SLA measurement (review_queue.updated_at)
--
-- Design:
--   A single reusable trigger function (set_updated_at) is shared across
--   tables.  This avoids duplicating the same one-liner into per-table
--   functions and makes future audits simpler.
--
--   CREATE OR REPLACE FUNCTION: idempotent — safe if ever re-run manually.
--   CREATE TRIGGER: NOT idempotent, but the migration runner's tracking
--   table guarantees this file is only executed once.
--
-- Tables NOT covered (by design):
--   ranking_results — immutable once written; no UPDATE path exists.
--   dedup_signatures — immutable; dedup entries are append-only.
--   event_log        — append-only by contract; must never be updated.
--   schema_migrations — internal runner table; never updated by app code.

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- candidates
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_candidates_set_updated_at
  BEFORE UPDATE ON candidates
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- opportunities
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_opportunities_set_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- review_queue
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_review_queue_set_updated_at
  BEFORE UPDATE ON review_queue
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
