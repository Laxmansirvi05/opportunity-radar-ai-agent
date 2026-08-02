'use strict';

/**
 * adapters/lever.js
 *
 * Lever ATS public JSON API adapter.
 *
 * API endpoint: GET https://api.lever.co/v0/postings/{company}?mode=json&limit=50
 * Returns structured JSON array — no browser rendering or LLM extraction needed.
 *
 * supports(): true if tier 1 or 2 AND Lever companies are configured.
 */

const { fetchJson, normalizeEmploymentType, normalizeWorkplaceType } = require('../provider-interface');

const LEVER_API_BASE = 'https://api.lever.co/v0/postings';

function matchesKeywords(posting, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const searchable = [
    posting.text || '',
    posting.categories?.team       || '',
    posting.categories?.department || '',
    posting.categories?.location   || '',
  ].join(' ').toLowerCase();
  return keywords.some((kw) => searchable.includes(kw.toLowerCase()));
}

function mapPosting(posting, company) {
  const location      = posting.categories?.location    || null;
  const commitment    = posting.categories?.commitment  || '';
  const workplaceType = location?.toLowerCase().includes('remote') ? 'remote'
    : normalizeWorkplaceType(location || '');

  return {
    title:          posting.text || null,
    company,
    location,
    workplaceType,
    employmentType: normalizeEmploymentType(commitment),
    description:    posting.descriptionPlain || null,
    requirements:   [],
    skills:         [],
    applicationUrl: posting.hostedUrl || null,
    deadline:       null,
    sourceUrl:      `${LEVER_API_BASE}/${company}`,
    rawJson:        posting,
  };
}

const leverAdapter = {
  name: 'lever',

  supports(query, config) {
    const companies = config?.leverCompanies || [];
    return companies.length > 0 && (query.tier === 1 || query.tier === 2);
  },

  async execute(query, { config, timeoutMs = 30_000 } = {}) {
    const companies = config?.leverCompanies || [];
    const results   = [];

    for (const company of companies) {
      const url = `${LEVER_API_BASE}/${company}?mode=json&limit=50`;
      try {
        const postings = await fetchJson(url, {}, timeoutMs);
        // Lever returns an array directly.
        const arr = Array.isArray(postings) ? postings : [];
        const mapped = arr
          .filter((p) => matchesKeywords(p, query.keywords))
          .map((p)   => mapPosting(p, company));
        results.push(...mapped);
      } catch (err) {
        if (err.statusCode === 404) continue;
        throw err;
      }
    }

    return results;
  },
};

module.exports = leverAdapter;
