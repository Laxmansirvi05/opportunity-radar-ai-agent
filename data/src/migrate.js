'use strict';

/**
 * Data Plane — Migration Runner
 *
 * Applies SQL migration files from the /migrations directory in lexicographic
 * order.  Tracking is done via a schema_migrations table that the runner
 * bootstraps itself (no chicken-and-egg problem: the tracking table is NOT a
 * migration file).
 *
 * Properties:
 *   Idempotent:    Safe to run multiple times; already-applied migrations are
 *                  skipped based on filename.
 *   Transactional: Each migration runs inside BEGIN/COMMIT.  On failure the
 *                  transaction is rolled back and the process exits non-zero.
 *   Serialised:    pg_advisory_lock prevents two migration processes from
 *                  running concurrently against the same database.
 *   Tamper-aware:  A SHA-256 checksum of each migration file's raw content is
 *                  stored at application time.  On subsequent runs, if the
 *                  file content has changed, a warning is emitted — the
 *                  migration is NOT re-applied (files should be immutable
 *                  after deployment; changes belong in new migration files).
 *   Template vars: Supports {EMBEDDING_DIM} placeholder replaced at runtime
 *                  with the configured value so the schema stays decoupled
 *                  from a hardcoded dimension.
 *
 * Usage:
 *   npm run migrate          (from /data directory)
 *   node src/migrate.js      (direct invocation)
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getPool, shutdown: dbShutdown } = require('./db');
const { loadConfig } = require('./config');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Unique integer key for pg_advisory_lock.
// Must be consistent across all deployments of this application.
// This is a fixed constant — choose any large unique integer and never change it.
// pg advisory locks are database-scoped, so this only needs to be unique per
// PostgreSQL cluster, not globally.
const ADVISORY_LOCK_KEY = 1_836_021_682;

// Maximum time (ms) a single SQL statement within a migration is allowed to run.
// Set conservatively high (60 s) since Sprint 1 migrations only create tables.
// For migrations involving large data transforms, override with a custom
// SET statement_timeout comment at the top of the SQL file.
const MIGRATION_STATEMENT_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Structured logger — writes a single JSON line to stdout.
 * @param {string} msg
 * @param {object} [data]
 */
function log(msg, data = {}) {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), msg, ...data }) + '\n'
  );
}

/**
 * Structured error logger — writes a single JSON line to stderr.
 * @param {string} msg
 * @param {object} [data]
 */
function logError(msg, data = {}) {
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg, ...data }) + '\n'
  );
}

/**
 * Computes a SHA-256 hex digest of the raw file content string.
 * This checksum is stored in schema_migrations and compared on subsequent
 * runs to detect post-deployment file mutations.
 *
 * @param {string} content  Raw UTF-8 file content (before template substitution).
 * @returns {string}        64-character lowercase hex string.
 */
function computeChecksum(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Replaces all known template variables in a SQL string with their runtime values.
 *
 * Supported variables:
 *   {EMBEDDING_DIM}  — replaced with config.embedding.dim (integer)
 *
 * Using curly-brace syntax is safe in SQL because curly braces have no
 * special meaning in PostgreSQL query strings.
 *
 * @param {string} sql
 * @param {{ embeddingDim: number }} vars
 * @returns {string}
 */
function applyTemplateVars(sql, vars) {
  return sql.replace(/\{EMBEDDING_DIM\}/g, String(vars.embeddingDim));
}

// ---------------------------------------------------------------------------
// Migration table bootstrap
// ---------------------------------------------------------------------------

/**
 * Creates the schema_migrations tracking table if it does not already exist.
 * This DDL is intentionally NOT a migration file — the runner bootstraps it
 * unconditionally before processing any files.
 *
 * @param {import('pg').PoolClient} client
 */
async function bootstrapMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL      PRIMARY KEY,
      filename    TEXT        NOT NULL UNIQUE,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// ---------------------------------------------------------------------------
// Applied-migration index
// ---------------------------------------------------------------------------

/**
 * Returns a Map of { filename → checksum } for all already-applied migrations.
 *
 * @param {import('pg').PoolClient} client
 * @returns {Promise<Map<string, string>>}
 */
async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    'SELECT filename, checksum FROM schema_migrations ORDER BY id'
  );
  return new Map(rows.map((row) => [row.filename, row.checksum]));
}

