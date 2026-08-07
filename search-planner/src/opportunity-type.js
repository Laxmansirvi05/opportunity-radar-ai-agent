'use strict';

/**
 * opportunity-type.js
 *
 * The product serves current students seeking INTERNSHIPS. Every candidate gets
 * internship results; this module no longer chooses between internship and job.
 *
 * The education end year is still extracted, but it is now a GUARD rather than a
 * router: it detects when a candidate does not look like a current student and
 * records that in the output, so the caller can surface it honestly instead of
 * silently treating a graduate as a student.
 *
 * DETERMINISTIC — same inputs and same currentYear always produce the same result.
 */

const INTERNSHIP = 'internship';

// Retained for callers that still map careerStage values; nothing routes to it.
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
 * Derive the opportunity target for a candidate.
 *
 * Always internship — that is the product. The end year is used only to classify
 * student status so a non-student can be flagged rather than silently served:
 *
 *   endYear >= currentYear      → current student
 *   endYear <  currentYear      → already graduated  (studentStatus 'graduated')
 *   no parseable endYear        → unknown, resolved from careerStage and recorded
 *
 * @param {object} params
 * @param {Array} [params.education]     — CIP literal.education entries
 * @param {string} [params.careerStage]  — CIP inferred.careerStage.value
 * @param {number} [params.currentYear]  — injectable for deterministic tests
 * @returns {Readonly<{
 *   primary: string,
 *   fallback: string[],
 *   source: string,
 *   endYear: number|null,
 *   yearsUntilGraduation: number|null,
 *   studentStatus: string,
 *   isCurrentStudent: boolean,
 *   fallbackReason: string|null
 * }>}
 */
function deriveOpportunityTarget({ education, careerStage, currentYear = new Date().getFullYear() } = {}) {
  const endYear = mostRecentEndYear(education, currentYear);

  if (endYear === null) {
    // careerStage still has to behave sanely for non-student values, so it
    // decides the student flag when the year is missing.
    const stage = typeof careerStage === 'string' ? careerStage.toLowerCase() : '';
    const looksStudent = stage === 'student';
    return Object.freeze({
      primary: INTERNSHIP,
      fallback: Object.freeze([]),
      source: 'career_stage_fallback',
      endYear: null,
      yearsUntilGraduation: null,
      studentStatus: looksStudent ? 'student' : 'unknown',
      isCurrentStudent: looksStudent,
      fallbackReason: `no parseable education endYear; student status inferred from careerStage "${careerStage || 'unknown'}"`,
    });
  }

  const yearsUntilGraduation = endYear - currentYear;
  const graduated = yearsUntilGraduation < 0;

  return Object.freeze({
    primary: INTERNSHIP,
    fallback: Object.freeze([]),
    source: 'education_end_year',
    endYear,
    yearsUntilGraduation,
    studentStatus: graduated ? 'graduated' : 'student',
    isCurrentStudent: !graduated,
    fallbackReason: graduated
      ? `education ended ${Math.abs(yearsUntilGraduation)} year(s) ago; candidate is not a current student but is still served internships`
      : null,
  });
}

module.exports = {
  deriveOpportunityTarget,
  parseEndYear,
  mostRecentEndYear,
  INTERNSHIP,
  JOB,
};
