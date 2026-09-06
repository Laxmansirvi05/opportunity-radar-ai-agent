'use strict';

const cities = require('./data/cities.json');

/**
 * Normalizes a string for matching (lowercase, strips punctuation)
 */
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
}

/**
 * Extracts a definitive country from a free-text location string.
 * @param {string} locationStr - e.g. "San Francisco, CA", "Remote - UK", "London"
 * @returns {string} The country name (e.g. "US", "UK", "India"), or "remote" if purely remote, or "unknown".
 */
function resolveCountry(locationStr) {
  const norm = normalize(locationStr);

  if (!norm) return 'unknown';

  // Explicitly check for remote.
  // Note: if it's "Remote - US", we should probably extract "US".
  // Let's check for country/city matches first.
  let isRemote = norm.includes('remote') || norm.includes('anywhere');

  // Hardcoded direct country matches
  const countryMap = {
    'united states': 'US',
    'us': 'US',
    'usa': 'US',
    'united kingdom': 'UK',
    'uk': 'UK',
    'great britain': 'UK',
    'india': 'India',
    'canada': 'Canada',
    'australia': 'Australia',
    'germany': 'Germany',
    'france': 'France',
    'singapore': 'Singapore',
    'japan': 'Japan'
  };

  // 1. Direct country match
  // Use regex word boundaries to avoid matching "us" inside "austin"
  for (const [key, val] of Object.entries(countryMap)) {
    const regex = new RegExp(`\\b${key}\\b`);
    if (regex.test(norm)) {
      return val;
    }
  }

  // 2. City match via gazetteer
  for (const entry of cities) {
    const cityNorm = normalize(entry.city);
    const regex = new RegExp(`\\b${cityNorm}\\b`);
    if (regex.test(norm)) {
      return entry.country;
    }
  }

  if (isRemote) return 'remote';
  return 'unknown';
}

module.exports = { resolveCountry };
