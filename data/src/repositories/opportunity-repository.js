'use strict';

/**
 * opportunity-repository.js
 *
 * Persistence layer for the opportunities table.
 *
 * Design notes (FINAL_ARCHITECTURE.md § 25):
 *   - content_hash is the pre-LLM dedup key.  Upsert on conflict is the
 *     only correct write path — INSERT + ON CONFLICT ensures idempotency.
 *   - embedding column is intentionally excluded here; it will be populated
 *     by the Semantic Matching Engine in Sprint 4.
 *   - quality_score is excluded; populated by the Ranking Engine in Sprint 4.
 *   - raw_json stores the full validated extraction payload for auditability.
 *   - All filtering, sorting and pagination is the responsibility of callers
 *     — this repository is data-access only, not business logic.
 *
 * All database access goes through the shared Data Plane pool (data/src/db.js).
 * No SQL lives outside this file.
 */

const { getPool } = require('../db');

/**
 * Upsert a validated opportunity.
 *
 * On conflict with an existing content_hash:
 *   - Updates status and updated_at (to mark it re-verified).
 *   - Does NOT overwrite raw_json, apply_url, title, or other immutable fields
 *     — if the content hash matches, the content is identical.
 *
 * @param {object} opportunity
 * @returns {Promise<{ id: string, isNew: boolean }>}
 */
async function upsertOpportunity({
  sourceUrl,
  sourceTier = 'C',
  contentHash,
  title,
  company,
  location,
  workplaceType = 'unknown',
  employmentType = 'unknown',
  description,
  requirements = [],
  skills = [],
  applyUrl,
  deadline,
  compensationRaw,
  rawJson = {},
}) {
  const pool = getPool();

  const { rows } = await pool.query(
    `INSERT INTO opportunities
       (source_url, source_tier, content_hash, title, company, location,
        workplace_type, employment_type, description, requirements, skills,
        apply_url, deadline, compensation_raw, raw_json, status, last_verified_at)
     VALUES
       ($1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10::jsonb, $11::jsonb,
        $12, $13, $14, $15::jsonb, 'active', now())
     ON CONFLICT (content_hash) DO UPDATE
       SET status           = 'active',
           updated_at       = now(),
           last_verified_at = now(),
           verification_failures = 0
     RETURNING id,
               (xmax = 0) AS is_new`,
    [
      sourceUrl, sourceTier, contentHash, title, company, typeof location === 'object' && location !== null ? JSON.stringify(location) : location,
      workplaceType, employmentType, description,
      JSON.stringify(requirements), JSON.stringify(skills),
      applyUrl, deadline || null, compensationRaw || null,
      JSON.stringify(rawJson),
    ]
  );

  return { id: rows[0].id, isNew: rows[0].is_new };
}

/**
 * Check if an opportunity with the given content hash already exists.
 * Used by the validator for pre-LLM dedup.
 *
 * @param {string} contentHash
 * @returns {Promise<string|null>} — opportunity UUID or null
 */
async function findOpportunityByContentHash(contentHash) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id FROM opportunities WHERE content_hash = $1 LIMIT 1`,
    [contentHash]
  );
  return rows[0]?.id || null;
}

/**
 * Retrieve a full opportunity record by UUID.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getOpportunityById(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM opportunities WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Retrieve up to `limit` opportunities that haven't been verified in `days` days
 * and are still 'active'.
 * Uses idx_opportunities_active_unverified.
 *
 * @param {number} days
 * @param {number} limit
 * @returns {Promise<Array<{ id: string, apply_url: string, verification_failures: number }>>}
 */
async function getStaleOpportunities(days, limit = 10) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, apply_url, verification_failures FROM opportunities 
     WHERE status = 'active' 
       AND (last_verified_at IS NULL OR last_verified_at < now() - interval '1 day' * $1)
     ORDER BY last_verified_at ASC NULLS FIRST
     LIMIT $2`,
    [days, limit]
  );
  return rows;
}

/**
 * Update the verification timestamp, status, and failure count.
 *
 * @param {string} id
 * @param {string} status - e.g. 'active' or 'expired'
 * @param {number} [failures=0] - number of consecutive failures
 * @returns {Promise<void>}
 */
async function updateVerification(id, status, failures = 0) {
  const pool = getPool();
  await pool.query(
    `UPDATE opportunities 
     SET status = $1, last_verified_at = now(), updated_at = now(), verification_failures = $3
     WHERE id = $2`,
    [status, id, failures]
  );
}

module.exports = Object.freeze({
  upsertOpportunity,
  findOpportunityByContentHash,
  getOpportunityById,
  getStaleOpportunities,
  updateVerification,
});
