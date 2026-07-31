'use strict';

/**
 * Unit tests for profile-builder.js
 *
 * Uses dependency injection to avoid any real network or DB calls.
 * Every external dependency (gatewayCall, repositoryUpsert, logger) is mocked.
 *
 * Run: node --test test/profile-builder.test.js
 */

const assert = require('node:assert/strict');
const test   = require('node:test');

const { buildProfile, ProfileBuildError, computeResumeHash } = require('../src/profile-builder');
const { SCHEMA_VERSION } = require('../../data/src/schemas/candidate-profile-schema');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_RESUME = {
  name:        'Jane Smith',
  email:       'jane@example.com',
  skills:      ['Python', 'React'],
  experience:  [{ company: 'Acme', title: 'Intern', dates: '2023-2024' }],
  education:   [{ institution: 'MIT', degree: 'BSc Computer Science' }],
};

function makeCip(overrides = {}) {
  return {
    literal: {
      fullName: 'Jane Smith', email: 'jane@example.com', phone: null,
      linkedinUrl: null, githubUrl: null, portfolioUrl: null,
      rawSkills: ['Python', 'React'],
      education: [{ institution: 'MIT', degree: 'BSc', field: 'CS', startYear: 2020, endYear: 2024, gpa: null }],
      experience: [{ company: 'Acme', title: 'Intern', startDate: '2023-01', endDate: '2024-01', description: null, technologies: [] }],
      projects: [], certifications: [], publications: [], awards: [], languages: [], preferredLocations: [],
    },
    inferred: {
      careerStage:     { value: 'student', confidence: 0.9, evidence: ['BSc expected 2024'] },
      canonicalSkills: [
        { canonical: 'Python', raw: 'Python', category: 'language', confidence: 0.99 },
        { canonical: 'React',  raw: 'React',  category: 'framework', confidence: 0.95 },
      ],
      inferredRoles:   [
        { role: 'Backend Engineer', confidence: 0.8, evidence: ['Python experience'] },
        { role: 'Frontend Engineer', confidence: 0.75, evidence: ['React experience'] },
      ],
      careerDirection: { primary: 'Software Engineering', adjacent: ['AI Engineering'], confidence: 0.8, evidence: ['multiple tech projects'] },
      searchKeywords:  ['Python', 'React', 'Backend', 'Intern'],
      searchIntent:    'Seeking a software engineering internship.',
      workAuthorization: { value: 'unknown', confidence: 0.1, evidence: ['No visa info found'] },
      openToRelocation:  { value: null, confidence: 0.1, evidence: ['No relocation preference stated'] },
    },
    meta: {
      schemaVersion:    SCHEMA_VERSION,
      modelVersion:     'gemini-2.5-flash',
      builtAt:          '2026-07-31T07:00:00.000Z',
      resumeHash:       '',
      overallConfidence: 0.69,
    },
    ...overrides,
  };
}

// Mock dependencies
function makeConfig() {
  return { gatewayBaseUrl: 'http://localhost:4000', gatewayApiKey: 'test-key' };
}

function makeGateway(cip = makeCip()) {
  return async () => ({ success: true, requestId: 'req-1', data: cip });
}

function makeRepository(id = 'cand-uuid-001') {
  const calls = [];
  const fn = async (input) => {
    calls.push(input);
    return { id, resume_hash: input.resumeHash, career_stage: input.careerStage, created_at: new Date(), updated_at: new Date() };
  };
  fn.calls = calls;
  return fn;
}

function makeLogger() {
  const entries = [];
  return {
    info:    (...args) => entries.push({ level: 'info',  args }),
    warn:    (...args) => entries.push({ level: 'warn',  args }),
    error:   (...args) => entries.push({ level: 'error', args }),
    entries,
  };
}

// ---------------------------------------------------------------------------
// computeResumeHash
// ---------------------------------------------------------------------------