// ---------------------------------------------------------------------------
// Single-migration application
// ---------------------------------------------------------------------------

/**
 * Applies one migration file inside a database transaction.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} filename        Bare filename (e.g. "002_candidates.sql").
 * @param {string} substitutedSql  SQL with template variables already replaced.
 * @param {string} rawChecksum     SHA-256 of the raw (pre-substitution) file content.
 */
async function applyMigration(client, filename, substitutedSql, rawChecksum) {
  // Set a per-statement timeout so a hanging DDL (e.g. waiting on a table lock)
  // cannot block the runner process indefinitely.
  await client.query(`SET LOCAL statement_timeout = ${MIGRATION_STATEMENT_TIMEOUT_MS}`);

  await client.query('BEGIN');
  try {
    await client.query(substitutedSql);
    await client.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
      [filename, rawChecksum]
    );
    await client.query('COMMIT');
  } catch (err) {
    // IMPORTANT: Discard any error from ROLLBACK itself.
    // If ROLLBACK throws (e.g. connection lost mid-migration), allowing that
    // secondary error to propagate would shadow the original failure, making
    // the root cause impossible to diagnose from logs.
    await client.query('ROLLBACK').catch((rollbackErr) => {
      process.stderr.write(
        JSON.stringify({
          ts:  new Date().toISOString(),
          level: 'error',
          msg:  'migration_rollback_failed',
          file: filename,
          err:  rollbackErr.message,
        }) + '\n'
      );
    });
    throw err; // Always re-throw the original migration error.
  }
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function run() {
  const config  = loadConfig();
  const pool    = getPool();
  const client  = await pool.connect();

  log('migration_run_started', {
    embeddingDim:   config.embedding.dim,
    embeddingModel: config.embedding.model,
  });

  try {
    // ------------------------------------------------------------------
    // 1. Acquire an advisory lock to serialise concurrent migration runs.
    //    The lock is automatically released when the client is returned to
    //    the pool (pool.connect() / client.release() scope).
    // ------------------------------------------------------------------
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    log('advisory_lock_acquired', { lockKey: ADVISORY_LOCK_KEY });

    // ------------------------------------------------------------------
    // 2. Bootstrap the tracking table.
    // ------------------------------------------------------------------
    await bootstrapMigrationsTable(client);
    log('schema_migrations_table_ready');

    // ------------------------------------------------------------------
    // 3. Discover migration files.
    // ------------------------------------------------------------------
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // Lexicographic order — filenames MUST start with a zero-padded number.

    log('migrations_discovered', { count: files.length, files });

    const applied = await getAppliedMigrations(client);
    let appliedCount = 0;
    let skippedCount = 0;

    // ------------------------------------------------------------------
    // 4. Apply each unapplied migration.
    // ------------------------------------------------------------------
    for (const filename of files) {
      const filePath    = path.join(MIGRATIONS_DIR, filename);
      const rawContent  = fs.readFileSync(filePath, 'utf8');
      const checksum    = computeChecksum(rawContent);

      if (applied.has(filename)) {
        const storedChecksum = applied.get(filename);
        if (storedChecksum !== checksum) {
          // The file was mutated after it was applied.  This is a warning, not
          // an error: we do NOT re-apply it (that could corrupt the schema),
          // but we flag it loudly so it can be investigated.
          logError('migration_file_checksum_mismatch', {
            filename,
            warning:  'Migration file content changed after it was applied. ' +
                      'Schema changes must be made in new migration files.',
            stored:   storedChecksum,
            current:  checksum,
          });
        } else {
          log('migration_skipped_already_applied', { filename });
        }
        skippedCount += 1;
        continue;
      }

      // Substitute template variables (e.g. {EMBEDDING_DIM}) before execution.
      const substitutedSql = applyTemplateVars(rawContent, { embeddingDim: config.embedding.dim });

      log('migration_applying', { filename });
      await applyMigration(client, filename, substitutedSql, checksum);
      log('migration_applied', { filename });
      appliedCount += 1;
    }

    log('migration_run_complete', { applied: appliedCount, skipped: skippedCount });

  } finally {
    // Release the advisory lock explicitly before returning the client.
    // If the connection is already dead, this is a no-op.
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
    await dbShutdown();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

run().catch((err) => {
  logError('migration_run_failed', { error: err.message, stack: err.stack });
  process.exit(1);
});
