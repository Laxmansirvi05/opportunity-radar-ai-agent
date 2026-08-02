'use strict';

require('dotenv').config();

/**
 * config.js — Execution Fabric configuration
 *
 * All tunables are environment-driven with safe production defaults.
 * Validated at module load time so misconfiguration fails fast.
 */

function requireEnv(name) {
  const val = process.env[name];
  if (!val || !val.trim()) {
    throw new Error(`Execution Fabric: required env var ${name} is not set`);
  }
  return val.trim();
}

function optionalEnv(name, defaultVal) {
  return (process.env[name] || '').trim() || defaultVal;
}

function positiveInt(name, defaultVal) {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Execution Fabric: ${name} must be a positive integer, got "${raw}"`);
  }
  return n;
}

function parseCompanyList(envVar) {
  const raw = process.env[envVar] || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  // PostgreSQL
  pgHost:     optionalEnv('PGHOST',     'localhost'),
  pgPort:     positiveInt('PGPORT',      5432),
  pgDatabase: optionalEnv('PGDATABASE', 'opportunity_radar'),
  pgUser:     optionalEnv('PGUSER',     ''),
  pgPassword: optionalEnv('PGPASSWORD', ''),

  // Redis
  redisUrl: optionalEnv('REDIS_URL', 'redis://localhost:6379'),

  // Render Service
  renderServiceUrl:    optionalEnv('RENDER_SERVICE_URL', 'http://localhost:3000'),
  renderServiceApiKey: optionalEnv('RENDER_SERVICE_API_KEY', ''),

  // AI Gateway
  gatewayUrl:    optionalEnv('GATEWAY_URL', 'http://localhost:4000'),
  gatewayApiKey: optionalEnv('GATEWAY_API_KEY', ''),

  // Concurrency
  maxConcurrentWorkers: positiveInt('EF_MAX_CONCURRENT_WORKERS', 5),
  workerTimeoutMs:      positiveInt('EF_WORKER_TIMEOUT_MS',      120_000),
  runTimeoutMs:         positiveInt('EF_RUN_TIMEOUT_MS',         600_000),

  // Circuit breaker
  cbFailureThreshold: positiveInt('EF_CB_FAILURE_THRESHOLD', 5),
  cbCooldownMs:       positiveInt('EF_CB_COOLDOWN_MS',       60_000),

  // Rate limiting
  rateLimitRequests:  positiveInt('EF_RATE_LIMIT_REQUESTS',  10),
  rateLimitWindowMs:  positiveInt('EF_RATE_LIMIT_WINDOW_MS', 60_000),

  // Retry policy
  maxRetryAttempts:  positiveInt('EF_MAX_RETRY_ATTEMPTS',  3),
  retryBaseDelayMs:  positiveInt('EF_RETRY_BASE_DELAY_MS', 1_000),

  // HTML truncation before LLM extraction
  maxHtmlLength: 50_000,

  // Provider company lists
  greenhouseCompanies: parseCompanyList('GREENHOUSE_COMPANIES'),
  leverCompanies:      parseCompanyList('LEVER_COMPANIES'),
  ashbyCompanies:      parseCompanyList('ASHBY_COMPANIES'),
};

module.exports = config;
