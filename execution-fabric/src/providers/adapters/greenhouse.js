'use strict';

/**
 * adapters/greenhouse.js
 *
 * Greenhouse ATS public JSON API adapter.
 *
 * API endpoint: GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs
 * Returns structured JSON — no browser rendering or LLM extraction needed.
 *
 * supports(): true if the query tier is 1 or 2 AND at least one Greenhouse
 * company is configured.  This adapter does not support geographic Tier 4
 * queries because Greenhouse API does not support keyword search — it
 * returns ALL jobs for a company and we filter client-side.
 *
 * execute(): iterates configured company slugs, calls the Greenhouse API for
 * each, maps results to the normalized ProviderResult shape, and applies a
 * lightweight keyword filter from the query to reduce noise.
 *
 * Not all Greenhouse companies expose their jobs via the public boards API.
 * If the company returns a 404, we skip it silently (treated as no results).
 */

const { fetchJson, normalizeEmploymentType, normalizeWorkplaceType } = require('../provider-interface');

const GREENHOUSE_API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

/**
 * Check if a Greenhouse job matches the query keywords (client-side filter).
 *
 * @param {object} job        — Greenhouse job object
 * @param {string[]} keywords — from query.keywords
 * @returns {boolean}
 */
function matchesKeywords(job, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const searchable = [
    job.title || '',
    (job.location && job.location.name) || '',
    job.departments?.[0]?.name || '',
  ].join(' ').toLowerCase();
  // Match if ANY keyword appears in the searchable string.
  return keywords.some((kw) => searchable.includes(kw.toLowerCase()));
}

/**
 * Map a single Greenhouse job to the normalized ProviderResult shape.
 *
 * @param {object} job          — single Greenhouse job object
 * @param {string} company      — company slug
 * @returns {object}
 */
function mapJob(job, company) {
  return {
    title:          job.title    || null,
    company,
    location:       job.location?.name  || null,
    workplaceType:  job.location?.name?.toLowerCase().includes('remote') ? 'remote' : 'unknown',
    employmentType: normalizeEmploymentType(job.metadata?.find((m) => m.name === 'Employment Type')?.value || ''),
    description:    null, // Greenhouse boards API does not include description in list endpoint
    requirements:   [],
    skills:         [],
    applicationUrl: job.absolute_url || null,
    deadline:       null,
    sourceUrl:      `${GREENHOUSE_API_BASE}/${company}/jobs`,
    rawJson:        job,
  };
}

const greenhouseAdapter = {
  name: 'greenhouse',

  /**
   * Supports tier 1 and 2 queries when company list is configured.
   */
  supports(query, config) {
    const companies = config?.greenhouseCompanies || [];
    return companies.length > 0 && (query.tier === 1 || query.tier === 2);
  },

  /**
   * Execute the query against all configured Greenhouse companies.
   *
   * @param {object} query
   * @param {object} options
   * @param {object} options.config  — execution fabric config
   * @param {number} [options.timeoutMs]
   * @returns {Promise<object[]>}
   */
  async execute(query, { config, timeoutMs = 30_000 } = {}) {
    const companies = config?.greenhouseCompanies || [];
    const results   = [];

    for (const company of companies) {
      const url = `${GREENHOUSE_API_BASE}/${company}/jobs`;
      try {
        const data = await fetchJson(url, {}, timeoutMs);
        const jobs = (data.jobs || [])
          .filter((job) => matchesKeywords(job, query.keywords))
          .map((job) => mapJob(job, company));
        results.push(...jobs);
      } catch (err) {
        // 404 = company not on Greenhouse boards API — skip silently.
        if (err.statusCode === 404) continue;
        throw err;
      }
    }

    return results;
  },
};

module.exports = greenhouseAdapter;
