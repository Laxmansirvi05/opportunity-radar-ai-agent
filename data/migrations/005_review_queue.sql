-- 005_review_queue.sql
--
-- Human-in-the-loop review queue for flagged items.
--
-- Design notes:
--   - The review queue is the Control Plane's responsibility per
--     FINAL_ARCHITECTURE.md § 53: n8n surfaces DLQ items and fraud/scam flags
--     to human reviewers; the Execution Plane routes items here and never
--     blocks on human review.
--   - item_type discriminates the review reason so queue consumers can
--     filter and prioritize (fraud/scam flags are higher priority than
--     low-confidence extraction).
--   - payload_json stores the full item context (opportunity JSON, error
--     details, etc.) so reviewers do not need to query other tables.
--   - status transitions: pending → in_review → resolved | dismissed.
--     'in_review' is set when a reviewer claims an item (prevents double-work).
--   - resolved_at enables SLA tracking on review throughput.

CREATE TABLE IF NOT EXISTS review_queue (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type        TEXT        NOT NULL
                     CHECK (item_type IN (
                       'fraud_flag',
                       'scam_flag',
                       'low_confidence_extraction',
                       'parsing_failure',
                       'hallucination_flag',
                       'dlq_item'
                     )),
  payload_json     JSONB       NOT NULL DEFAULT '{}',
  reason           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'in_review', 'resolved', 'dismissed')),
  assigned_to      TEXT,
  resolution_note  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_review_queue_pending
  ON review_queue (item_type, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_review_queue_status
  ON review_queue (status, created_at);
