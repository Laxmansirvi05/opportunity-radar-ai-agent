-- 007_event_log.sql
--
-- Append-only event log: the boundary between this system and Opportunity Radar.
--
-- Design notes (FINAL_ARCHITECTURE.md § 55, § 57):
--   "The event log: append-only, the only interface Opportunity Radar consumes
--    from — never queried directly against the relational store by an external
--    system."
--
--   "The Discovery Agent publishes a structured, versioned JSON event ...
--    Radar persists this on its own schema and its own terms."
--
-- Implementation rules enforced by this schema:
--   1. APPEND-ONLY: There is intentionally no UPDATE-friendly structure here.
--      Never issue UPDATE or DELETE against this table.  Mark events as
--      superseded by publishing a new event with a 'supersedes_event_id'
--      field inside payload_json, not by mutating an existing row.
--   2. VERSIONED: schema_version must be incremented when the payload
--      structure changes, so Opportunity Radar can maintain backward
--      compatibility across its own consumption window.
--   3. DECOUPLED: Opportunity Radar reads from this log via a versioned
--      API/subscription.  It NEVER receives a direct database connection.
--
-- This table is reserved for the Event Publication component (Sprint 5).
-- It is created now so its schema is stable and can be referenced in the
-- architecture before the publisher is implemented.
--
-- subscriber_ack_at: Optional timestamp set when Opportunity Radar has
-- confirmed receipt.  Null = not yet consumed or acknowledgement not tracked.

CREATE TABLE IF NOT EXISTS event_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        TEXT        NOT NULL,
  schema_version    TEXT        NOT NULL DEFAULT '1.0.0',
  payload_json      JSONB       NOT NULL DEFAULT '{}',
  candidate_id      UUID        REFERENCES candidates(id) ON DELETE SET NULL,
  run_id            UUID,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  subscriber_ack_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_log_event_type
  ON event_log (event_type, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_log_run_id
  ON event_log (run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_log_candidate_id
  ON event_log (candidate_id, published_at DESC)
  WHERE candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_log_unacked
  ON event_log (published_at ASC)
  WHERE subscriber_ack_at IS NULL;