test('computeResumeHash produces a 64-char hex string', () => {
  const hash = computeResumeHash(SAMPLE_RESUME);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('computeResumeHash is deterministic for equal objects', () => {
  const a = computeResumeHash({ a: 1, b: 2 });
  const b = computeResumeHash({ b: 2, a: 1 }); // different key order
  assert.equal(a, b);
});

test('computeResumeHash differs for different resumes', () => {
  const a = computeResumeHash({ name: 'Jane' });
  const b = computeResumeHash({ name: 'John' });
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

test('throws ProfileBuildError for null input', async () => {
  await assert.rejects(
    () => buildProfile(null, { config: makeConfig(), gatewayCall: makeGateway(), repositoryUpsert: makeRepository() }),
    (err) => {
      assert.ok(err instanceof ProfileBuildError);
      assert.equal(err.code, 'INVALID_INPUT');
      return true;
    }
  );
});

test('throws ProfileBuildError for empty string input', async () => {
  await assert.rejects(
    () => buildProfile('', { config: makeConfig(), gatewayCall: makeGateway(), repositoryUpsert: makeRepository() }),
    (err) => err instanceof ProfileBuildError && err.code === 'INVALID_INPUT'
  );
});

test('throws ProfileBuildError for non-JSON string', async () => {
  await assert.rejects(
    () => buildProfile('not-valid-json', { config: makeConfig(), gatewayCall: makeGateway(), repositoryUpsert: makeRepository() }),
    (err) => err instanceof ProfileBuildError && err.code === 'INVALID_INPUT'
  );
});

test('throws ProfileBuildError for array input', async () => {
  await assert.rejects(
    () => buildProfile([1, 2, 3], { config: makeConfig(), gatewayCall: makeGateway(), repositoryUpsert: makeRepository() }),
    (err) => err instanceof ProfileBuildError && err.code === 'INVALID_INPUT'
  );
});

test('accepts a JSON string representation of the resume', async () => {
  const repo = makeRepository();
  const result = await buildProfile(JSON.stringify(SAMPLE_RESUME), {
    config:            makeConfig(),
    gatewayCall:       makeGateway(),
    repositoryUpsert:  repo,
    logger:            makeLogger(),
  });
  assert.ok(result.candidateId);
});

// ---------------------------------------------------------------------------
// Successful path
// ---------------------------------------------------------------------------

test('returns candidateId, resumeHash, profileVersion, processingTimeMs on success', async () => {
  const result = await buildProfile(SAMPLE_RESUME, {
    config:           makeConfig(),
    gatewayCall:      makeGateway(),
    repositoryUpsert: makeRepository(),
    logger:           makeLogger(),
  });

  assert.ok(typeof result.candidateId      === 'string' && result.candidateId !== '');
  assert.match(result.resumeHash, /^[0-9a-f]{64}$/);
  assert.equal(result.profileVersion, SCHEMA_VERSION);
  assert.ok(typeof result.processingTimeMs === 'number' && result.processingTimeMs >= 0);
});

test('writes resume hash, careerStage, schemaVersion, and profileJson to repository', async () => {
  const repo = makeRepository();
  await buildProfile(SAMPLE_RESUME, {
    config:           makeConfig(),
    gatewayCall:      makeGateway(),
    repositoryUpsert: repo,
    logger:           makeLogger(),
  });

  assert.equal(repo.calls.length, 1);
  const call = repo.calls[0];
  assert.match(call.resumeHash, /^[0-9a-f]{64}$/);
  assert.equal(call.careerStage, 'student');
  assert.equal(call.profileSchemaVersion, SCHEMA_VERSION);
  assert.equal(call.profileModelVersion, 'gemini-2.5-flash');
  assert.ok(call.profileJson && typeof call.profileJson === 'object');
});

test('stamps the resumeHash into the CIP meta before writing', async () => {
  const repo = makeRepository();
  await buildProfile(SAMPLE_RESUME, {
    config:           makeConfig(),
    gatewayCall:      makeGateway(),
    repositoryUpsert: repo,
    logger:           makeLogger(),
  });
  const writtenProfile = repo.calls[0].profileJson;
  assert.match(writtenProfile.meta.resumeHash, /^[0-9a-f]{64}$/);
});

test('emits a success log line with all required AC-09 fields', async () => {
  const logger = makeLogger();
  await buildProfile(SAMPLE_RESUME, {
    config:           makeConfig(),
    gatewayCall:      makeGateway(),
    repositoryUpsert: makeRepository(),
    logger,
  });

  const successLogs = logger.entries.filter((e) => e.level === 'info');
  assert.equal(successLogs.length, 1);
  const entry = JSON.parse(successLogs[0].args[0]);
  assert.equal(entry.event, 'profile_build_succeeded');
  assert.ok(entry.candidateId);
  assert.ok(entry.resumeHash);
  assert.ok(entry.profileVersion);
  assert.ok(entry.processingTimeMs >= 0);
  assert.equal(entry.validationResult, 'OK');
});

// ---------------------------------------------------------------------------
// Gateway failure paths
// ---------------------------------------------------------------------------

test('throws ProfileBuildError on gateway network failure', async () => {
  const { GatewayClientError } = require('../src/gateway-client');
  const failingGateway = async () => { throw new GatewayClientError('GATEWAY_NETWORK_ERROR', 'connection refused'); };
  await assert.rejects(
    () => buildProfile(SAMPLE_RESUME, {
      config:           makeConfig(),
      gatewayCall:      failingGateway,
      repositoryUpsert: makeRepository(),
      logger:           makeLogger(),
    }),
    (err) => err instanceof ProfileBuildError && err.code === 'GATEWAY_NETWORK_ERROR'
  );
});

test('emits an error log on gateway failure', async () => {
  const logger = makeLogger();
  const { GatewayClientError } = require('../src/gateway-client');
  const failingGateway = async () => { throw new GatewayClientError('GATEWAY_TIMEOUT', 'timed out'); };
  await assert.rejects(() => buildProfile(SAMPLE_RESUME, {
    config: makeConfig(), gatewayCall: failingGateway, repositoryUpsert: makeRepository(), logger,
  }));
  const errorLogs = logger.entries.filter((e) => e.level === 'error');
  assert.equal(errorLogs.length, 1);
  const entry = JSON.parse(errorLogs[0].args[0]);
  assert.equal(entry.validationResult, 'GATEWAY_FAILED');
});

test('throws ProfileBuildError when gateway returns schema-invalid CIP', async () => {
  const badCip = { ...makeCip(), inferred: { ...makeCip().inferred, careerStage: { value: 'INVALID_STAGE', confidence: 0.5, evidence: ['x'] } } };
  const badGateway = async () => ({ success: true, requestId: 'req-1', data: badCip });
  await assert.rejects(
    () => buildProfile(SAMPLE_RESUME, {
      config:           makeConfig(),
      gatewayCall:      badGateway,
      repositoryUpsert: makeRepository(),
      logger:           makeLogger(),
    }),
    (err) => err.code === 'CIP_VALIDATION_FAILED'
  );
});

// ---------------------------------------------------------------------------
// Repository failure paths
// ---------------------------------------------------------------------------

test('throws ProfileBuildError on repository write failure', async () => {
  const failingRepo = async () => { throw new Error('connection pool exhausted'); };
  await assert.rejects(
    () => buildProfile(SAMPLE_RESUME, {
      config:           makeConfig(),
      gatewayCall:      makeGateway(),
      repositoryUpsert: failingRepo,
      logger:           makeLogger(),
    }),
    (err) => err instanceof ProfileBuildError && err.code === 'DB_WRITE_FAILED'
  );
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('same resume produces the same resumeHash on two calls', async () => {
  const results = [];
  for (let i = 0; i < 2; i++) {
    const r = await buildProfile(SAMPLE_RESUME, {
      config:           makeConfig(),
      gatewayCall:      makeGateway(),
      repositoryUpsert: makeRepository(),
      logger:           makeLogger(),
    });
    results.push(r);
  }
  assert.equal(results[0].resumeHash, results[1].resumeHash);
});
