'use strict';

require('dotenv').config();

function integer(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

const config = Object.freeze({
  port: integer('PORT', process.env.JOB_SERVER_PORT, 4300),

  // CORS is OFF by default: Opportunity Radar's backend proxies this service,
  // the browser never calls it directly.
  enableCors: bool(process.env.ENABLE_CORS, false),
  corsOrigin: process.env.CORS_ORIGIN || '',

  maxUploadBytes: integer('MAX_UPLOAD_BYTES', process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),

  // A running job older than this is considered stuck and swept to failed.
  stuckAfterMs: integer('JOB_STUCK_AFTER_MS', process.env.JOB_STUCK_AFTER_MS, 30 * 60 * 1000),
  // The sweep runs on an interval, not only at startup.
  sweepIntervalMs: integer('SWEEP_INTERVAL_MS', process.env.SWEEP_INTERVAL_MS, 60 * 1000),

  uploadDir: process.env.UPLOAD_DIR || '/tmp/opportunity-radar-uploads',
});

module.exports = config;
