'use strict';

/**
 * job-repository.js — all pipeline_jobs access.
 *
 * Kept behind an interface so the HTTP layer and the worker can be tested
 * against an in-memory implementation without a database.
 */

/**
 * @typedef {object} JobRepository
 * @property {(job: object) => Promise<object>} create
 * @property {(id: string) => Promise<object|null>} get
 * @property {() => Promise<object|null>} claimNextQueued
 * @property {(id: string, result: object) => Promise<void>} markComplete
 * @property {(id: string, error: object) => Promise<void>} markFailed
 * @property {(olderThanMs: number) => Promise<object[]>} sweepStuck
 * @property {() => Promise<number>} runningCount
 */

/** Postgres-backed repository. */
function createPgRepository(pool) {
  return {
    async create({ filename, bytes, path }) {
      const { rows } = await pool.query(
        `INSERT INTO pipeline_jobs (status, resume_filename, resume_bytes, resume_path)
         VALUES ('queued', $1, $2, $3)
         RETURNING *`,
        [filename, bytes, path]
      );
      return rows[0];
    },

    async get(id) {
      const { rows } = await pool.query('SELECT * FROM pipeline_jobs WHERE id = $1', [id]);
      return rows[0] || null;
    },

    /**
     * Atomically claim the oldest queued job, but only when nothing is running.
     * Concurrency limit of 1 is enforced in SQL so two workers cannot both claim.
     */
    async claimNextQueued() {
      const { rows } = await pool.query(
        `UPDATE pipeline_jobs
            SET status = 'running', started_at = now(), attempts = attempts + 1
          WHERE id = (
            SELECT id FROM pipeline_jobs
             WHERE status = 'queued'
               AND NOT EXISTS (SELECT 1 FROM pipeline_jobs WHERE status = 'running')
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT 1
          )
        RETURNING *`
      );
      return rows[0] || null;
    },

    async markComplete(id, result) {
      await pool.query(
        `UPDATE pipeline_jobs
            SET status = 'complete', result = $2, error = NULL, completed_at = now()
          WHERE id = $1`,
        [id, result]
      );
    },

    async markFailed(id, error) {
      await pool.query(
        `UPDATE pipeline_jobs
            SET status = 'failed', error = $2, completed_at = now()
          WHERE id = $1`,
        [id, error]
      );
    },

    async sweepStuck(olderThanMs) {
      const { rows } = await pool.query(
        `UPDATE pipeline_jobs
            SET status = 'failed',
                error = jsonb_build_object(
                  'code', 'PIPELINE_TIMEOUT',
                  'message', 'Job exceeded the maximum run time and was swept'),
                completed_at = now()
          WHERE status = 'running'
            AND started_at < now() - ($1::bigint * interval '1 millisecond')
        RETURNING *`,
        [olderThanMs]
      );
      return rows;
    },

    async runningCount() {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM pipeline_jobs WHERE status = 'running'`
      );
      return rows[0].n;
    },
  };
}

/** In-memory repository with identical semantics, for tests. */
function createMemoryRepository() {
  const jobs = new Map();
  let seq = 0;
  const now = () => new Date();

  return {
    _all: () => [...jobs.values()],
    async create({ filename, bytes, path }) {
      seq += 1;
      const job = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
        status: 'queued',
        resume_filename: filename,
        resume_bytes: bytes,
        resume_path: path,
        result: null,
        error: null,
        attempts: 0,
        started_at: null,
        completed_at: null,
        created_at: now(),
        updated_at: now(),
      };
      jobs.set(job.id, job);
      return { ...job };
    },
    async get(id) {
      const j = jobs.get(id);
      return j ? { ...j } : null;
    },
    async claimNextQueued() {
      if ([...jobs.values()].some((j) => j.status === 'running')) return null;
      const next = [...jobs.values()]
        .filter((j) => j.status === 'queued')
        .sort((a, b) => a.created_at - b.created_at)[0];
      if (!next) return null;
      next.status = 'running';
      next.started_at = now();
      next.attempts += 1;
      return { ...next };
    },
    async markComplete(id, result) {
      const j = jobs.get(id);
      if (!j) return;
      j.status = 'complete';
      j.result = result;
      j.error = null;
      j.completed_at = now();
    },
    async markFailed(id, error) {
      const j = jobs.get(id);
      if (!j) return;
      j.status = 'failed';
      j.error = error;
      j.completed_at = now();
    },
    async sweepStuck(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      const swept = [];
      for (const j of jobs.values()) {
        if (j.status === 'running' && j.started_at && j.started_at.getTime() < cutoff) {
          j.status = 'failed';
          j.error = { code: 'PIPELINE_TIMEOUT', message: 'Job exceeded the maximum run time and was swept' };
          j.completed_at = now();
          swept.push({ ...j });
        }
      }
      return swept;
    },
    async runningCount() {
      return [...jobs.values()].filter((j) => j.status === 'running').length;
    },
  };
}

module.exports = { createPgRepository, createMemoryRepository };
