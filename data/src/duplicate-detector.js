'use strict';
const { fuzzy } = require('fast-fuzzy');

function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

/** Strip common corporate suffixes and generic industry words so
 *  "Acme Corp" ≈ "Acme Corporation", "HCL Technologies" keeps only "HCL". */
const CORP_SUFFIXES = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|pvt|private|plc|group|holdings|gmbh|sa|ag|se|technologies|technology|tech|services|solutions|systems|enterprises|industries|labs|studio|studios)\b/g;
function normalizeCompany(value) {
  return normalize(value).replace(CORP_SUFFIXES, '').replace(/\s+/g, ' ').trim();
}

/** Canonicalize common job-title synonyms so "intern" ≈ "internship",
 *  "engineer" ≈ "engineering", "developer" ≈ "development", etc. */
const TITLE_SYNONYMS = [
  [/\binternships?\b/g, 'intern'],
  [/\bengineering\b/g, 'engineer'],
  [/\bdevelopment\b/g, 'developer'],
  [/\bsr\b|\bsenior\b/g, 'senior'],
  [/\bjr\b|\bjunior\b/g, 'junior'],
];
function normalizeTitle(value) {
  let s = normalize(value);
  for (const [re, rep] of TITLE_SYNONYMS) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Symmetric fuzzy: always put the longer string first so fast-fuzzy's
 * substring-biased scoring doesn't give inflated scores when short strings
 * happen to be substrings of longer ones.
 */
function symFuzzy(a, b) {
  if (!a || !b) return 0;
  return a.length >= b.length ? fuzzy(a, b) : fuzzy(b, a);
}

/** Exact URL/content hash, then title+organization fuzzy matching; semantic
 * similarity is accepted when a caller supplies a local pgvector score.
 *
 * Company and title use SEPARATE thresholds, not one global number.
 * Company matching first strips corporate suffixes, then does a symmetric
 * fuzzy compare to avoid the short-substring inflation bug in fast-fuzzy.
 * Title matching canonicalizes intern/internship and engineer/engineering
 * synonyms before the fuzzy compare. */
function findDuplicate(candidate, existing, {
  titleThreshold = 0.85,
  companyThreshold = 0.80,
  semanticThreshold = 0.92,
} = {}) {
  for (const item of existing) {
    if (candidate.content_hash && candidate.content_hash === item.content_hash) return { duplicate: item, reason: 'content_hash' };
    if (candidate.apply_url && candidate.apply_url === item.apply_url) return { duplicate: item, reason: 'apply_url' };

    const candCompany = normalizeCompany(candidate.company);
    const itemCompany = normalizeCompany(item.company);
    const companyScore = symFuzzy(candCompany, itemCompany);
    const sameOrg = candCompany && itemCompany && companyScore >= companyThreshold;

    if (sameOrg) {
      const titleScore = symFuzzy(normalizeTitle(candidate.title), normalizeTitle(item.title));
      if (titleScore >= titleThreshold) return { duplicate: item, reason: 'title_org_fuzzy' };
    }
    if (typeof item.semantic_similarity === 'number' && item.semantic_similarity >= semanticThreshold) return { duplicate: item, reason: 'pgvector_semantic' };
  }
  return { duplicate: null, reason: null };
}
module.exports = { findDuplicate, normalize, normalizeCompany, normalizeTitle, symFuzzy };
