'use strict';

/**
 * search-plan-repository.js
 *
 * Persistence layer for the search_plans table.
 *
 * IMMUTABILITY CONTRACT (FINAL_ARCHITECTURE.md § 16):
 *   - Search Plans are NEVER updated after creation.
 *   - plan_json is FROZEN at insert time.
 *   - The only mutation allowed is status: 'active' → 'superseded',
 *     and ONLY when a newer plan replaces the prior one.
 *   - This module enforces that contract — there is no updatePlan() function.
 *
 * All database access goes through the shared Data Plane pool (data/src/db.js).
 * No SQL lives outside this file.
 */

const { getPool } = require('../db');

/**
 * Insert a new, immutable Search Plan.
 *
 * Before inserting, marks any existing 'active' plan for this candidate
 * as 'superseded' — this is the ONLY mutation ever performed on a plan row.
 *
 * @param {object} plan
 * @param {string} plan.candidateId
 * @param {string} plan.profileVersion   — from CIP meta.schemaVersion
 * @param {string} plan.planVersion      — defaults to '1.0.0'
 * @param {object} plan.planJson         — full SearchPlan object
 * @param {number} plan.queryCount
 * @returns {Promise<object>} — inserted row { id, candidateId, planVersion, createdAt }
 */
async function createSearchPlan({ candidateId, profileVersion, planVersion = '1.0.0', planJson, queryCount }) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Supersede any currently active plan for this candidate.
    await client.query(
      `UPDATE search_plans
         SET status = 'superseded'
       WHERE candidate_id = $1
         AND status = 'active'`,
      [candidateId]
    );

    // Insert the new immutable plan.
    const { rows } = await client.query(
      `INSERT INTO search_plans
         (candidate_id, profile_version, plan_version, plan_json, query_count, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, candidate_id, plan_version, query_count, status, created_at`,
      [candidateId, profileVersion, planVersion, JSON.stringify(planJson), queryCount]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Retrieve the most recent active Search Plan for a candidate.
 *
 * @param {string} candidateId
 * @returns {Promise<object|null>}
 */
async function getActiveSearchPlan(candidateId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, candidate_id, profile_version, plan_version,
            plan_json, query_count, status, created_at
       FROM search_plans
      WHERE candidate_id = $1
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
    [candidateId]
  );
  return rows[0] || null;
}

/**
 * Retrieve a specific Search Plan by its UUID.
 * Returns all plans regardless of status (needed for execution run replay).
 *
 * @param {string} planId
 * @returns {Promise<object|null>}
 */
async function getSearchPlanById(planId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, candidate_id, profile_version, plan_version,
            plan_json, query_count, status, created_at
       FROM search_plans
      WHERE id = $1`,
    [planId]
  );
  return rows[0] || null;
}

/**
 * List all plans for a candidate, newest first.
 * Used for plan history / debugging.
 *
 * @param {string} candidateId
 * @returns {Promise<object[]>}
 */
async function listSearchPlans(candidateId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, candidate_id, profile_version, plan_version,
            query_count, status, created_at
       FROM search_plans
      WHERE candidate_id = $1
      ORDER BY created_at DESC`,
    [candidateId]
  );
  return rows;
}

module.exports = Object.freeze({
  createSearchPlan,
  getActiveSearchPlan,
  getSearchPlanById,
  listSearchPlans,
});
