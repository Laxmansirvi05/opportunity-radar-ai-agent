'use strict';

/**
 * Canonical Candidate Intelligence Profile (CIP) Schema — v2.0.0
 *
 * This is the SINGLE source of truth for the CIP schema and validation logic.
 * It is imported by:
 *   - ai-gateway/src/tasks/build-profile.js  (validates AI output before accepting)
 *   - profile-builder/src/profile-builder.js  (secondary validation before DB write)
 *   - Future: search-planner, ranking-engine (read profile shape)
 *
 * Design:
 *   - No dependencies on any framework or library — pure Node.js.
 *   - Throws ProfileValidationError (not GatewayError) so callers can decide
 *     how to surface the failure.  The AI Gateway wraps it in GatewayError.
 *   - Frozen output objects prevent accidental mutation downstream.
 *
 * Schema version history:
 *   1.0.0 — initial schema (never shipped)
 *   2.0.0 — Sprint 2: three-section layout (literal / inferred / meta),
 *             mandatory confidence + evidence on all inferred fields.
 */

const SCHEMA_VERSION = '2.0.0';

// ---------------------------------------------------------------------------
// Enum constants (exported so callers can do membership checks without strings)
// ---------------------------------------------------------------------------

const CAREER_STAGES = Object.freeze(
  new Set(['student', 'early-career', 'mid-career', 'senior', 'transitioning'])
);

const SKILL_CATEGORIES = Object.freeze(
  new Set(['language', 'framework', 'platform', 'tool', 'domain', 'soft'])
);

const WORK_AUTH_VALUES = Object.freeze(
  new Set(['citizen', 'permanent-resident', 'visa-required', 'unknown'])
);

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

class ProfileValidationError extends Error {
  /** @param {string} message  Human-readable description of what failed. */
  constructor(message) {
    super(message);
    this.name = 'ProfileValidationError';
    this.code = 'PROFILE_VALIDATION_ERROR';
  }
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function invalid(message) {
  throw new ProfileValidationError(message);
}

function nullableString(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(`${field} must be a string or null`);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value, field) {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    invalid(`${field} must be an array of non-empty strings`);
  }
  return Object.freeze(value.map((item) => item.trim()));
}

function optionalStringArray(value, field) {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  return Object.freeze(
    value
      .filter((item) => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim())
  );
}

function nullableNumber(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(`${field} must be a finite number or null`);
  }
  return value;
}

function nullableInteger(value, field) {
  const n = nullableNumber(value, field);
  if (n !== null && !Number.isInteger(n)) invalid(`${field} must be an integer or null`);
  return n;
}

function confidence(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid(`${field}.confidence must be a number between 0.0 and 1.0`);
  }
  return value;
}

function evidenceArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(`${field}.evidence must be a non-empty array of strings`);
  }
  if (value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    invalid(`${field}.evidence must contain only non-empty strings`);
  }
  return Object.freeze(value.map((item) => item.trim()));
}

/**
 * Validates the standard shape of an inferred field:
 *   { value: T, confidence: number, evidence: string[] }
 *
 * @param {unknown}          raw          - The raw field value from AI output.
 * @param {string}           field        - Field path for error messages.
 * @param {(v: unknown) => T} valueValidator - Validates the `.value` property.
 * @returns {{ value: T, confidence: number, evidence: string[] }}
 */
function inferredField(raw, field, valueValidator) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid(`${field} must be an object with value, confidence, and evidence`);
  }
  return Object.freeze({
    value:      valueValidator(raw.value, `${field}.value`),
    confidence: confidence(raw.confidence, field),
    evidence:   evidenceArray(raw.evidence, field),
  });
}

// ---------------------------------------------------------------------------
// Literal section validators
// ---------------------------------------------------------------------------

