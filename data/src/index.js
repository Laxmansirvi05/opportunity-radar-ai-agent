'use strict';

/**
 * Data Plane — Public API
 *
 * Re-exports every stable public interface from the data package.
 * Consumers import from '@opportunity-radar/data' (or the relative path)
 * rather than reaching into individual submodules directly.
 *
 * Sprint 1 exports: database clients and configuration.
 * Repository-layer classes will be added here in Sprint 2 as they are built.
 */

const { loadConfig }                   = require('./config');
const { getPool, healthCheck: dbHealthCheck, shutdown: dbShutdown } = require('./db');
const { getClient, healthCheck: redisHealthCheck, shutdown: redisShutdown } = require('./redis');

module.exports = {
  // Configuration
  loadConfig,

  // PostgreSQL
  getPool,
  dbHealthCheck,
  dbShutdown,

  // Redis
  getClient,
  redisHealthCheck,
  redisShutdown,
};
