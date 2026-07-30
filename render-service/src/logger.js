'use strict';

const config = require('./config');

/**
 * Minimal dependency-free structured logger. Emits one JSON object per line
 * so logs are directly parseable by any log aggregator (CloudWatch, Loki,
 * Datadog, etc) without needing a JSON transform.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel =
  LEVELS[config.logLevel] !== undefined ? LEVELS[config.logLevel] : LEVELS.info;

function write(level, message, meta) {
  if (LEVELS[level] > currentLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  error: (message, meta = {}) => write('error', message, meta),
  warn: (message, meta = {}) => write('warn', message, meta),
  info: (message, meta = {}) => write('info', message, meta),
  debug: (message, meta = {}) => write('debug', message, meta),
};
