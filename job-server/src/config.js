'use strict';

const path = require('node:path');

// Load this service's own .env first, then the repository-root .env. The root
// file is what n8n itself reads, and RESUME_INPUT_PATH must agree between the
// two or the pipeline reads a different file than the one just uploaded.
require('dotenv').config();
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

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

  // Rate limiting on POST /api/jobs. The pipeline runs ONE job at a time, so a
  // single caller submitting in a loop can starve everyone else. Counted per
  // client IP over a sliding window.
  rateLimitMax: integer('RATE_LIMIT_MAX', process.env.RATE_LIMIT_MAX, 10),
  rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', process.env.RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),

  // Uploaded resumes are PII. They are deleted as soon as the job reaches a
  // terminal state, and any stragglers are removed after this age.
  uploadRetentionMs: integer('UPLOAD_RETENTION_MS', process.env.UPLOAD_RETENTION_MS, 24 * 60 * 60 * 1000),
});

module.exports = config;
