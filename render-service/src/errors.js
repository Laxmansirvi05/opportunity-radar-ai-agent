'use strict';

/**
 * Base class for all errors that should be surfaced to API callers as
 * structured JSON with a meaningful HTTP status code. Anything that is NOT
 * an AppError is treated as an unexpected internal error and masked with a
 * generic 500 in the central error handler.
 */
class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

class NavigationError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 502, code: 'NAVIGATION_ERROR', details });
  }
}

class RenderTimeoutError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 504, code: 'RENDER_TIMEOUT', details });
  }
}

class CloudflareChallengeError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 502, code: 'CLOUDFLARE_CHALLENGE_UNRESOLVED', details });
  }
}

class BrowserCrashError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 502, code: 'BROWSER_CRASH', details });
  }
}

class QueueFullError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 503, code: 'QUEUE_FULL', details });
  }
}

class BrowserUnavailableError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 503, code: 'BROWSER_UNAVAILABLE', details });
  }
}

module.exports = {
  AppError,
  ValidationError,
  NavigationError,
  RenderTimeoutError,
  CloudflareChallengeError,
  BrowserCrashError,
  QueueFullError,
  BrowserUnavailableError,
};
