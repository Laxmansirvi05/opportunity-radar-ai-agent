'use strict';

/**
 * opportunity-type.js
 *
 * Derives the opportunity-type target (internship vs job) from the candidate's
 * education end year.
 *
 * This exists because `careerStage` cannot express the year rule: a 2nd-year and
 * a final-year student are both "student", so routing on careerStage alone sends
 * graduating students to internships. This module is the separate signal; it does
 * NOT overload or replace careerStage, which still drives seniority filtering.
 *
 * DETERMINISTIC — same inputs and same currentYear always produce the same target.
 */

const INTERNSHIP = 'internship';
const JOB = 'job';

// Sanity bounds for a parsed graduation year; anything outside is treated as
// unparseable rather than trusted, so a typo cannot silently reroute a candidate.
const MIN_PLAUSIBLE_YEAR = 1950;
const MAX_YEARS_AHEAD = 15;

/**
 * Parse an education entry's endYear into an integer year, or null if absent
 * or not plausibly a year.
 *
 * @param {unknown} value
 * @param {number} currentYear
 * @returns {number|null}
 */
function parseEndYear(value, currentYear) {
  let year = null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    year = Math.trunc(value);
  } else if (typeof value === 'string') {
    // Accepts "2027" and leading-year forms such as "2027-05" or "2027/05".
    const match = value.trim().match(/^(\d{4})\b/);
    if (match) year = Number(match[1]);
  }

  if (year === null) return null;
  if (year < MIN_PLAUSIBLE_YEAR || year > currentYear + MAX_YEARS_AHEAD) return null;
  return year;
}

/**
 * Select the most recent (highest) parseable endYear across all education entries.
 *
 * @param {unknown} education
 * @param {number} currentYear
 * @returns {number|null}
 */
function mostRecentEndYear(education, currentYear) {
  if (!Array.isArray(education)) return null;

  let latest = null;
  for (const entry of education) {
    if (!entry || typeof entry !== 'object') continue;
    const year = parseEndYear(entry.endYear, currentYear);
    if (year !== null && (latest === null || year > latest)) latest = year;
  }
  return latest;
}

/**
 * Derive the opportunity-type target for a candidate.
 *
 * Routing rules (relative to currentYear):
 *   endYear >= currentYear + 2      → internship          (still has years of study left)
 *   endYear is currentYear or +1    → job, internship fallback  (graduating now/soon)
 *   endYear <  currentYear          → job only            (already graduated)
 *   no parseable endYear            → fall back to careerStage, and record that it fired
 *
 * @param {object} params
 * @param {Array} [params.education]     — CIP literal.education entries
 * @param {string} [params.careerStage]  — CIP inferred.careerStage.value (fallback only)
 * @param {number} [params.currentYear]  — injectable for deterministic tests
 * @returns {Readonly<{
 *   primary: string,
 *   fallback: string[],
 *   source: string,
 *   endYear: number|null,
 *   yearsUntilGraduation: number|null,
 *   fallbackReason: string|null
 * }>}
 */
function deriveOpportunityTarget({ education, careerStage, currentYear = new Date().getFullYear() } = {}) {
  const endYear = mostRecentEndYear(education, currentYear);

  if (endYear === null) {
    const stage = typeof careerStage === 'string' ? careerStage.toLowerCase() : '';
    const primary = stage === 'student' ? INTERNSHIP : JOB;
    return Object.freeze({
      primary,
      fallback: Object.freeze([]),
      source: 'career_stage_fallback',
      endYear: null,
      yearsUntilGraduation: null,
      fallbackReason: `no parseable education endYear; routed from careerStage "${careerStage || 'unknown'}"`,
    });
  }

  const yearsUntilGraduation = endYear - currentYear;

  if (yearsUntilGraduation >= 2) {
    return Object.freeze({
      primary: INTERNSHIP,
      fallback: Object.freeze([]),
      source: 'education_end_year',
      endYear,
      yearsUntilGraduation,
      fallbackReason: null,
    });
  }

  if (yearsUntilGraduation >= 0) {
    return Object.freeze({
      primary: JOB,
      fallback: Object.freeze([INTERNSHIP]),
      source: 'education_end_year',
      endYear,
      yearsUntilGraduation,
      fallbackReason: null,
    });
  }

  return Object.freeze({
    primary: JOB,
    fallback: Object.freeze([]),
    source: 'education_end_year',
    endYear,
    yearsUntilGraduation,
    fallbackReason: null,
  });
}

module.exports = {
  deriveOpportunityTarget,
  parseEndYear,
  mostRecentEndYear,
  INTERNSHIP,
  JOB,
};
