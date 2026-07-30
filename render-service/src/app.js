'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const logger = require('./logger');
const healthRouter = require('./routes/health');
const fetchRouter = require('./routes/fetch');
const { AppError } = require('./errors');

/**
 * Constant-time string comparison so a mismatching API key can't be brute
 * forced by measuring how long the `!==` comparison takes to fail (a naive
 * comparison returns faster the earlier the first differing byte is).
 */
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still perform a timingSafeEqual call of matching length so a length
    // mismatch doesn't itself leak timing information.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Per-request access logging.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('HTTP request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  // Optional bearer-token auth, gated behind /fetch only. Enabled by
  // setting API_KEY; left open by default for trusted internal networks
  // (e.g. n8n and this service sharing a private Docker network).
  if (config.apiKey) {
    app.use('/fetch', (req, res, next) => {
      const providedKey = req.get('x-api-key') || '';
      if (!providedKey || !safeCompare(providedKey, config.apiKey)) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' },
        });
      }
      return next();
    });
  }

  app.use(healthRouter);
  app.use(fetchRouter);

  // 404 for anything unmatched.
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    });
  });

  // Centralized structured error handler. Every error - known AppErrors
  // and unexpected exceptions alike - exits through here as consistent
  // JSON, never as a raw stack trace or an unhandled crash.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Malformed JSON body from express.json()
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
      });
    }

    if (err instanceof AppError) {
      logger.warn('Request failed with known error', {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      });
      return res.status(err.statusCode).json({
        success: false,
        error: err.toJSON(),
      });
    }

    logger.error('Unhandled error', {
      message: err && err.message,
      stack: err && err.stack,
    });
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
  });

  return app;
}

module.exports = createApp;
