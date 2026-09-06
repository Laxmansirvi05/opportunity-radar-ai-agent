'use strict';

/*
 * Free-first discovery providers.  Each one returns the same small result
 * contract consumed by the existing n8n normalizer.  Providers that need a
 * locally hosted service or free-account key report unavailable rather than
 * making discovery depend on Tavily or any paid API.
 */

const PROVIDER_TIMEOUT_MS = 12_000;

async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function result({ title, url, content, score, provider, raw }) {
  return {
    title: typeof title === 'string' ? title : null,
    url: typeof url === 'string' ? url : null,
    content: typeof content === 'string' ? content : null,
    score: typeof score === 'number' ? score : null,
    provider,
    raw,
  };
}

function searxng({ baseUrl = process.env.SEARXNG_BASE_URL } = {}) {
  return {
    name: 'searxng',
    available: () => Boolean(baseUrl),
    async search(query) {
      const url = new URL('/search', baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      const payload = await getJson(url);
      return (payload.results || []).map((item) => result({
        title: item.title, url: item.url, content: item.content,
        score: item.score, provider: 'searxng', raw: item,
      })).filter((item) => item.url);
    },
  };
}

function jobSpy({ baseUrl = process.env.JOBSPY_API_URL } = {}) {
  return {
    name: 'jobspy',
    available: () => Boolean(baseUrl),
    async search(query) {
      const url = new URL('/jobs', baseUrl);
      url.searchParams.set('search_term', query);
      url.searchParams.set('site_name', 'indeed,glassdoor,google,zip_recruiter,bayt,bdjobs,naukri');
      url.searchParams.set('results_wanted', '10');
      // LinkedIn is deliberately absent: it is never a direct scrape source.
      const payload = await getJson(url);
      const jobs = Array.isArray(payload) ? payload : (payload.jobs || payload.results || []);
      return jobs.map((job) => result({
        title: job.title, url: job.job_url || job.url || job.apply_url,
        content: job.description, score: null, provider: 'jobspy', raw: job,
      })).filter((item) => item.url);
    },
  };
}

function tinyFish({ apiKey = process.env.TINYFISH_API_KEY, baseUrl = process.env.TINYFISH_SEARCH_URL || 'https://api.tinyfish.ai/v1/search' } = {}) {
  return {
    name: 'tinyfish',
    available: () => Boolean(apiKey),
    async search(query) {
      const payload = await getJson(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const hits = payload.results || payload.data || [];
      return hits.map((item) => result({
        title: item.title, url: item.url, content: item.content || item.snippet,
        score: item.score, provider: 'tinyfish', raw: item,
      })).filter((item) => item.url);
    },
  };
}

function simplifyJobs({ listingsUrl = process.env.SIMPLIFYJOBS_LISTINGS_URL || 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json' } = {}) {
  return {
    name: 'simplifyjobs',
    available: () => Boolean(listingsUrl),
    async search(query) {
      const payload = await getJson(listingsUrl);
      const listings = Array.isArray(payload) ? payload : (payload.listings || []);
      const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2).slice(0, 8);
      return listings.filter((listing) => {
        const haystack = `${listing.title || listing.role || ''} ${listing.company || ''} ${listing.location || ''}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }).slice(0, 10).map((listing) => result({
        title: listing.title || listing.role,
        url: listing.url || listing.apply_url || listing.link,
        content: listing.description || `${listing.company || ''} ${listing.location || ''}`.trim(),
        score: null, provider: 'simplifyjobs', raw: listing,
      })).filter((item) => item.url);
    },
  };
}

function createProviders(options = {}) {
  return [searxng(options.searxng), jobSpy(options.jobspy), tinyFish(options.tinyfish), simplifyJobs(options.simplifyjobs)];
}

async function searchFreeFirst(query, { providers = createProviders() } = {}) {
  const active = providers.filter((provider) => provider.available());
  const settled = await Promise.allSettled(active.map((provider) => provider.search(query)));
  const results = [];
  const providerStatus = active.map((provider, index) => {
    const outcome = settled[index];
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
      return { name: provider.name, status: 'ok', count: outcome.value.length };
    }
    return { name: provider.name, status: 'unavailable', error: outcome.reason.message, count: 0 };
  });
  return { query, results, providers: providerStatus };
}

module.exports = { createProviders, searchFreeFirst, searxng, jobSpy, tinyFish, simplifyJobs };
