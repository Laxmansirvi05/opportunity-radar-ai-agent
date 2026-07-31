'use strict';

/**
 * Integration tests for the Candidate Intelligence Profile Builder
 *
 * REQUIRES: A running PostgreSQL instance with the Sprint 1 migrations applied.
 * The test reads connection config from environment variables, which must match
 * data/.env (or be set in the shell environment before running).
 *
 * The AI Gateway is MOCKED — no real LLM calls are made.
 *
 * Run:
 *   PGHOST=/tmp PGDATABASE=opportunity_radar PGUSER=laxmansirvi \
 *   node --test test/integration.test.js
 *
 * Or with .env:
 *   cp .env.example .env  # and fill in values
 *   node --test test/integration.test.js
 */

require('../src/config'); // load .env first so PG vars are in process.env

const assert = require('node:assert/strict');
const test   = require('node:test');

const { buildProfile, computeResumeHash }                 = require('../src/profile-builder');
const { upsertCandidate, findCandidateByResumeHash,
        findCandidateById, getCandidateProfile }           = require('../../data/src/repositories/candidate-repository');
const { getPool, shutdown: dbShutdown }                                   = require('../../data/src/db');
const { SCHEMA_VERSION }                                  = require('../../data/src/schemas/candidate-profile-schema');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_RESUME = {
  name:       'Integration Test Candidate',
  email:      'integration-test@example.com',
  skills:     ['Node.js', 'PostgreSQL', 'TypeScript'],
  education:  [{ institution: 'State University', degree: 'BSc Computer Science' }],
  experience: [],
  projects:   [{ name: 'DataPipe', technologies: ['Node.js', 'Kafka'] }],
};

// A valid CIP that the mock gateway returns
function mockCip(resumeHash = '') {
  return {
    literal: {
      fullName: 'Integration Test Candidate',
      email: 'integration-test@example.com',
      phone: null, linkedinUrl: null, githubUrl: null, portfolioUrl: null,
      rawSkills: ['Node.js', 'PostgreSQL', 'TypeScript'],
      education: [{ institution: 'State University', degree: 'BSc', field: 'Computer Science', startYear: 2020, endYear: 2024, gpa: null }],
      experience: [],
      projects: [{ name: 'DataPipe', description: null, technologies: ['Node.js', 'Kafka'], url: null }],
      certifications: [], publications: [], awards: [], languages: [], preferredLocations: [],
    },
    inferred: {
      careerStage:     { value: 'student', confidence: 0.9, evidence: ['BSc expected 2024'] },
      canonicalSkills: [
        { canonical: 'Node.js',     raw: 'Node.js',     category: 'platform',   confidence: 0.98 },
        { canonical: 'PostgreSQL',  raw: 'PostgreSQL',  category: 'tool',       confidence: 0.97 },
        { canonical: 'TypeScript',  raw: 'TypeScript',  category: 'language',   confidence: 0.99 },
      ],
      inferredRoles: [
        { role: 'Backend Engineer',        confidence: 0.85, evidence: ['Node.js and PostgreSQL experience'] },
        { role: 'Full Stack Engineer',     confidence: 0.70, evidence: ['TypeScript and Node.js'] },
      ],
      careerDirection: {
        primary: 'Backend Engineering', adjacent: ['DevOps Engineering', 'Cloud Engineering'],
        confidence: 0.80, evidence: ['Node.js, Kafka, and PostgreSQL projects'],
      },
      searchKeywords:  ['Node.js', 'TypeScript', 'PostgreSQL', 'Backend', 'Kafka', 'Internship'],
      searchIntent:    'Seeking a backend or full-stack engineering internship.',
      workAuthorization: { value: 'unknown', confidence: 0.1, evidence: ['No visa information found'] },
      openToRelocation:  { value: null,     confidence: 0.1, evidence: ['No relocation preference stated'] },
    },
    meta: {
      schemaVersion:    SCHEMA_VERSION,
      modelVersion:     'mock-gateway-v1',
      builtAt:          new Date().toISOString(),
      resumeHash,
      overallConfidence: 0.76,
    },
  };
}

// Mock gateway that returns the valid CIP
function makeGatewayMock() {
  return async () => ({
    success: true,
    requestId: `mock-req-${Date.now()}`,
    data: mockCip(),
  });
}

// Silent logger for integration tests
const silentLogger = { info() {}, warn() {}, error() {} };

// Test config (no API key needed — gateway is mocked)
const testConfig = { gatewayBaseUrl: 'http://localhost:4000', gatewayApiKey: 'test-key' };

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

