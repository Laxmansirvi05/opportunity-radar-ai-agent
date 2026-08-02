'use strict';

/**
 * title-normalizer.js
 *
 * Normalizes and expands role titles from a Candidate Intelligence Profile.
 *
 * Responsibilities:
 *   - Deduplicate titles (case-insensitive)
 *   - Apply canonical aliases (e.g. "SWE" → "Software Engineer")
 *   - Expand career-stage prefixes for search relevance
 *     (e.g. "Backend Engineer" + careerStage "student" → also add "Backend Engineering Intern")
 *   - Strip overly senior qualifiers that a student/early-career candidate
 *     would never match (senior, staff, principal, director)
 *
 * This normalizer is DETERMINISTIC — same input always produces same output.
 * No LLM calls. No I/O.
 */

// Canonical aliases: raw → normalized form.
// Checked case-insensitively against the incoming title.
const TITLE_ALIASES = new Map([
  ['swe', 'Software Engineer'],
  ['software developer', 'Software Engineer'],
  ['software development engineer', 'Software Engineer'],
  ['programmer', 'Software Engineer'],
  ['sde', 'Software Engineer'],
  ['ml engineer', 'Machine Learning Engineer'],
  ['machine learning', 'Machine Learning Engineer'],
  ['ai engineer', 'AI Engineer'],
  ['data scientist', 'Data Scientist'],
  ['data engineer', 'Data Engineer'],
  ['frontend developer', 'Frontend Engineer'],
  ['front-end developer', 'Frontend Engineer'],
  ['front end developer', 'Frontend Engineer'],
  ['backend developer', 'Backend Engineer'],
  ['back-end developer', 'Backend Engineer'],
  ['back end developer', 'Backend Engineer'],
  ['full-stack developer', 'Full Stack Engineer'],
  ['full stack developer', 'Full Stack Engineer'],
  ['fullstack developer', 'Full Stack Engineer'],
  ['devops', 'DevOps Engineer'],
  ['site reliability', 'Site Reliability Engineer'],
  ['sre', 'Site Reliability Engineer'],
  ['security engineer', 'Security Engineer'],
  ['infosec', 'Security Engineer'],
  ['product manager', 'Product Manager'],
  ['pm', 'Product Manager'],
  ['ux designer', 'UX Designer'],
  ['ui designer', 'UI Designer'],
  ['ux/ui designer', 'UX/UI Designer'],
  ['research scientist', 'Research Scientist'],
  ['research engineer', 'Research Engineer'],
]);

// Career-stage sets for expansion decisions.
const INTERN_STAGES      = new Set(['student']);           // → 'Intern' / 'Internship' suffixes
const ENTRY_LEVEL_STAGES = new Set(['early-career']);      // → 'Junior' / 'Entry Level' prefixes

// Suffixes to try when generating Tier 1 search queries.
const INTERN_SUFFIXES = ['Intern', 'Internship'];
const ENTRY_SUFFIXES = ['', 'Junior', 'Entry Level', 'New Grad'];

// Qualifiers that indicate seniority beyond a student/early-career candidate.
const SENIOR_QUALIFIERS = /\b(senior|sr\.|staff|principal|lead|director|vp|head of|manager|architect)\b/i;

/**
 * Normalize a single title string.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeTitle(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  return TITLE_ALIASES.get(lower) || trimmed;
}

/**
 * Normalize and deduplicate an array of titles.
 * Removes senior qualifiers and empty strings.
 *
 * @param {string[]} rawTitles
 * @returns {string[]}
 */
function normalizeTitles(rawTitles) {
  if (!Array.isArray(rawTitles)) return [];

  const seen = new Set();
  const result = [];

  for (const raw of rawTitles) {
    const normalized = normalizeTitle(raw);
    if (!normalized) continue;
    if (SENIOR_QUALIFIERS.test(normalized)) continue;

    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

/**
 * Expand a normalized title into career-stage-appropriate search variants.
 *
 * For a student, "Backend Engineer" becomes:
 *   ["Backend Engineer Intern", "Backend Engineering Internship"]
 *
 * For early-career, "Backend Engineer" becomes:
 *   ["Backend Engineer", "Junior Backend Engineer", "Entry Level Backend Engineer"]
 *
 * @param {string} title        — already normalized
 * @param {string} careerStage  — from CIP meta.careerStage
 * @returns {string[]}
 */
function expandTitleForStage(title, careerStage) {
  const stage = (careerStage || '').toLowerCase();
  const result = new Set();

  if (INTERN_STAGES.has(stage)) {
    for (const suffix of INTERN_SUFFIXES) {
      result.add(`${title} ${suffix}`);
    }
  } else {
    for (const suffix of ENTRY_SUFFIXES) {
      result.add(suffix ? `${suffix} ${title}` : title);
    }
  }

  return [...result];
}

module.exports = { normalizeTitle, normalizeTitles, expandTitleForStage, SENIOR_QUALIFIERS };
