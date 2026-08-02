'use strict';

/**
 * event-log-repository.js
 *
 * Write access to the event_log table (FINAL_ARCHITECTURE.md § 55–57).
 *
 * Design rules enforced here:
 *   APPEND-ONLY: INSERT only. No UPDATE, no DELETE.
 *   VERSIONED:   schema_version field carried on every payload.
 *   FIRE-AND-FORGET:  Callers should NOT await event writes on the critical
 *     execution path. This repository is intentionally not transactional with
 *     the business operation it logs — an event write failure must NEVER
 *     cause the business operation to fail. See appendEvent()'s catch note.
 *
 * All database access goes through the shared Data Plane pool (data/src/db.js).
 * No SQL lives outside this file.
 */

const { getPool } = require('../db');

/**
 * Append a single event to the event_log table.
 *
 * @param {object} event
 * @param {string} event.eventType       — e.g. 'execution.started'
 * @param {object} [event.payloadJson]   — structured payload (defaults to {})
 * @param {string} [event.candidateId]   — optional UUID
 * @param {string} [event.runId]         — optional UUID (execution_run.id)
 * @param {string} [event.schemaVersion] — defaults to '1.0.0'
 * @returns {Promise<string>} — inserted event UUID
 */
async function appendEvent({ eventType, payloadJson = {}, candidateId = null, runId = null, schemaVersion = '1.0.0' }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO event_log (event_type, schema_version, payload_json, candidate_id, run_id)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id`,
    [eventType, schemaVersion, JSON.stringify(payloadJson), candidateId || null, runId || null]
  );
  return rows[0].id;
}

/**
 * Retrieve events for a given run_id (for debugging / replay).
 * Not used on the critical path.
 *
 * @param {string} runId
 * @returns {Promise<object[]>}
 */
async function getEventsByRunId(runId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, event_type, schema_version, payload_json, candidate_id, run_id, published_at
       FROM event_log
      WHERE run_id = $1
      ORDER BY published_at ASC`,
    [runId]
  );
  return rows;
}

/**
 * Retrieve the N most recent events of a given type.
 *
 * @param {string} eventType
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
async function getRecentEvents(eventType, limit = 50) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, event_type, schema_version, payload_json, candidate_id, run_id, published_at
       FROM event_log
      WHERE event_type = $1
      ORDER BY published_at DESC
      LIMIT $2`,
    [eventType, limit]
  );
  return rows;
}

module.exports = Object.freeze({ appendEvent, getEventsByRunId, getRecentEvents });