async function deleteTestCandidate(resumeHash) {
  try {
    const pool = getPool();
    await pool.query('DELETE FROM candidates WHERE resume_hash = $1', [resumeHash]);
  } catch {
    // Best-effort cleanup — do not fail tests on cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('buildProfile inserts a new candidate row in PostgreSQL', async () => {
  const expectedHash = computeResumeHash(SAMPLE_RESUME);
  await deleteTestCandidate(expectedHash); // ensure clean slate

  try {
    const result = await buildProfile(SAMPLE_RESUME, {
      config:           testConfig,
      gatewayCall:      makeGatewayMock(),
      logger:           silentLogger,
    });

    // Verify return shape
    assert.ok(result.candidateId,  'candidateId must be returned');
    assert.equal(result.resumeHash,     expectedHash);
    assert.equal(result.profileVersion, SCHEMA_VERSION);
    assert.ok(result.processingTimeMs >= 0);

    // Verify the row actually exists in the DB
    const row = await findCandidateByResumeHash(expectedHash);
    assert.ok(row, 'row must exist in candidates table');
    assert.equal(row.id,                   result.candidateId);
    assert.equal(row.resume_hash,          expectedHash);
    assert.equal(row.career_stage,         'student');
    assert.equal(row.profile_schema_version, SCHEMA_VERSION);
    assert.equal(row.profile_model_version, 'mock-gateway-v1');
    assert.equal(row.status,               'active');
  } finally {
    await deleteTestCandidate(expectedHash);
  }
});

test('getCandidateProfile returns the stored CIP with resumeHash stamped', async () => {
  const expectedHash = computeResumeHash(SAMPLE_RESUME);
  await deleteTestCandidate(expectedHash);

  try {
    const result = await buildProfile(SAMPLE_RESUME, {
      config:      testConfig,
      gatewayCall: makeGatewayMock(),
      logger:      silentLogger,
    });

    const profileRow = await getCandidateProfile(result.candidateId);
    assert.ok(profileRow, 'profile row must exist');
    assert.equal(profileRow.profile_schema_version, SCHEMA_VERSION);
    assert.equal(profileRow.profile_json.meta.resumeHash, expectedHash);
    assert.equal(profileRow.profile_json.inferred.careerStage.value, 'student');
  } finally {
    await deleteTestCandidate(expectedHash);
  }
});

test('buildProfile is idempotent: second call upserts, not duplicates', async () => {
  const expectedHash = computeResumeHash(SAMPLE_RESUME);
  await deleteTestCandidate(expectedHash);

  try {
    const r1 = await buildProfile(SAMPLE_RESUME, {
      config: testConfig, gatewayCall: makeGatewayMock(), logger: silentLogger,
    });
    const r2 = await buildProfile(SAMPLE_RESUME, {
      config: testConfig, gatewayCall: makeGatewayMock(), logger: silentLogger,
    });

    // Both calls reference the same row
    assert.equal(r1.resumeHash,   r2.resumeHash);
    assert.equal(r1.candidateId,  r2.candidateId);

    // Only one row in the DB
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT COUNT(*) AS n FROM candidates WHERE resume_hash = $1',
      [expectedHash]
    );
    assert.equal(parseInt(rows[0].n, 10), 1);
  } finally {
    await deleteTestCandidate(expectedHash);
  }
});

test('findCandidateById returns the candidate by UUID', async () => {
  const expectedHash = computeResumeHash(SAMPLE_RESUME);
  await deleteTestCandidate(expectedHash);

  try {
    const result = await buildProfile(SAMPLE_RESUME, {
      config: testConfig, gatewayCall: makeGatewayMock(), logger: silentLogger,
    });
    const row = await findCandidateById(result.candidateId);
    assert.ok(row);
    assert.equal(row.id, result.candidateId);
  } finally {
    await deleteTestCandidate(expectedHash);
  }
});

test('upsertCandidate updates profile_json when called with same resume_hash', async () => {
  const resumeHash = 'test-hash-update-' + Date.now();
  const pool = getPool();

  try {
    // First insert
    const row1 = await upsertCandidate({
      resumeHash,
      profileJson:          { version: 'v1' },
      careerStage:          'student',
      profileSchemaVersion: '2.0.0',
      profileModelVersion:  'model-v1',
    });

    // Second upsert with updated profile
    const row2 = await upsertCandidate({
      resumeHash,
      profileJson:          { version: 'v2' },
      careerStage:          'early-career',
      profileSchemaVersion: '2.0.0',
      profileModelVersion:  'model-v2',
    });

    // Same UUID (no new row)
    assert.equal(row1.id, row2.id);

    // Profile updated
    const updated = await getCandidateProfile(row2.id);
    assert.equal(updated.profile_json.version, 'v2');
  } finally {
    await pool.query('DELETE FROM candidates WHERE resume_hash = $1', [resumeHash]);
  }
});

// Close pool after all integration tests — explicit teardown for Node 18 compatibility.
// test.after() is only available in Node 20+.
test('teardown: close database pool', async () => {
  await dbShutdown();
});

