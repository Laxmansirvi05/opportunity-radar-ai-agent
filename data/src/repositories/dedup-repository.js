'use strict';

/**
 * dedup-repository.js
 *
 * Persistence layer for the dedup_signatures table.
 *
 * Design notes (FINAL_ARCHITECTURE.md § 25):
 *   - Two-stage deduplication: content-hash (pre-LLM) and semantic (post-extraction).
 *   - This repository covers content-hash dedup — the cheapest, pre-LLM check.
 *   - The signature_hash is a deterministic SHA-256 of normalized extracted
 *     fields (title + company + location + employment_type), allowing fast
 *     exact-match pre-filter before any vector similarity computation.
 *   - Semantic dedup (embedding similarity) is Sprint 4 — embedding column
 *     is intentionally excluded from all writes here.
 *   - hasSignature() is the hot path: called for every candidate URL before
 *     any LLM call is made.  Uses the unique index on signature_hash for O(1).
 *
 * All database access goes through the shared Data Plane pool (data/src/db.js).
 * No SQL lives outside this file.
 */

const { getPool } = require('../db');

/**
 * Check if a signature hash already exists.
 * This is the fast pre-LLM dedup check — must be cheap.
 *
 * @param {string} signatureHash  — SHA-256 hex string
 * @returns {Promise<boolean>}
 */
async function hasSignature(signatureHash) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT 1 FROM dedup_signatures WHERE signature_hash = $1 LIMIT 1`,
    [signatureHash]
  );
  return rows.length > 0;
}

/**
 * Insert a dedup signature for a newly stored opportunity.
 * Idempotent via ON CONFLICT DO NOTHING — safe to call on retry.
 *
 * embedding column is intentionally excluded; populated in Sprint 4.
 *
 * @param {string} opportunityId  — UUID from opportunities table
 * @param {string} signatureHash  — SHA-256 hex string
 * @returns {Promise<void>}
 */
async function insertSignature(opportunityId, signatureHash) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO dedup_signatures (opportunity_id, signature_hash)
     VALUES ($1, $2)
     ON CONFLICT (signature_hash) DO NOTHING`,
    [opportunityId, signatureHash]
  );
}

/**
 * Look up the opportunity associated with a given signature hash.
 * Used for debugging / audit — not on the hot path.
 *
 * @param {string} signatureHash
 * @returns {Promise<string|null>} — opportunity_id or null
 */
async function getOpportunityIdBySignature(signatureHash) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT opportunity_id FROM dedup_signatures
      WHERE signature_hash = $1 LIMIT 1`,
    [signatureHash]
  );
  return rows[0]?.opportunity_id || null;
}

module.exports = Object.freeze({
  hasSignature,
  insertSignature,
  getOpportunityIdBySignature,
});
