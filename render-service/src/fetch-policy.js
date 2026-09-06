'use strict';

const Bottleneck = require('bottleneck');
const robotsParser = require('robots-parser');

const ROBOTS_TTL_MS = 60 * 60 * 1000;
const robotsCache = new Map();
const domainLimiters = new Bottleneck.Group({ maxConcurrent: 1, minTime: 750 });

async function loadRobots(origin, get = fetch) {
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.rules;
  let rules = null;
  try {
    const response = await get(new URL('/robots.txt', origin), { signal: AbortSignal.timeout(5000) });
    if (response.ok) rules = robotsParser(`${origin}/robots.txt`, await response.text());
  } catch { /* a network failure must not turn an otherwise reachable listing into a hard reject */ }
  robotsCache.set(origin, { rules, expiresAt: Date.now() + ROBOTS_TTL_MS });
  return rules;
}

async function assertFetchAllowed(url, { get = fetch, userAgent = 'OpportunityRadarBot' } = {}) {
  const parsed = new URL(url);
  const rules = await loadRobots(parsed.origin, get);
  if (rules && !rules.isAllowed(url, userAgent)) {
    const error = new Error(`robots.txt disallows ${parsed.pathname}`);
    error.code = 'ROBOTS_DISALLOWED';
    throw error;
  }
}

function scheduleByDomain(url, task) {
  return domainLimiters.key(new URL(url).hostname).schedule(task);
}

module.exports = { assertFetchAllowed, scheduleByDomain, loadRobots };
