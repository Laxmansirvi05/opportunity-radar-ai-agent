'use strict';

/**
 * adapters/ashby.js
 *
 * Ashby ATS public API adapter.
 *
 * API endpoint: GET https://api.ashbyhq.com/posting-groups/listedPostings/{company}
 * Returns structured JSON — no browser rendering or LLM extraction needed.
 *
 * supports(): true if tier 1 or 2 AND Ashby companies are configured.
 */

const { fetchJson, normalizeEmploymentType, normalizeWorkplaceType } = require('../provider-interface');

const ASHBY_API_BASE = 'https://api.ashbyhq.com/posting-groups/listedPostings';

function matchesKeywords(posting, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const searchable = [
    posting.title      || '',
    posting.teamName   || '',
    posting.locationName || '',
  ].join(' ').toLowerCase();
  return keywords.some((kw) => searchable.includes(kw.toLowerCase()));
}

function mapPosting(posting, company) {
  const isRemote = posting.isRemote === true;
  return {
    title:          posting.title        || null,
    company,
    location:       posting.locationName || null,
    workplaceType:  isRemote ? 'remote' : normalizeWorkplaceType(posting.locationName || ''),
    employmentType: normalizeEmploymentType(posting.employmentType || ''),
    description:    null, // List endpoint does not include full description
    requirements:   [],
    skills:         [],
    applicationUrl: posting.jobPostingUrl || null,
    deadline:       null,
    sourceUrl:      `${ASHBY_API_BASE}/${company}`,
    rawJson:        posting,
  };
}

const ashbyAdapter = {
  name: 'ashby',

  supports(query, config) {
    const companies = config?.ashbyCompanies || [];
    return companies.length > 0 && (query.tier === 1 || query.tier === 2);
  },

  async execute(query, { config, timeoutMs = 30_000 } = {}) {
    const companies = config?.ashbyCompanies || [];
    const results   = [];

    for (const company of companies) {
      const url = `${ASHBY_API_BASE}/${company}`;
      try {
        const data = await fetchJson(url, {}, timeoutMs);
        // Ashby wraps in { success, data: { jobPostings: [...] } }
        const postings = data?.data?.jobPostings || [];
        const mapped = postings
          .filter((p) => matchesKeywords(p, query.keywords))
          .map((p)   => mapPosting(p, company));
        results.push(...mapped);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 400) continue;
        throw err;
      }
    }

    return results;
  },
};

module.exports = ashbyAdapter;
