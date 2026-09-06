'use strict';

const crypto = require('node:crypto');

/**
 * Return a non-reversible identifier for the configured API key.
 *
 * This lets the job server verify that the key n8n will send is the one the
 * renderer accepts, without ever returning the secret from /health.
 */
function apiKeyFingerprint(apiKey) {
  if (!apiKey) return null;
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

module.exports = { apiKeyFingerprint };
