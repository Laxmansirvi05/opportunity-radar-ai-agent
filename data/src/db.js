'use strict';

/**
 * Data Plane — PostgreSQL Client
 *
 * Provides a lazy-initialized connection pool (singleton per process) and a
 * health-check utility.  All callers share the same pool so connection slots
 * are not wasted on duplicate pools.
 *
 * Usage:
 *   const { getPool, healthCheck, shutdown } = require('./db');
 *   const pool = getPool();
 *   const result = await pool.query('SELECT $1::text AS msg', ['hello']);
 *
 * Shutdown:
 *   Call shutdown() before process exit to drain in-flight queries and close
 *   all connections gracefully.  The server.js entry point of any service that
 *   uses this module should register shutdown() on SIGTERM / SIGINT.
 */

const { Pool } = require('pg');
const { loadConfig } = require('./config');

/** @type {import('pg').Pool | null} */
let pool = null;

/**
 * Returns the process-wide pg Pool, creating it on first call.
 * Subsequent calls return the same instance.
 *
 * @returns {import('pg').Pool}
 */
function getPool() {
  if (pool) return pool;

  const config = loadConfig();

  pool = new Pool({
    host:                   config.db.host,
    port:                   config.db.port,
    database:               config.db.name,
    user:                   config.db.user,
    password:               config.db.password,
    max:                    config.db.poolMax,
    idleTimeoutMillis:      config.db.idleTimeoutMs,
    connectionTimeoutMillis: config.db.connectionTimeoutMs,
    // SSL configuration:
    //   PGSSL=false    → no TLS (local dev, Docker on trusted network)
    //   PGSSL=true     → TLS with full certificate verification (REQUIRED for production)
    //   PGSSL=require  → TLS without cert verification (staging / self-signed certs only)
    //
    // Using 'require' mode without cert verification is acceptable on a trusted private
    // network but MUST NOT be used in production.  Production requires PGSSL=true.
    ssl: (() => {
      const mode = (process.env.PGSSL || 'false').toLowerCase();
      if (mode === 'false' || mode === '0') return false;
      if (mode === 'require') return { rejectUnauthorized: false };
      return { rejectUnauthorized: true }; // 'true' or any truthy value → full verification
    })(),
  });

  // Surface pool-level errors (e.g. idle client failures) rather than
  // letting Node exit with an unhandled 'error' event.
  pool.on('error', (err) => {
    // Structured output so this integrates with any log aggregator.
    process.stderr.write(
      JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'pg_pool_error', err: err.message }) + '\n'
    );
  });

  return pool;
}

/**
 * Verifies the database connection by running a trivial query.
 * Acquires and immediately releases a client from the pool.
 *
 * Resolves with { status: 'ok', latencyMs: number } on success.
 * Rejects with a plain Error on failure (caller decides how to surface it).
 *
 * @returns {Promise<{ status: 'ok', latencyMs: number }>}
 */
async function healthCheck() {
  const start = Date.now();
  const client = await getPool().connect();
  try {
    await client.query('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - start };
  } finally {
    client.release();
  }
}

/**
 * Drains the connection pool and releases all connections.
 * Safe to call multiple times (no-op after first call).
 *
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

module.exports = { getPool, healthCheck, shutdown };
