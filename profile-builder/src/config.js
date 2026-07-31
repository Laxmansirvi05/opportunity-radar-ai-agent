'use strict';

/**
 * Profile Builder — Configuration
 *
 * Loads this service's own environment variables (gateway connectivity).
 * PostgreSQL and Redis configuration is loaded by the shared data package
 * (data/src/config.js) which also reads from process.env — so this file
 * must be required FIRST in the entry point to ensure dotenv populates
 * process.env before anything else runs.
 *
 * Required env vars:
 *   GATEWAY_BASE_URL   — Base URL of the AI Gateway (default: http://localhost:4000)
 *   GATEWAY_API_KEY    — API key for Gateway authentication (required)
 */

require('dotenv').config();

/**
 * Loads and validates the profile-builder configuration.
 *
 * @returns {Readonly<{ gatewayBaseUrl: string, gatewayApiKey: string }>}
 */
function loadConfig() {
  const gatewayBaseUrl = (process.env.GATEWAY_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  const gatewayApiKey  = process.env.GATEWAY_API_KEY || '';

  if (!gatewayApiKey) {
    throw new Error(
      '[profile-builder/config] GATEWAY_API_KEY is required but was not set. ' +
      'Copy .env.example to .env and fill in the value.'
    );
  }

  return Object.freeze({ gatewayBaseUrl, gatewayApiKey });
}

module.exports = { loadConfig };
