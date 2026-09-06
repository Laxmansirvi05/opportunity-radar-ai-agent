'use strict';
const { fuzzy } = require('fast-fuzzy');

function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

/** Exact URL/content hash, then title+organization fuzzy matching; semantic
 * similarity is accepted when a caller supplies a local pgvector score. */
function findDuplicate(candidate, existing, { fuzzyThreshold = 0.88, semanticThreshold = 0.92 } = {}) {
  for (const item of existing) {
    if (candidate.content_hash && candidate.content_hash === item.content_hash) return { duplicate: item, reason: 'content_hash' };
    if (candidate.apply_url && candidate.apply_url === item.apply_url) return { duplicate: item, reason: 'apply_url' };
    const sameOrg = normalize(candidate.company) && normalize(candidate.company) === normalize(item.company);
    if (sameOrg && fuzzy(normalize(candidate.title), normalize(item.title)) >= fuzzyThreshold) return { duplicate: item, reason: 'title_org_fuzzy' };
    if (typeof item.semantic_similarity === 'number' && item.semantic_similarity >= semanticThreshold) return { duplicate: item, reason: 'pgvector_semantic' };
  }
  return { duplicate: null, reason: null };
}
module.exports = { findDuplicate, normalize };
