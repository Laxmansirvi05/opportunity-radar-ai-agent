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
 * Sprint 3: search plan, opportunity, execution run, and dedup repositories.
 */

const { loadConfig }                                                        = require('./config');
const { getPool, healthCheck: dbHealthCheck, shutdown: dbShutdown }         = require('./db');
const { getClient, healthCheck: redisHealthCheck, shutdown: redisShutdown } = require('./redis');

// Sprint 2 — Intelligence schemas and repositories
const candidateProfileSchema   = require('./schemas/candidate-profile-schema');
const candidateRepository      = require('./repositories/candidate-repository');

// Sprint 3 — Execution Plane repositories
const searchPlanRepository     = require('./repositories/search-plan-repository');
const opportunityRepository    = require('./repositories/opportunity-repository');
const executionRunRepository   = require('./repositories/execution-run-repository');
const dedupRepository          = require('./repositories/dedup-repository');
const eventLogRepository       = require('./repositories/event-log-repository');

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

  // Repositories (centralized persistence layer — all DB access goes here)
  candidateRepository,
  searchPlanRepository,
  opportunityRepository,
  executionRunRepository,
  dedupRepository,
  eventLogRepository,
};
