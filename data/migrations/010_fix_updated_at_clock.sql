-- 010_fix_updated_at_clock.sql
--
-- Changes the set_updated_at() trigger function to use clock_timestamp()
-- instead of now().
--
-- Why this matters:
--   now() returns the timestamp at the START of the current transaction.
--   If an INSERT and the subsequent UPDATE happen in the same transaction
--   (e.g. an upsert with ON CONFLICT DO UPDATE), updated_at will equal
--   created_at even though the row was genuinely updated.
--
--   clock_timestamp() returns the CURRENT wall-clock time at the moment the
--   function executes — independent of when the transaction started.  This
--   guarantees that updated_at is always >= created_at and strictly greater
--   when the update happens in a later transaction.
--
-- Impact:
--   Affects candidates, opportunities, and review_queue (the three tables
--   that have the trg_*_set_updated_at trigger).
--
-- CREATE OR REPLACE FUNCTION replaces the existing function in-place without
-- needing to drop and re-create the triggers that reference it.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- clock_timestamp() is the actual wall-clock time, not the transaction
  -- start time.  This ensures updated_at > created_at even when INSERT and
  -- UPDATE occur within the same transaction.
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
