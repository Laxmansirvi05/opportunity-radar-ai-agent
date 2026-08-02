'use strict';

/**
 * providers/index.js — Provider Registry
 *
 * Registers all available adapters and provides the select() function
 * that returns which providers should execute a given query.
 *
 * Provider priority order (structured APIs first, web render last):
 *   1. Greenhouse (structured JSON, no LLM)
 *   2. Lever      (structured JSON, no LLM)
 *   3. Ashby      (structured JSON, no LLM)
 *   4. WebRender  (fallback: render-service + AI Gateway)
 *
 * The Execution Fabric passes this registry to every Worker.
 * Workers call select(query) to get their provider list — they
 * do NOT import adapters directly.
 *
 * Architecture guarantee: the registry is the ONLY place that knows
 * about specific providers. Workers and Orchestrator are provider-agnostic.
 */

const greenhouse = require('./adapters/greenhouse');
const lever      = require('./adapters/lever');
const ashby      = require('./adapters/ashby');
const webRender  = require('./adapters/web-render');

// Ordered by preference: structured APIs before render-based.
const ALL_PROVIDERS = [greenhouse, lever, ashby, webRender];

/**
 * Select providers that support the given query.
 *
 * @param {object} query   — from SearchPlan
 * @param {object} config  — execution-fabric config (for company lists)
 * @returns {object[]}     — ordered list of matching provider adapters
 */
function select(query, config) {
  return ALL_PROVIDERS.filter((provider) => provider.supports(query, config));
}

/**
 * Get a provider by name (for circuit breaker key lookup).
 *
 * @param {string} name
 * @returns {object|undefined}
 */
function getByName(name) {
  return ALL_PROVIDERS.find((p) => p.name === name);
}

module.exports = { select, getByName, ALL_PROVIDERS };
