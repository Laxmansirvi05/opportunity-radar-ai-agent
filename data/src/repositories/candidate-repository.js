'use strict';

/**
 * Data Plane — Candidate Repository
 *
 * Provides all database operations for the `candidates` table.
 * This is the SINGLE location for candidate persistence across all services:
 *   - Profile Builder (Sprint 2)
 *   - Search Planner   (Sprint 3)
 *   - Ranking Engine   (Sprint 4)
 *   - Execution Plane  (Sprint 5)
 *
 * All callers import from '@opportunity-radar/data' (or the relative path)
 * and call these functions — they do not write SQL against `candidates` directly.
 *
 * Design notes:
 *   - Uses the singleton getPool() from db.js — no new connection pools.
 *   - All writes are upserts (ON CONFLICT DO UPDATE) so every operation is
 *     safely re-runnable on the same resume_hash without creating duplicates.
 *   - The embedding column is intentionally excluded from Sprint 2 writes.
 *     It will be populated by the Semantic Matching Engine in Sprint 3.
 *   - Timestamps (created_at, updated_at) are managed by the database:
 *     - created_at: set by DEFAULT on INSERT, never overwritten.
 *     - updated_at: auto-advanced by the set_updated_at() trigger (migration 008).
 */

const { getPool } = require('../db');

// ---------------------------------------------------------------------------
// Types (JSDoc only — no runtime type checking here; callers validate upstream)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} UpsertCandidateInput
 * @property {string}  resumeHash            - SHA-256 hex of the raw resume input.
 * @property {Object}  profileJson           - Validated CIP object (will be JSON-serialized).
 * @property {string}  careerStage           - Top-level career stage from CIP.
 * @property {string}  profileSchemaVersion  - CIP schema version (e.g. "2.0.0").
 * @property {string}  profileModelVersion   - AI model that produced the profile.
 * @property {string}  [rawResumePath]       - Object storage path (optional, Sprint 3+).
 */

/**
 * @typedef {Object} CandidateRow
 * @property {string}    id
 * @property {string}    resume_hash
 * @property {string}    career_stage
 * @property {string}    profile_schema_version
 * @property {string}    profile_model_version
 * @property {string}    status
 * @property {Date}      created_at
 * @property {Date}      updated_at
 */

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Inserts a new candidate row or updates the existing one if the resume_hash
 * already exists.  This is the primary write path for the Profile Builder.
 *
 * The upsert strategy:
 *   - INSERT sets all fields including created_at (DB default = now()).
 *   - ON CONFLICT DO UPDATE overwrites profile content but preserves created_at.
 *   - updated_at is auto-advanced by the set_updated_at() trigger.
 *
 * @param {UpsertCandidateInput} input
 * @returns {Promise<CandidateRow>} The inserted or updated row (without embedding/profile_json).
 */
async function upsertCandidate({
  resumeHash,
  profileJson,
  careerStage,
  profileSchemaVersion,
  profileModelVersion,
  rawResumePath = null,
}) {
  const pool = getPool();

  // Serialize profileJson to a string for the pg driver.
  // pg will accept a plain object for JSONB but explicit serialization prevents
  // accidental double-encoding if the caller passes an already-stringified value.
  const profileJsonStr = typeof profileJson === 'string'
    ? profileJson
    : JSON.stringify(profileJson);

  const result = await pool.query(
    `INSERT INTO candidates
       (resume_hash, raw_resume_path, profile_json,      career_stage, profile_schema_version,
        profile_model_version, status)
     VALUES
       ($1,          $2,              $3::jsonb,          $4,           $5,
        $6,                    'active')
     ON CONFLICT (resume_hash) DO UPDATE SET
       raw_resume_path        = EXCLUDED.raw_resume_path,
       profile_json           = EXCLUDED.profile_json,
       career_stage           = EXCLUDED.career_stage,
       profile_schema_version = EXCLUDED.profile_schema_version,
       profile_model_version  = EXCLUDED.profile_model_version,
       status                 = 'active'
     RETURNING
       id, resume_hash, career_stage, profile_schema_version,
       profile_model_version, status, created_at, updated_at`,
    [
      resumeHash,
      rawResumePath,
      profileJsonStr,
      careerStage,
      profileSchemaVersion,
      profileModelVersion,
    ]
  );

  return result.rows[0];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Finds an active candidate by their resume hash.
 * Returns null if not found or if the candidate has been soft-deleted.
 *
 * @param {string} resumeHash - SHA-256 hex of the resume input.
 * @returns {Promise<CandidateRow | null>}
 */
async function findCandidateByResumeHash(resumeHash) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, resume_hash, career_stage, profile_schema_version,
            profile_model_version, status, created_at, updated_at
     FROM candidates
     WHERE resume_hash = $1
       AND status = 'active'`,
    [resumeHash]
  );
  return result.rows[0] ?? null;
}

/**
 * Retrieves a candidate by their UUID primary key.
 * Returns null if not found.
 *
 * @param {string} id - UUID primary key.
 * @returns {Promise<CandidateRow | null>}
 */
async function findCandidateById(id) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, resume_hash, career_stage, profile_schema_version,
            profile_model_version, status, created_at, updated_at
     FROM candidates
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * Retrieves the full profile JSON for a candidate by UUID.
 * Returns null if not found.
 *
 * Kept separate from findCandidateById so that most callers (who only need
 * metadata, not the full profile blob) avoid unnecessarily reading large JSONB.
 *
 * @param {string} id - UUID primary key.
 * @returns {Promise<{ id: string, profile_json: Object, profile_schema_version: string } | null>}
 */
async function getCandidateProfile(id) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, profile_json, profile_schema_version
     FROM candidates
     WHERE id = $1
       AND status = 'active'`,
    [id]
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  upsertCandidate,
  findCandidateByResumeHash,
  findCandidateById,
  getCandidateProfile,
});
