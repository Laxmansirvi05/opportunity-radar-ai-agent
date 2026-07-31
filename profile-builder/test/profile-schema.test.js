'use strict';

/**
 * Tests for the canonical CIP schema — data/src/schemas/candidate-profile-schema.js
 *
 * Run from the profile-builder directory:
 *   node --test test/profile-schema.test.js
 *
 * Or via the data package:
 *   node --test ../data/src/schemas/candidate-profile-schema.js  (no, use this file)
 *
 * These are pure unit tests — no DB, no network, no env vars required.
 */

const assert = require('node:assert/strict');
const test   = require('node:test');

const {
  SCHEMA_VERSION,
  CAREER_STAGES,
  SKILL_CATEGORIES,
  WORK_AUTH_VALUES,
  ProfileValidationError,
  validateCandidateProfile,
} = require('../../data/src/schemas/candidate-profile-schema');

// ---------------------------------------------------------------------------
// Minimal valid CIP fixture
// ---------------------------------------------------------------------------

function validCip(overrides = {}) {
  return {
    literal: {
      fullName:          'Jane Smith',
      email:             'jane@example.com',
      phone:             null,
      linkedinUrl:       null,
      githubUrl:         'https://github.com/janesmith',
      portfolioUrl:      null,
      rawSkills:         ['Python', 'React', 'AWS'],
      education:         [{ institution: 'MIT', degree: 'BSc', field: 'Computer Science', startYear: 2020, endYear: 2024, gpa: '3.9' }],
      experience:        [{ company: 'Acme Corp', title: 'SWE Intern', startDate: '2023-05', endDate: 'present', description: 'Built APIs', technologies: ['Python', 'Django'] }],
      projects:          [{ name: 'ResumeAI', description: 'AI resume parser', technologies: ['Python', 'GPT-4'], url: 'https://github.com/jane/resumeai' }],
      certifications:    ['AWS Certified Developer'],
      publications:      [],
      awards:            [],
      languages:         ['English', 'Spanish'],
      preferredLocations: ['San Francisco, CA'],
    },
    inferred: {
      careerStage:     { value: 'student', confidence: 0.95, evidence: ['currently pursuing BSc at MIT'] },
      canonicalSkills: [
        { canonical: 'Python', raw: 'Python', category: 'language', confidence: 0.99 },
        { canonical: 'React',  raw: 'React',  category: 'framework', confidence: 0.95 },
      ],
      inferredRoles:   [
        { role: 'Backend Engineer', confidence: 0.8, evidence: ['Built APIs at Acme Corp'] },
        { role: 'Full Stack Engineer', confidence: 0.7, evidence: ['React and Python experience'] },
      ],
      careerDirection: {
        primary:    'Software Engineering',
        adjacent:   ['AI/ML Engineering', 'DevOps'],
        confidence: 0.85,
        evidence:   ['multiple full-stack and cloud projects'],
      },
      searchKeywords:  ['Python', 'React', 'AWS', 'Backend Engineer', 'Internship'],
      searchIntent:    'Seeking a software engineering internship at a technology company.',
      workAuthorization: { value: 'citizen', confidence: 0.5, evidence: ['No visa sponsorship mentioned'] },
      openToRelocation:  { value: true, confidence: 0.6, evidence: ['Preferred location listed as San Francisco'] },
    },
    meta: {
      schemaVersion:    SCHEMA_VERSION,
      modelVersion:     'gemini-2.5-flash',
      builtAt:          '2026-07-31T07:00:00.000Z',
      resumeHash:       '',
      overallConfidence: 0.77,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('exports the correct SCHEMA_VERSION', () => {
  assert.equal(SCHEMA_VERSION, '2.0.0');
});

test('exports the correct career stage enum values', () => {
  for (const stage of ['student', 'early-career', 'mid-career', 'senior', 'transitioning']) {
    assert.ok(CAREER_STAGES.has(stage), `CAREER_STAGES should include "${stage}"`);
  }
  assert.equal(CAREER_STAGES.size, 5);
});

test('exports the correct skill category enum values', () => {
  for (const cat of ['language', 'framework', 'platform', 'tool', 'domain', 'soft']) {
    assert.ok(SKILL_CATEGORIES.has(cat));
  }
  assert.equal(SKILL_CATEGORIES.size, 6);
});

test('exports the correct work authorization enum values', () => {
  for (const v of ['citizen', 'permanent-resident', 'visa-required', 'unknown']) {
    assert.ok(WORK_AUTH_VALUES.has(v));
  }
  assert.equal(WORK_AUTH_VALUES.size, 4);
});

test('accepts a fully valid CIP', () => {
  const result = validateCandidateProfile(validCip());
  assert.equal(result.meta.schemaVersion, '2.0.0');
  assert.equal(result.literal.fullName, 'Jane Smith');
  assert.equal(result.inferred.careerStage.value, 'student');
  assert.equal(result.inferred.careerDirection.primary, 'Software Engineering');
});

test('returns a frozen object', () => {
  const result = validateCandidateProfile(validCip());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.literal));
  assert.ok(Object.isFrozen(result.inferred));
  assert.ok(Object.isFrozen(result.meta));
});

test('rejects null input', () => {
  assert.throws(() => validateCandidateProfile(null), ProfileValidationError);
});

test('rejects array input', () => {
  assert.throws(() => validateCandidateProfile([]), ProfileValidationError);
});

test('rejects missing literal section', () => {
  const cip = validCip();
  delete cip.literal;
  assert.throws(() => validateCandidateProfile(cip), (err) => {
    assert.ok(err instanceof ProfileValidationError);
    assert.match(err.message, /literal/);
    return true;
  });
});

test('rejects missing inferred section', () => {
  const cip = validCip();
  delete cip.inferred;
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('rejects missing meta section', () => {
  const cip = validCip();
  delete cip.meta;
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('rejects wrong schema version in meta', () => {
  const cip = validCip();
  cip.meta.schemaVersion = '1.0.0';
  assert.throws(() => validateCandidateProfile(cip), (err) => {
    assert.ok(err instanceof ProfileValidationError);
    assert.match(err.message, /schemaVersion/);
    return true;
  });
});

test('rejects overallConfidence > 1', () => {
  const cip = validCip();
  cip.meta.overallConfidence = 1.1;
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('rejects overallConfidence < 0', () => {
  const cip = validCip();
  cip.meta.overallConfidence = -0.1;
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('rejects invalid careerStage value', () => {
  const cip = validCip();
  cip.inferred.careerStage.value = 'junior'; // not in enum
  assert.throws(() => validateCandidateProfile(cip), (err) => {
    assert.ok(err instanceof ProfileValidationError);
    assert.match(err.message, /careerStage/);
    return true;
  });
});

test('rejects inferred field with empty evidence array', () => {
  const cip = validCip();
  cip.inferred.careerStage.evidence = [];
  assert.throws(() => validateCandidateProfile(cip), (err) => {
    assert.ok(err instanceof ProfileValidationError);
    assert.match(err.message, /evidence/);
    return true;
  });
});

test('rejects confidence outside [0, 1]', () => {
  const cip = validCip();
  cip.inferred.careerStage.confidence = 1.5;
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('rejects invalid skill category', () => {
  const cip = validCip();
  cip.inferred.canonicalSkills[0].category = 'unknown-category';
  assert.throws(() => validateCandidateProfile(cip), (err) => {
    assert.ok(err instanceof ProfileValidationError);
    assert.match(err.message, /category/);
    return true;
  });
});

test('rejects invalid work authorization value', () => {
  const cip = validCip();
  cip.inferred.workAuthorization.value = 'maybe';
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('rejects openToRelocation value that is not boolean or null', () => {
  const cip = validCip();
  cip.inferred.openToRelocation.value = 'yes';
  assert.throws(() => validateCandidateProfile(cip), ProfileValidationError);
});

test('accepts openToRelocation.value = null (truly unknown)', () => {
  const cip = validCip();
  cip.inferred.openToRelocation.value = null;
  const result = validateCandidateProfile(cip);
  assert.equal(result.inferred.openToRelocation.value, null);
});

test('accepts education entry with all nulls', () => {
  const cip = validCip();
  cip.literal.education = [{ institution: 'MIT', degree: null, field: null, startYear: null, endYear: null, gpa: null }];
  const result = validateCandidateProfile(cip);
  assert.equal(result.literal.education[0].degree, null);
});

test('trims whitespace from strings', () => {
  const cip = validCip();
  cip.literal.fullName = '  Jane Smith  ';
  const result = validateCandidateProfile(cip);
  assert.equal(result.literal.fullName, 'Jane Smith');
});

test('preserves empty arrays in literal section', () => {
  const cip = validCip();
  cip.literal.publications = [];
  cip.literal.awards       = [];
  const result = validateCandidateProfile(cip);
  assert.deepEqual([...result.literal.publications], []);
  assert.deepEqual([...result.literal.awards], []);
});

test('ProfileValidationError has the correct code', () => {
  try {
    validateCandidateProfile(null);
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.code, 'PROFILE_VALIDATION_ERROR');
    assert.equal(err.name, 'ProfileValidationError');
  }
});
