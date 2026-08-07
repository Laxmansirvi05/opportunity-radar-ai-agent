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
const INTERN_STAGES      = new Set(['student']);                         // → 'Intern' / 'Internship' suffixes
const ENTRY_LEVEL_STAGES = new Set(['early-career']);                    // → 'Junior' / 'Entry Level' prefixes
const SENIOR_STAGES      = new Set(['senior', 'staff', 'principal']);    // → 'Senior X' / 'Staff X' variants

// Suffixes/prefixes to try when generating Tier 1 search queries.
const INTERN_SUFFIXES  = ['Intern', 'Internship'];
const ENTRY_SUFFIXES   = ['', 'Junior', 'Entry Level', 'New Grad'];
const SENIOR_PREFIXES  = ['Senior', 'Staff', 'Principal', ''];           // '' = bare title

// Qualifiers that indicate seniority beyond a student/early-career candidate.
const SENIOR_QUALIFIERS = /\b(senior|sr\.|staff|principal|lead|director|vp|head of|manager|architect)\b/i;

// Stage qualifiers that may already be baked into an incoming title. These are
// stripped before re-expanding so the stage signal comes from the candidate's
// actual situation rather than from whatever the resume or upstream LLM wrote.
const LEADING_STAGE_QUALIFIER  = /^(senior|sr\.?|staff|principal|lead|junior|jr\.?|entry[- ]level|new[- ]grad(uate)?|graduate|trainee|associate)\s+/i;
const TRAILING_STAGE_QUALIFIER = /\s+(intern|internship|trainee|co[- ]?op)$/i;

/**
 * Remove leading and trailing stage qualifiers from a title, leaving the
 * bare role. "Junior Frontend Developer Intern" → "Frontend Developer".
 *
 * @param {string} title
 * @returns {string}
 */
function stripStageQualifiers(title) {
  let base = typeof title === 'string' ? title.trim() : '';
  let previous;
  // Loop: titles can stack qualifiers ("Junior Trainee Engineer Intern").
  do {
    previous = base;
    base = base.replace(LEADING_STAGE_QUALIFIER, '').replace(TRAILING_STAGE_QUALIFIER, '').trim();
  } while (base !== previous && base !== '');
  // Never return empty — a title made only of qualifiers keeps its original form.
  return base || (typeof title === 'string' ? title.trim() : '');
}

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
function normalizeTitles(rawTitles, careerStage) {
  if (!Array.isArray(rawTitles)) return [];

  const stage = (careerStage || '').toLowerCase();
  // Only strip seniority qualifiers when the candidate is student/early-career.
  // Senior candidates' own job titles (e.g. "Senior AI Systems Architect") must be preserved.
  const stripSeniorQualifiers = (stage === 'student' || stage === 'early-career');

  const seen = new Set();
  const result = [];

  for (const raw of rawTitles) {
    const normalized = normalizeTitle(raw);
    if (!normalized) continue;
    if (stripSeniorQualifiers && SENIOR_QUALIFIERS.test(normalized)) continue;

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
function expandTitleForStage(title, careerStage, opportunityType) {
  const stage = (careerStage || '').toLowerCase();
  const result = new Set();

  // Strip any stage qualifier the incoming title already carries before
  // re-expanding. Resume-derived and LLM-derived titles frequently arrive as
  // "Frontend Developer Intern" or "Junior Backend Engineer"; without this we
  // produce "Frontend Developer Intern Intern", and — worse — a job-seeking
  // candidate keeps an "Intern" title that no longer applies to them.
  const baseTitle = stripStageQualifiers(title);

  // Opportunity type wins when supplied: a final-year student is careerStage
  // "student" but is searching for jobs, so must not get "X Intern" titles.
  // When omitted, fall back to career-stage behaviour.
  const wantsInternship = opportunityType
    ? opportunityType === 'internship'
    : INTERN_STAGES.has(stage);

  if (wantsInternship) {
    // internship target → intern/internship suffixes
    for (const suffix of INTERN_SUFFIXES) {
      result.add(`${baseTitle} ${suffix}`);
    }
  } else if (ENTRY_LEVEL_STAGES.has(stage) || INTERN_STAGES.has(stage)) {
    // early-career → Junior / Entry Level / New Grad prefixes
    for (const suffix of ENTRY_SUFFIXES) {
      result.add(suffix ? `${suffix} ${baseTitle}` : baseTitle);
    }
  } else {
    // senior / staff / principal / mid-career / unknown → seniority-appropriate prefixes.
    for (const prefix of SENIOR_PREFIXES) {
      result.add(prefix ? `${prefix} ${baseTitle}` : baseTitle);
    }
  }

  return [...result];
}

module.exports = {
  normalizeTitle, normalizeTitles, expandTitleForStage, stripStageQualifiers, SENIOR_QUALIFIERS,
};
