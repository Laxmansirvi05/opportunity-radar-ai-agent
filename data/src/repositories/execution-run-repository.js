'use strict';

/**
 * execution-run-repository.js
 *
 * Persistence layer for the execution_runs table.
 *
 * Design notes:
 *   - Lifecycle: createExecutionRun → updateExecutionRun (one or more times) → finalizeExecutionRun.
 *   - updateExecutionRun is safe to call mid-run for progress checkpoints.
 *   - finalizeExecutionRun is a specialized update that sets completed_at and
 *     computes duration_ms — it is the ONLY operation that sets those fields.
 *   - error_log is an append-only JSONB array — we never replace the whole
 *     array, we append individual error objects via jsonb_insert.
 *
 * All database access goes through the shared Data Plane pool (data/src/db.js).
 * No SQL lives outside this file.
 */

const { getPool } = require('../db');

/**
 * Create a new execution run record at the start of orchestration.
 *
 * @param {object} run
 * @param {string} run.candidateId
 * @param {string} run.searchPlanId
 * @param {number} run.queriesTotal
 * @returns {Promise<{ id: string, startedAt: Date }>}
 */
async function createExecutionRun({ candidateId, searchPlanId, queriesTotal }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO execution_runs
       (candidate_id, search_plan_id, queries_total, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING id, started_at`,
    [candidateId, searchPlanId, queriesTotal]
  );
  return { id: rows[0].id, startedAt: rows[0].started_at };
}

/**
 * Update execution run progress counters.
 * Safe to call multiple times during execution for incremental progress.
 *
 * @param {string} runId
 * @param {object} updates
 * @param {number} [updates.opportunitiesFound]
 * @param {number} [updates.queriesCompleted]
 * @param {number} [updates.queriesFailed]
 * @param {object} [updates.providerStats]
 * @returns {Promise<void>}
 */
async function updateExecutionRun(runId, {
  opportunitiesFound,
  queriesCompleted,
  queriesFailed,
  providerStats,
} = {}) {
  const pool = getPool();
  const sets = [];
  const params = [];
  let i = 1;

  if (opportunitiesFound !== undefined) {
    sets.push(`opportunities_found = $${i++}`); params.push(opportunitiesFound);
  }
  if (queriesCompleted !== undefined) {
    sets.push(`queries_completed = $${i++}`); params.push(queriesCompleted);
  }
  if (queriesFailed !== undefined) {
    sets.push(`queries_failed = $${i++}`); params.push(queriesFailed);
  }
  if (providerStats !== undefined) {
    sets.push(`provider_stats = $${i++}::jsonb`); params.push(JSON.stringify(providerStats));
  }

  if (sets.length === 0) return;

  params.push(runId);
  await pool.query(
    `UPDATE execution_runs SET ${sets.join(', ')} WHERE id = $${i}`,
    params
  );
}

/**
 * Finalize an execution run: set terminal status, completed_at, and duration_ms.
 *
 * @param {string} runId
 * @param {object} result
 * @param {string} result.status         — 'completed' | 'failed' | 'partial'
 * @param {number} result.opportunitiesFound
 * @param {number} result.queriesCompleted
 * @param {number} result.queriesFailed
 * @param {object} result.providerStats
 * @param {number} result.durationMs
 * @returns {Promise<void>}
 */
async function finalizeExecutionRun(runId, {
  status,
  opportunitiesFound,
  queriesCompleted,
  queriesFailed,
  providerStats,
  durationMs,
}) {
  const pool = getPool();
  await pool.query(
    `UPDATE execution_runs
        SET status               = $1,
            opportunities_found  = $2,
            queries_completed    = $3,
            queries_failed       = $4,
            provider_stats       = $5::jsonb,
            duration_ms          = $6,
            completed_at         = now()
      WHERE id = $7`,
    [status, opportunitiesFound, queriesCompleted, queriesFailed,
     JSON.stringify(providerStats), durationMs, runId]
  );
}

/**
 * Append a structured error entry to the execution run's error_log.
 * This is the ONLY mutation to error_log — always append, never replace.
 *
 * @param {string} runId
 * @param {object} errorEntry  { queryId, providerName, error, code, attempt, timestamp }
 * @returns {Promise<void>}
 */
async function appendExecutionError(runId, errorEntry) {
  const pool = getPool();
  await pool.query(
    `UPDATE execution_runs
        SET error_log = error_log || $1::jsonb
      WHERE id = $2`,
    [JSON.stringify([errorEntry]), runId]
  );
}

/**
 * Retrieve an execution run by UUID.
 *
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
async function getExecutionRun(runId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM execution_runs WHERE id = $1`,
    [runId]
  );
  return rows[0] || null;
}

/**
 * List execution runs for a candidate, newest first.
 *
 * @param {string} candidateId
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
async function listExecutionRuns(candidateId, limit = 20) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, search_plan_id, status, opportunities_found,
            queries_total, queries_completed, queries_failed,
            started_at, completed_at, duration_ms, created_at
       FROM execution_runs
      WHERE candidate_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [candidateId, limit]
  );
  return rows;
}

module.exports = Object.freeze({
  createExecutionRun,
  updateExecutionRun,
  finalizeExecutionRun,
  appendExecutionError,
  getExecutionRun,
  listExecutionRuns,
});
