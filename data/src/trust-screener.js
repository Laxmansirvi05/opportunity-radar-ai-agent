'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Phase 7 — Trust & Fraud Screening Gate.
 *
 * Three-way classification: trusted / needs_review / excluded.
 * All patterns are loaded from the external config/trust-patterns.json
 * so they can be edited without touching code.
 *
 * Signals:
 *   1. Suspicious-keyword heuristics (payment/credential/MLM/unrealistic)
 *   2. Domain-organization consistency check
 *   3. Description completeness scoring
 *   4. Suspicious TLD detection
 */

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'trust-patterns.json');
let _config = null;

function loadConfig() {
  if (!_config) {
    _config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Pre-compile all regex patterns for performance
    _config._compiled = {};
    for (const [category, patterns] of Object.entries(_config.suspicious_keywords)) {
      if (category === '_doc') continue;
      _config._compiled[category] = patterns.map((p) => new RegExp(p, 'i'));
    }
    _config._compiledTld = (_config.suspicious_tld_patterns || []).map((p) => new RegExp(p, 'i'));
  }
  return _config;
}

/** Reset cached config (useful for testing). */
function resetConfig() { _config = null; }

// ──────────────────────────────────────────────────────────────────────
// Signal 1: Suspicious keyword matching
// ──────────────────────────────────────────────────────────────────────

/**
 * Scan text for suspicious patterns across all categories.
 * Returns { flagged: boolean, matches: [{ category, pattern, snippet }] }
 */
function scanKeywords(text) {
  if (!text || typeof text !== 'string') return { flagged: false, matches: [] };
  const config = loadConfig();
  const matches = [];
  for (const [category, regexes] of Object.entries(config._compiled)) {
    for (const re of regexes) {
      const m = text.match(re);
      if (m) {
        matches.push({
          category,
          pattern: re.source,
          snippet: text.substring(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim(),
        });
      }
    }
  }
  return { flagged: matches.length > 0, matches };
}

// ──────────────────────────────────────────────────────────────────────
// Signal 2: Domain-organization consistency
// ──────────────────────────────────────────────────────────────────────

/**
 * Check whether the apply_url domain plausibly matches the stated company.
 * Returns { consistent: boolean, reason: string }
 */
function checkDomainOrgConsistency(applyUrl, company) {
  if (!applyUrl || !company) return { consistent: false, reason: 'missing_data' };

  let host;
  try {
    host = new URL(applyUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return { consistent: false, reason: 'invalid_url' };
  }

  const config = loadConfig();

  // Known trusted ATS domains are always consistent
  if (config.trusted_ats_domains.some((d) => host === d || host.endsWith(`.${d}`))) {
    return { consistent: true, reason: 'trusted_ats' };
  }

  // Check if company name appears in the domain
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, '');
  const domainSlug = host.replace(/[^a-z0-9]/g, '');
  if (slug.length >= 3 && domainSlug.includes(slug)) {
    return { consistent: true, reason: 'company_in_domain' };
  }

  // Check for suspicious TLDs
  if (config._compiledTld.some((re) => re.test(host))) {
    return { consistent: false, reason: 'suspicious_tld' };
  }

  // Neutral — can't confirm or deny
  return { consistent: true, reason: 'neutral' };
}

// ──────────────────────────────────────────────────────────────────────
// Signal 3: Description completeness
// ──────────────────────────────────────────────────────────────────────

/**
 * Score how complete a listing is (0.0 – 1.0).
 * Missing required_signals penalize heavily; missing quality_signals penalize lightly.
 */
function scoreCompleteness(listing) {
  const config = loadConfig();
  const { required_signals, quality_signals } = config.description_completeness;

  let score = 1.0;
  const missing = [];

  for (const field of required_signals) {
    const val = listing[field];
    if (!val || (typeof val === 'string' && val.trim().length === 0)) {
      score -= 0.25;
      missing.push(field);
    }
  }

  for (const field of quality_signals) {
    const val = listing[field];
    const isEmpty = !val ||
      (typeof val === 'string' && val.trim().length === 0) ||
      (Array.isArray(val) && val.length === 0);
    if (isEmpty) {
      score -= 0.05;
      missing.push(field);
    }
  }

  return { score: Math.max(0, Math.min(1, score)), missing };
}

// ──────────────────────────────────────────────────────────────────────
// Main classifier
// ──────────────────────────────────────────────────────────────────────

/**
 * Classify a listing into one of three trust levels.
 *
 * @param {object} listing - Must have at minimum: title, company, description, apply_url
 * @returns {{ verdict: 'trusted'|'needs_review'|'excluded', trust_score: number,
 *             signals: object, fraud_flagged: boolean, scam_flagged: boolean }}
 */
function classifyTrust(listing) {
  const text = [
    listing.title || '',
    listing.description || '',
    ...(Array.isArray(listing.requirements) ? listing.requirements : []),
  ].join(' ');

  // Signal 1: keyword scan
  const keywords = scanKeywords(text);

  // Signal 2: domain-org consistency
  const domainCheck = checkDomainOrgConsistency(listing.apply_url, listing.company);

  // Signal 3: completeness
  const completeness = scoreCompleteness(listing);

  // ── Scoring logic ──
  // Start at 1.0, deduct based on signals
  let trustScore = 1.0;
  let fraudFlagged = false;
  let scamFlagged = false;

  // Payment/credential patterns are hard excludes
  const hardExcludeCategories = ['payment_requests', 'credential_harvesting'];
  const hardMatches = keywords.matches.filter((m) => hardExcludeCategories.includes(m.category));
  if (hardMatches.length > 0) {
    trustScore -= 0.6;
    scamFlagged = true;
  }

  // MLM/unrealistic are strong signals
  const softMatches = keywords.matches.filter((m) => !hardExcludeCategories.includes(m.category));
  if (softMatches.length > 0) {
    trustScore -= 0.3;
    fraudFlagged = true;
  }

  // Domain inconsistency
  if (domainCheck.reason === 'suspicious_tld') {
    trustScore -= 0.3;
    fraudFlagged = true;
  } else if (domainCheck.reason === 'missing_data' || domainCheck.reason === 'invalid_url') {
    trustScore -= 0.15;
  }

  // Completeness — weight increased so sparse listings can't slip through.
  // Missing *required* fields (title/company/description) are an automatic
  // needs_review floor regardless of final score.
  const missingRequired = completeness.missing.filter((f) =>
    (loadConfig().description_completeness.required_signals || []).includes(f));
  trustScore -= (1 - completeness.score) * 0.5;

  trustScore = Math.max(0, Math.min(1, trustScore));

  // ── Three-way verdict ──
  let verdict;
  if (scamFlagged || trustScore < 0.3) {
    verdict = 'excluded';
  } else if (fraudFlagged || trustScore < 0.6 || missingRequired.length > 0) {
    verdict = 'needs_review';
  } else {
    verdict = 'trusted';
  }

  return {
    verdict,
    trust_score: Math.round(trustScore * 100) / 100,
    signals: {
      keywords,
      domain: domainCheck,
      completeness,
    },
    fraud_flagged: fraudFlagged,
    scam_flagged: scamFlagged,
  };
}

module.exports = { classifyTrust, scanKeywords, checkDomainOrgConsistency, scoreCompleteness, loadConfig, resetConfig };
