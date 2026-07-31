-- 006_dedup_signatures.sql
--
-- Semantic deduplication index for post-extraction duplicate detection.
--
-- Design notes:
--   - This table implements FINAL_ARCHITECTURE.md § 25 "semantic dedup
--     (post-extraction)": catches reworded/reposted duplicates that are
--     invisible at the raw-content level (different HTML, same opportunity).
--   - signature_hash is a deterministic hash of the normalised extracted
--     fields (title + company + location + employment_type) used as a
--     fast exact-match pre-filter before running vector similarity.
--   - embedding stores a dense vector over the full structured extracted
--     opportunity (not raw HTML) for cosine similarity comparison.
--   - Foreign key to opportunities ON DELETE CASCADE so signature rows
--     are automatically cleaned up when an opportunity is removed.
--   - No TTL column here: the rolling-window semantics described in
--     FINAL_ARCHITECTURE.md § 54 ("semantic dedup index: rolling window")
--     are enforced at query time by the Semantic Dedup component via a
--     created_at filter, not by a separate expiry column.

CREATE TABLE IF NOT EXISTS dedup_signatures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  UUID        NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  signature_hash  TEXT        NOT NULL UNIQUE,
  embedding       vector({EMBEDDING_DIM}),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dedup_signatures_signature_hash
  ON dedup_signatures (signature_hash);

CREATE INDEX IF NOT EXISTS idx_dedup_signatures_opportunity_id
  ON dedup_signatures (opportunity_id);

CREATE INDEX IF NOT EXISTS idx_dedup_signatures_created_at
  ON dedup_signatures (created_at DESC);

-- NOTE: A vector similarity index (IVFFlat or HNSW) should be added in a
-- subsequent migration AFTER the table has accumulated sufficient data.
-- Building such an index on an empty table produces a suboptimal index
-- structure.  A future migration will execute:
--   CREATE INDEX idx_dedup_signatures_embedding ON dedup_signatures
--     USING hnsw (embedding vector_cosine_ops);
