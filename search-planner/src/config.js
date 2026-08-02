'use strict';

/**
 * config.js — Search Planner configuration
 *
 * Must be the first require() in the entry point so environment variables
 * are loaded before the data package reads process.env at module evaluation.
 */

require('dotenv').config();

const config = {
  // PostgreSQL — inherited from Data Plane
  pgHost: process.env.PGHOST || 'localhost',
  pgPort: parseInt(process.env.PGPORT || '5432', 10),
  pgDatabase: process.env.PGDATABASE || 'opportunity_radar',
  pgUser: process.env.PGUSER || '',
  pgPassword: process.env.PGPASSWORD || '',

  // Search plan generation tuning
  maxQueriesPerTier: parseInt(process.env.SP_MAX_QUERIES_PER_TIER || '5', 10),
  maxTotalQueries: parseInt(process.env.SP_MAX_TOTAL_QUERIES || '20', 10),
  planVersion: process.env.SP_PLAN_VERSION || '1.0.0',

  // Freshness policy per tier (hours expressed as string for readability)
  freshnessT1: process.env.SP_FRESHNESS_T1 || '24h',
  freshnessT2: process.env.SP_FRESHNESS_T2 || '48h',
  freshnessT3: process.env.SP_FRESHNESS_T3 || '72h',
  freshnessT4: process.env.SP_FRESHNESS_T4 || '48h',
};

module.exports = config;
