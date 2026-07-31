'use strict';

/**
 * Profile Builder — AI Gateway HTTP Client
 *
 * Handles all HTTP communication with the AI Gateway service.
 * The profile-builder never calls LLM providers directly — every AI call
 * goes through the Gateway, which owns provider routing, fallback, and retry.
 *
 * This module is intentionally thin: it translates a function call into
 * an HTTP request and a response into a plain object.  Error classification
 * and logging are the caller's responsibility (profile-builder.js).
 *
 * The fetch() global is available in Node.js >= 18.0.0 (stable in 18.17.0).
 */

/**
 * @typedef {Object} GatewayCallOptions
 * @property {string}  baseUrl    - AI Gateway base URL (no trailing slash).
 * @property {string}  apiKey     - Gateway API key.
 * @property {number}  [timeoutMs=90000] - Per-request timeout in milliseconds.
 */

/**
 * @typedef {Object} BuildProfileResult
 * @property {boolean} success
 * @property {string}  requestId
 * @property {Object}  data     - The validated CIP object returned by the Gateway task.
 */

/**
 * Calls the AI Gateway with the build_profile task.
 *
 * @param {string | Object} parsedResume - The parsed resume to profile (string or object).
 * @param {GatewayCallOptions} options
 * @returns {Promise<BuildProfileResult>}
 * @throws {GatewayClientError} on HTTP errors or non-success gateway responses.
 */
async function callBuildProfile(parsedResume, { baseUrl, apiKey, timeoutMs = 90_000 }) {
  const url = `${baseUrl}/api/ai/chat`;

  const input = typeof parsedResume === 'string' ? parsedResume : JSON.stringify(parsedResume);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key':    apiKey,
      },
      body:   JSON.stringify({ task: 'build_profile', input }),
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new GatewayClientError('GATEWAY_TIMEOUT', `AI Gateway request timed out after ${timeoutMs}ms`, { cause });
    }
    throw new GatewayClientError('GATEWAY_NETWORK_ERROR', `AI Gateway network request failed: ${cause.message}`, { cause });
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw new GatewayClientError(
      'GATEWAY_INVALID_RESPONSE',
      `AI Gateway returned non-JSON response (HTTP ${response.status})`,
      { cause }
    );
  }

  if (!response.ok || body.success !== true) {
    const code    = body?.error?.code    ?? 'GATEWAY_ERROR';
    const message = body?.error?.message ?? `AI Gateway returned HTTP ${response.status}`;
    throw new GatewayClientError(code, message, { status: response.status });
  }

  if (!body.data || typeof body.data !== 'object') {
    throw new GatewayClientError(
      'GATEWAY_INVALID_RESPONSE',
      'AI Gateway returned a success response with missing or invalid data field'
    );
  }

  return { success: true, requestId: body.requestId, data: body.data };
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

class GatewayClientError extends Error {
  /**
   * @param {string} code    - Machine-readable error code.
   * @param {string} message - Human-readable description.
   * @param {{ cause?: Error, status?: number }} [options]
   */
  constructor(code, message, { cause, status } = {}) {
    super(message, { cause });
    this.name   = 'GatewayClientError';
    this.code   = code;
    this.status = status ?? null;
  }
}

module.exports = { callBuildProfile, GatewayClientError };
