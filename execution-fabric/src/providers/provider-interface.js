'use strict';

/**
 * provider-interface.js
 *
 * Defines the Provider contract and shared utilities for all adapters.
 *
 * Every provider adapter MUST implement:
 *   - name:               string identifier (used in circuit breaker, event logging)
 *   - supports(query):    boolean — whether this provider can execute this query
 *   - execute(query, opt): Promise<RawProviderResult[]>
 *
 * ProviderResult shape (normalized across all adapters):
 *   {
 *     title:           string | null
 *     company:         string | null
 *     location:        string | null
 *     workplaceType:   'remote' | 'hybrid' | 'onsite' | 'unknown'
 *     employmentType:  'internship' | 'full-time' | 'part-time' | 'contract' | 'temporary' | 'unknown'
 *     description:     string | null
 *     requirements:    string[]
 *     skills:          string[]
 *     applicationUrl:  string | null
 *     deadline:        string | null  (YYYY-MM-DD)
 *     sourceUrl:       string         (URL that was fetched)
 *     rawJson:         object         (full raw payload for auditability)
 *   }
 *
 * This shape matches what opportunity-repository.upsertOpportunity() expects,
 * after the validator has run validateOpportunity() from opportunity-schema.js.
 *
 * Provider errors:
 *   Adapters MUST throw ProviderHttpError (from retry-policy.js) for HTTP
 *   errors so the retry policy can correctly classify them as TRANSIENT or
 *   PERMANENT without inspecting raw error messages.
 */

const { ProviderHttpError } = require('../retry-policy');

/**
 * Make a JSON fetch with standard error handling.
 * Uses Node 18 native fetch — no external dependency.
 *
 * @param {string} url
 * @param {object} [options]  — standard fetch options
 * @param {number} [timeoutMs]
 * @returns {Promise<object>}
 */
async function fetchJson(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });

    if (!res.ok) {
      throw new ProviderHttpError(res.status, `HTTP ${res.status} from ${url}`, url);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof ProviderHttpError) throw err;
    // AbortError → treat as timeout (TRANSIENT)
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize a raw employment type string to the canonical enum.
 *
 * @param {string} raw
 * @returns {'internship'|'full-time'|'part-time'|'contract'|'temporary'|'unknown'}
 */
function normalizeEmploymentType(raw) {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('intern'))    return 'internship';
  if (lower.includes('full'))      return 'full-time';
  if (lower.includes('part'))      return 'part-time';
  if (lower.includes('contract'))  return 'contract';
  if (lower.includes('temp'))      return 'temporary';
  return 'unknown';
}

/**
 * Normalize a raw workplace type string to the canonical enum.
 *
 * @param {string} raw
 * @returns {'remote'|'hybrid'|'onsite'|'unknown'}
 */
function normalizeWorkplaceType(raw) {
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('remote'))  return 'remote';
  if (lower.includes('hybrid'))  return 'hybrid';
  if (lower.includes('onsite') || lower.includes('on-site') || lower.includes('office')) return 'onsite';
  return 'unknown';
}

module.exports = { fetchJson, normalizeEmploymentType, normalizeWorkplaceType, ProviderHttpError };
