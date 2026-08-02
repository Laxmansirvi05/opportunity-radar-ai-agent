'use strict';

/**
 * retry-policy.js
 *
 * Exponential backoff with full jitter + error classification.
 *
 * Error classification:
 *   TRANSIENT — should be retried (network errors, 429, 503, 504, 502)
 *   PERMANENT — should not be retried (400, 403, 404, validation errors)
 *
 * Backoff formula: min(baseDelay * 2^attempt, maxDelay) + random jitter
 *
 * Design:
 *   The execute() function wraps an async operation with retries.
 *   The onRetry callback enables the caller (worker) to emit events
 *   without the retry policy needing to know about event logging.
 */

const TRANSIENT_HTTP_CODES = new Set([429, 500, 502, 503, 504]);
const PERMANENT_HTTP_CODES = new Set([400, 401, 403, 404, 405, 422]);

/**
 * Custom error class for provider HTTP errors.
 */
class ProviderHttpError extends Error {
  constructor(statusCode, message, url) {
    super(message);
    this.name       = 'ProviderHttpError';
    this.statusCode = statusCode;
    this.url        = url;
  }
}

/**
 * Classify an error as TRANSIENT (retryable) or PERMANENT (skip).
 *
 * @param {Error} err
 * @returns {'TRANSIENT'|'PERMANENT'}
 */
function classifyError(err) {
  if (err instanceof ProviderHttpError) {
    if (TRANSIENT_HTTP_CODES.has(err.statusCode)) return 'TRANSIENT';
    if (PERMANENT_HTTP_CODES.has(err.statusCode)) return 'PERMANENT';
    // Unknown HTTP codes: treat as TRANSIENT (conservative).
    return 'TRANSIENT';
  }

  // Network errors (ECONNREFUSED, ETIMEDOUT, fetch failures, etc.)
  const networkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
                         'UND_ERR_CONNECT_TIMEOUT', 'TypeError'];
  if (networkErrors.some((code) =>
    err.code === code || err.name === code || err.constructor?.name === code
  )) {
    return 'TRANSIENT';
  }

  // Validation errors are permanent — retrying won't fix bad data.
  if (err.name === 'ValidationError' || err.name === 'SchemaValidationError') {
    return 'PERMANENT';
  }

  return 'TRANSIENT'; // Default: retry unknown errors
}

/**
 * Compute delay with full jitter.
 *
 * @param {number} attempt         — 0-indexed attempt number
 * @param {number} baseDelayMs
 * @param {number} maxDelayMs
 * @returns {number} ms to wait
 */
function computeDelay(attempt, baseDelayMs, maxDelayMs = 30_000) {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  // Full jitter: uniform random in [0, exponential]
  return Math.floor(Math.random() * exponential);
}

/**
 * Execute an async function with exponential-backoff retries.
 *
 * @param {Function} fn              — () => Promise<T>
 * @param {object}   options
 * @param {number}   options.maxAttempts
 * @param {number}   options.baseDelayMs
 * @param {Function} [options.onRetry]  — (attempt, err, delayMs) => void
 * @returns {Promise<T>}
 */
async function execute(fn, { maxAttempts = 3, baseDelayMs = 1_000, onRetry } = {}) {
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const classification = classifyError(err);

      if (classification === 'PERMANENT') {
        throw err; // Don't retry permanent errors.
      }

      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        throw err;
      }

      const delayMs = computeDelay(attempt, baseDelayMs);
      if (typeof onRetry === 'function') {
        onRetry(attempt + 1, err, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastErr;
}

module.exports = { execute, classifyError, computeDelay, ProviderHttpError, TRANSIENT_HTTP_CODES, PERMANENT_HTTP_CODES };