function validateEducationEntry(entry, index) {
  const path = `literal.education[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    invalid(`${path} must be an object`);
  }
  return Object.freeze({
    institution: nonEmptyString(entry.institution, `${path}.institution`),
    degree:      nullableString(entry.degree,      `${path}.degree`),
    field:       nullableString(entry.field,       `${path}.field`),
    startYear:   nullableInteger(entry.startYear,  `${path}.startYear`),
    endYear:     nullableInteger(entry.endYear,    `${path}.endYear`),
    gpa:         nullableString(entry.gpa,         `${path}.gpa`),
  });
}

function validateExperienceEntry(entry, index) {
  const path = `literal.experience[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    invalid(`${path} must be an object`);
  }
  return Object.freeze({
    company:      nonEmptyString(entry.company,   `${path}.company`),
    title:        nonEmptyString(entry.title,     `${path}.title`),
    startDate:    nullableString(entry.startDate, `${path}.startDate`),
    endDate:      nullableString(entry.endDate,   `${path}.endDate`),
    description:  nullableString(entry.description, `${path}.description`),
    technologies: optionalStringArray(entry.technologies ?? [], `${path}.technologies`),
  });
}

function validateProjectEntry(entry, index) {
  const path = `literal.projects[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    invalid(`${path} must be an object`);
  }
  return Object.freeze({
    name:         nonEmptyString(entry.name, `${path}.name`),
    description:  nullableString(entry.description, `${path}.description`),
    technologies: optionalStringArray(entry.technologies ?? [], `${path}.technologies`),
    url:          nullableString(entry.url, `${path}.url`),
  });
}

function validateLiteralSection(literal) {
  if (!literal || typeof literal !== 'object' || Array.isArray(literal)) {
    invalid('"literal" section must be an object');
  }
  if (!Array.isArray(literal.education)) invalid('literal.education must be an array');
  if (!Array.isArray(literal.experience)) invalid('literal.experience must be an array');
  if (!Array.isArray(literal.projects)) invalid('literal.projects must be an array');

  return Object.freeze({
    fullName:          nullableString(literal.fullName,          'literal.fullName'),
    email:             nullableString(literal.email,             'literal.email'),
    phone:             nullableString(literal.phone,             'literal.phone'),
    linkedinUrl:       nullableString(literal.linkedinUrl,       'literal.linkedinUrl'),
    githubUrl:         nullableString(literal.githubUrl,         'literal.githubUrl'),
    portfolioUrl:      nullableString(literal.portfolioUrl,      'literal.portfolioUrl'),
    rawSkills:         optionalStringArray(literal.rawSkills ?? [],         'literal.rawSkills'),
    education:         Object.freeze(literal.education.map(validateEducationEntry)),
    experience:        Object.freeze(literal.experience.map(validateExperienceEntry)),
    projects:          Object.freeze(literal.projects.map(validateProjectEntry)),
    certifications:    optionalStringArray(literal.certifications ?? [],    'literal.certifications'),
    publications:      optionalStringArray(literal.publications ?? [],      'literal.publications'),
    awards:            optionalStringArray(literal.awards ?? [],            'literal.awards'),
    languages:         optionalStringArray(literal.languages ?? [],         'literal.languages'),
    preferredLocations: optionalStringArray(literal.preferredLocations ?? [], 'literal.preferredLocations'),
  });
}

// ---------------------------------------------------------------------------
// Inferred section validators
// ---------------------------------------------------------------------------

function validateCareerStage(raw) {
  return inferredField(raw, 'inferred.careerStage', (value, field) => {
    if (!CAREER_STAGES.has(value)) {
      invalid(`${field} must be one of: ${[...CAREER_STAGES].join(', ')}`);
    }
    return value;
  });
}

function validateCanonicalSkill(entry, index) {
  const path = `inferred.canonicalSkills[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    invalid(`${path} must be an object`);
  }
  if (!SKILL_CATEGORIES.has(entry.category)) {
    invalid(`${path}.category must be one of: ${[...SKILL_CATEGORIES].join(', ')}`);
  }
  return Object.freeze({
    canonical:  nonEmptyString(entry.canonical, `${path}.canonical`),
    raw:        nonEmptyString(entry.raw,        `${path}.raw`),
    category:   entry.category,
    confidence: confidence(entry.confidence,     path),
  });
}

