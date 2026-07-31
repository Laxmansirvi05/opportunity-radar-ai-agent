'use strict';

/**
 * Data Plane — Central Configuration
 *
 * Loads environment variables once and exposes a frozen config object.
 * All other modules in this package import from here; none read process.env directly.
 *
 * Call loadConfig() once per process. The returned object is frozen so
 * accidental mutation is caught immediately rather than silently drifting.
 */

require('dotenv').config();


/**
 * Parses an optional integer environment variable.
 *
 * @param {string} name
 * @param {number} defaultValue
 * @returns {number}
 */
function intEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`[data/config] Environment variable "${name}" must be an integer. Got: "${raw}"`);
  }
  return parsed;
}

/**
 * Parses an optional boolean environment variable.
 * Treats "false" and "0" as false; everything else (including "true", "1", "yes") as true.
 *
 * @param {string} name
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function boolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

/**
 * Loads and validates all Data Plane configuration from environment variables.
 * Returns a deeply frozen object; properties may not be mutated at runtime.
 *
 * @returns {Readonly<{
 *   db: Readonly<{host: string, port: number, name: string, user: string, password: string, poolMax: number, idleTimeoutMs: number, connectionTimeoutMs: number, ssl: boolean}>,
 *   redis: Readonly<{host: string, port: number, password: string|null, db: number}>,
 *   embedding: Readonly<{dim: number, model: string}>
 * }>}
 */
function loadConfig() {
  const embeddingDim = intEnv('EMBEDDING_DIM', 1536);
  if (embeddingDim < 1 || embeddingDim > 65535) {
    throw new Error(`[data/config] EMBEDDING_DIM must be between 1 and 65535. Got: ${embeddingDim}`);
  }

  return Object.freeze({
    db: Object.freeze({
      host:               process.env.PGHOST       || 'localhost',
      port:               intEnv('PGPORT', 5432),
      name:               process.env.PGDATABASE   || 'opportunity_radar',
      user:               process.env.PGUSER       || 'postgres',
      // PGPASSWORD: intentionally optional.
      // Local Homebrew PostgreSQL authenticates via Unix socket (peer auth) and
      // does not require a password.  Production deployments MUST set this.
      password:           process.env.PGPASSWORD   || '',
      poolMax:            intEnv('PG_POOL_MAX', 10),
      idleTimeoutMs:      intEnv('PG_IDLE_TIMEOUT_MS', 30_000),
      connectionTimeoutMs: intEnv('PG_CONNECT_TIMEOUT_MS', 5_000),
      ssl:                boolEnv('PGSSL', false),
    }),
    redis: Object.freeze({
      host:     process.env.REDIS_HOST     || 'localhost',
      port:     intEnv('REDIS_PORT', 6379),
      // Treat blank string as null so ioredis connects without auth
      password: process.env.REDIS_PASSWORD || null,
      db:       intEnv('REDIS_DB', 0),
    }),
    embedding: Object.freeze({
      // The vector column dimension in PostgreSQL.
      // Must match the output dimension of the embedding model in use.
      // CHANGING THIS AFTER INITIAL MIGRATION REQUIRES A NEW ALTER TABLE MIGRATION.
      dim:   embeddingDim,
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    }),
  });
}

module.exports = { loadConfig };
