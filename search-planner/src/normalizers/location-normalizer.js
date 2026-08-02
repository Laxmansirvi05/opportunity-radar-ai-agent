'use strict';

/**
 * location-normalizer.js
 *
 * Normalizes location strings and assigns them to geographic tiers for
 * Tier 4 query generation.
 *
 * Geographic tier taxonomy (FINAL_ARCHITECTURE.md § 16):
 *   - local:        city-level or metro-area (highest precision)
 *   - regional:     state / province / country region
 *   - national:     country-wide
 *   - remote:       fully remote (no physical constraint)
 *   - international: cross-border (visa-sponsoring roles, etc.)
 *
 * DETERMINISTIC — no LLM calls, no I/O.
 */

// Explicit remote indicators.
const REMOTE_PATTERNS = [
  /\bremote\b/i,
  /\bwork from home\b/i,
  /\bwfh\b/i,
  /\banywhere\b/i,
  /\bfully distributed\b/i,
  /\bdistributed team\b/i,
];

// Country-level strings that indicate national scope.
const NATIONAL_PATTERNS = [
  /\bunited states\b/i,
  /\busa\b/i,
  /\bu\.s\.\b/i,
  /\bnationwide\b/i,
  /\bnational\b/i,
];

// State / province abbreviations and full names (US-centric, expandable).
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/**
 * Classify a location string into a geographic tier.
 *
 * @param {string} location
 * @returns {'remote'|'local'|'regional'|'national'|'international'}
 */
function classifyLocation(location) {
  if (typeof location !== 'string' || !location.trim()) return 'national';

  const trimmed = location.trim();

  if (REMOTE_PATTERNS.some((p) => p.test(trimmed))) return 'remote';
  if (NATIONAL_PATTERNS.some((p) => p.test(trimmed))) return 'national';

  // "City, ST" or "City, State" patterns → local
  const cityState = trimmed.match(/^[^,]+,\s*([A-Z]{2})$/);
  if (cityState && US_STATES.has(cityState[1].toUpperCase())) return 'local';

  // Bare state abbreviation → regional
  if (US_STATES.has(trimmed.toUpperCase())) return 'regional';

  // Multi-word with a country → international
  if (/\b(canada|uk|united kingdom|germany|india|australia|singapore|ireland)\b/i.test(trimmed)) {
    return 'international';
  }

  // Default: treat unknown as local (most conservative; doesn't broaden search)
  return 'local';
}

/**
 * Normalize a location string.
 * Currently: trims whitespace and collapses internal runs of spaces.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeLocation(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Normalize and deduplicate a location list, attaching tier metadata.
 *
 * @param {string[]} rawLocations
 * @returns {Array<{ location: string, tier: string }>}
 */
function normalizeLocations(rawLocations) {
  if (!Array.isArray(rawLocations) || rawLocations.length === 0) {
    // Default: national + remote so the search has breadth.
    return [
      { location: 'United States', tier: 'national' },
      { location: 'Remote',        tier: 'remote'   },
    ];
  }

  const seen   = new Set();
  const result = [];

  for (const raw of rawLocations) {
    const normalized = normalizeLocation(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ location: normalized, tier: classifyLocation(normalized) });
    }
  }

  // Always ensure a remote option is present for maximum recall.
  if (!result.some((l) => l.tier === 'remote')) {
    result.push({ location: 'Remote', tier: 'remote' });
  }

  return result;
}

/**
 * Extract the plain location strings for embedding into query keyword lists.
 *
 * @param {Array<{ location: string, tier: string }>} normalizedLocations
 * @returns {string[]}
 */
function locationStrings(normalizedLocations) {
  return normalizedLocations.map((l) => l.location);
}

module.exports = { classifyLocation, normalizeLocation, normalizeLocations, locationStrings };