function validateInferredRole(entry, index) {
  const path = `inferred.inferredRoles[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    invalid(`${path} must be an object`);
  }
  return Object.freeze({
    role:       nonEmptyString(entry.role,          `${path}.role`),
    confidence: confidence(entry.confidence,         path),
    evidence:   evidenceArray(entry.evidence,        path),
  });
}

function validateCareerDirection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('"inferred.careerDirection" must be an object');
  }
  return Object.freeze({
    primary:    nonEmptyString(raw.primary,           'inferred.careerDirection.primary'),
    adjacent:   optionalStringArray(raw.adjacent ?? [], 'inferred.careerDirection.adjacent'),
    confidence: confidence(raw.confidence,             'inferred.careerDirection'),
    evidence:   evidenceArray(raw.evidence,            'inferred.careerDirection'),
  });
}

function validateWorkAuthorization(raw) {
  return inferredField(raw, 'inferred.workAuthorization', (value, field) => {
    if (!WORK_AUTH_VALUES.has(value)) {
      invalid(`${field} must be one of: ${[...WORK_AUTH_VALUES].join(', ')}`);
    }
    return value;
  });
}

function validateOpenToRelocation(raw) {
  return inferredField(raw, 'inferred.openToRelocation', (value, field) => {
    if (value !== true && value !== false && value !== null) {
      invalid(`${field} must be true, false, or null`);
    }
    return value;
  });
}

function validateInferredSection(inferred) {
  if (!inferred || typeof inferred !== 'object' || Array.isArray(inferred)) {
    invalid('"inferred" section must be an object');
  }
  if (!Array.isArray(inferred.canonicalSkills)) {
    invalid('inferred.canonicalSkills must be an array');
  }
  if (!Array.isArray(inferred.inferredRoles)) {
    invalid('inferred.inferredRoles must be an array');
  }

  return Object.freeze({
    careerStage:      validateCareerStage(inferred.careerStage),
    canonicalSkills:  Object.freeze(inferred.canonicalSkills.map(validateCanonicalSkill)),
    inferredRoles:    Object.freeze(inferred.inferredRoles.map(validateInferredRole)),
    careerDirection:  validateCareerDirection(inferred.careerDirection),
    searchKeywords:   stringArray(inferred.searchKeywords, 'inferred.searchKeywords'),
    searchIntent:     nonEmptyString(inferred.searchIntent, 'inferred.searchIntent'),
    workAuthorization: validateWorkAuthorization(inferred.workAuthorization),
    openToRelocation:  validateOpenToRelocation(inferred.openToRelocation),
  });
}

// ---------------------------------------------------------------------------
// Meta section validator
// ---------------------------------------------------------------------------

function validateMetaSection(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    invalid('"meta" section must be an object');
  }
  if (meta.schemaVersion !== SCHEMA_VERSION) {
    invalid(`meta.schemaVersion must be "${SCHEMA_VERSION}"`);
  }
  if (typeof meta.overallConfidence !== 'number' ||
      !Number.isFinite(meta.overallConfidence) ||
      meta.overallConfidence < 0 ||
      meta.overallConfidence > 1) {
    invalid('meta.overallConfidence must be a number between 0.0 and 1.0');
  }
  return Object.freeze({
    schemaVersion:     SCHEMA_VERSION,
    modelVersion:      nonEmptyString(meta.modelVersion, 'meta.modelVersion'),
    builtAt:           nonEmptyString(meta.builtAt,      'meta.builtAt'),
    resumeHash:        typeof meta.resumeHash === 'string' ? meta.resumeHash : '',
    overallConfidence: meta.overallConfidence,
  });
}

// ---------------------------------------------------------------------------
// Main validator (public API)
// ---------------------------------------------------------------------------

/**
 * Validates a raw AI output object against the CIP v2.0.0 schema.
 *
 * @param {unknown} value - The parsed JSON object to validate.
 * @returns {Readonly<CIP>} - Frozen, validated CIP object.
 * @throws {ProfileValidationError} - On any schema violation.
 */
function validateCandidateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('Candidate Intelligence Profile must be a JSON object');
  }
  for (const key of ['literal', 'inferred', 'meta']) {
    if (!(key in value)) invalid(`CIP is missing required section: "${key}"`);
  }
  return Object.freeze({
    literal:  validateLiteralSection(value.literal),
    inferred: validateInferredSection(value.inferred),
    meta:     validateMetaSection(value.meta),
  });
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  CAREER_STAGES,
  SKILL_CATEGORIES,
  WORK_AUTH_VALUES,
  ProfileValidationError,
  validateCandidateProfile,
});
