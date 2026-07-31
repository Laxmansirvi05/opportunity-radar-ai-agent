'use strict';

/**
 * Data Plane — Public API
 *
 * Re-exports every stable public interface from the data package.
 * Consumers import from '@opportunity-radar/data' (or the relative path)
 * rather than reaching into individual submodules directly.
 *
 * Sprint 1: database clients and configuration.
 * Sprint 2: CIP schema (canonical, no duplication) and candidate repository.
 * Future sprints will add further repositories and schemas here.
 */

const { loadConfig }                                                        = require('./config');
const { getPool, healthCheck: dbHealthCheck, shutdown: dbShutdown }         = require('./db');
const { getClient, healthCheck: redisHealthCheck, shutdown: redisShutdown } = require('./redis');

// Sprint 2 — Intelligence schemas and repositories
const candidateProfileSchema   = require('./schemas/candidate-profile-schema');
const candidateRepository      = require('./repositories/candidate-repository');

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

  // CIP schema (single source of truth)
  candidateProfileSchema,

  // Repositories (centralized persistence layer)
  candidateRepository,
};
