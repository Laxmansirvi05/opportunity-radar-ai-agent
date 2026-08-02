'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { buildSearchPlan, extractCipComponents, computePlanHash, SearchPlanError }
  = require('../src/search-planner');

// ---------------------------------------------------------------------------
// Minimal valid CIP for testing (mirrors Sprint 2 CIP v2.0.0 schema shape)
// ---------------------------------------------------------------------------
const VALID_CIP = {
  meta: {
    schemaVersion: '2.0.0',
    careerStage:   'student',
    overallConfidence: 0.85,
    resumeHash:    'abc123',
  },
  literal: {
    skills: [
      { name: 'Python',     category: 'technical' },
      { name: 'TypeScript', category: 'technical' },
      { name: 'Node.js',    category: 'technical' },
      { name: 'Docker',     category: 'tool'      },
      { name: 'Agile',      category: 'soft'      },
    ],
    workExperience: [
      { title: 'Software Engineer', company: 'Acme Corp', technologies: ['Python'] },
    ],
    education: [
      { institution: 'State University', degree: "Bachelor's", field: 'Computer Science', gpa: 3.8 },
    ],
    preferredLocations: [
      { location: 'San Francisco, CA' },
      { location: 'Remote' },
    ],
    workAuthorization: { value: 'us_citizen', confidence: 1.0, evidence: ['inferred from profile'] },
    openToRelocation:  { value: true,        confidence: 0.8, evidence: ['stated preference'] },
  },
  inferred: {
    careerTrajectory: {
      primaryDirection: 'Full Stack Engineer',
      adjacentRoles:    ['Backend Engineer', 'AI Application Developer'],
      confidence:       0.8,
      evidence:         ['Python backend + TypeScript frontend combination'],
    },
    domainExpertise: {
      value:      ['web development'],
      confidence: 0.75,
      evidence:   ['React and Node.js projects'],
    },
  },
};

// Mock repository — injectable, never hits the DB in unit tests.
function makeMockRepo(overrides = {}) {
  return {
    createSearchPlan: async (plan) => ({
      id:           'plan-uuid-1234',
      candidate_id:  plan.candidateId,
      plan_version:  plan.planVersion,
      query_count:   plan.queryCount,
      status:        'active',
      created_at:    new Date().toISOString(),
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractCipComponents
// ---------------------------------------------------------------------------

test('extractCipComponents: extracts careerStage from meta', () => {
  const c = extractCipComponents(VALID_CIP);
  assert.equal(c.careerStage, 'student');
});

test('extractCipComponents: produces non-empty skills list', () => {
  const c = extractCipComponents(VALID_CIP);
  assert.ok(c.skills.length > 0);
  assert.ok(c.skills.includes('Python'));
});

test('extractCipComponents: adjacent roles include inferred trajectory', () => {
  const c = extractCipComponents(VALID_CIP);
  assert.ok(c.adjacentRoles.length > 0);
});

test('extractCipComponents: locations always include remote', () => {
  const c = extractCipComponents(VALID_CIP);
  assert.ok(c.locations.some((l) => l.toLowerCase().includes('remote')));
});

test('extractCipComponents: throws SearchPlanError for null CIP', () => {
  assert.throws(() => extractCipComponents(null), SearchPlanError);
});

test('extractCipComponents: throws SearchPlanError for missing sections', () => {
  assert.throws(() => extractCipComponents({ meta: {} }), SearchPlanError);
});

test('extractCipComponents: handles empty work experience', () => {
  const cip = { ...VALID_CIP, literal: { ...VALID_CIP.literal, workExperience: [] } };
  const c   = extractCipComponents(cip);
  // Falls back to default "Software Engineer"
  assert.ok(c.titleVariants.length > 0);
});

// ---------------------------------------------------------------------------
// computePlanHash
// ---------------------------------------------------------------------------

test('computePlanHash: produces 16-char hex string', () => {
  const c    = extractCipComponents(VALID_CIP);
  const hash = computePlanHash(c);
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 16);
  assert.ok(/^[0-9a-f]+$/.test(hash));
});

test('computePlanHash: deterministic for same components', () => {
  const c = extractCipComponents(VALID_CIP);
  assert.equal(computePlanHash(c), computePlanHash(c));
});

test('computePlanHash: differs for different career stages', () => {
  const c1 = extractCipComponents(VALID_CIP);
  const c2 = extractCipComponents({ ...VALID_CIP, meta: { ...VALID_CIP.meta, careerStage: 'mid-career' } });
  assert.notEqual(computePlanHash(c1), computePlanHash(c2));
});

// ---------------------------------------------------------------------------
// buildSearchPlan (with mock repository)
// ---------------------------------------------------------------------------

test('buildSearchPlan: returns planId, queryCount, planVersion on success', async () => {
  const result = await buildSearchPlan({
    candidateId: 'cand-uuid-001',
    cip:         VALID_CIP,
    repository:  makeMockRepo(),
  });
  assert.equal(typeof result.planId, 'string');
  assert.ok(result.queryCount > 0);
  assert.equal(result.planVersion, '1.0.0');
  assert.equal(typeof result.planHash, 'string');
});

test('buildSearchPlan: planHash is deterministic for same CIP', async () => {
  const r1 = await buildSearchPlan({ candidateId: 'cand-uuid-001', cip: VALID_CIP, repository: makeMockRepo() });
  const r2 = await buildSearchPlan({ candidateId: 'cand-uuid-001', cip: VALID_CIP, repository: makeMockRepo() });
  assert.equal(r1.planHash, r2.planHash);
});

test('buildSearchPlan: throws SearchPlanError for missing candidateId', async () => {
  await assert.rejects(
    () => buildSearchPlan({ candidateId: '', cip: VALID_CIP, repository: makeMockRepo() }),
    SearchPlanError
  );
});

test('buildSearchPlan: throws SearchPlanError for invalid CIP', async () => {
  await assert.rejects(
    () => buildSearchPlan({ candidateId: 'cand-001', cip: null, repository: makeMockRepo() }),
    SearchPlanError
  );
});

test('buildSearchPlan: calls repository.createSearchPlan exactly once', async () => {
  let callCount = 0;
  const repo = makeMockRepo({
    createSearchPlan: async (plan) => { callCount++; return { id: 'x', plan_version: '1.0.0', query_count: plan.queryCount }; },
  });
  await buildSearchPlan({ candidateId: 'cand-001', cip: VALID_CIP, repository: repo });
  assert.equal(callCount, 1);
});

test('buildSearchPlan: plan contains no provider names', async () => {
  let capturedPlan;
  const repo = makeMockRepo({
    createSearchPlan: async (plan) => {
      capturedPlan = plan;
      return { id: 'x', plan_version: '1.0.0', query_count: plan.queryCount };
    },
  });
  await buildSearchPlan({ candidateId: 'cand-001', cip: VALID_CIP, repository: repo });

  const serialized = JSON.stringify(capturedPlan.planJson);
  // Use word-boundary pattern so 'lever' doesn't match inside 'developer',
  // 'ashby' doesn't match inside partial words, etc.
  for (const name of ['greenhouse', 'ashby', 'linkedin', 'serpapi', 'workday']) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    assert.ok(!re.test(serialized), `Plan must not contain provider name: ${name}`);
  }
  // 'lever' needs special care: word boundary check won't catch 'Lever' inside 'Lever Adapter'
  // but WILL pass for 'developer'. Confirm no standalone 'lever' as a provider hint.
  const leverRe = /(?<![a-z])lever(?![a-z])/i;
  assert.ok(!leverRe.test(serialized), 'Plan must not contain standalone provider name: lever');
});

test('buildSearchPlan: plan has all required top-level fields', async () => {
  let capturedPlan;
  const repo = makeMockRepo({
    createSearchPlan: async (plan) => {
      capturedPlan = plan;
      return { id: 'x', plan_version: '1.0.0', query_count: plan.queryCount };
    },
  });
  await buildSearchPlan({ candidateId: 'cand-001', cip: VALID_CIP, repository: repo });

  const plan = capturedPlan.planJson;
  assert.equal(typeof plan.planVersion,    'string');
  assert.equal(typeof plan.planHash,       'string');
  assert.equal(typeof plan.candidateId,    'string');
  assert.equal(typeof plan.profileVersion, 'string');
  assert.equal(typeof plan.generatedAt,    'string');
  assert.ok(Array.isArray(plan.queries));
  assert.ok(plan.queries.length > 0);
  assert.ok(typeof plan.meta.totalQueries === 'number');
  assert.ok(typeof plan.meta.tierCounts   === 'object');
  assert.ok(typeof plan.meta.careerStage  === 'string');
});

test('buildSearchPlan: re-throws repository errors as-is', async () => {
  const repoError = new Error('DB connection lost');
  const repo = makeMockRepo({ createSearchPlan: async () => { throw repoError; } });
  await assert.rejects(
    () => buildSearchPlan({ candidateId: 'cand-001', cip: VALID_CIP, repository: repo }),
    (err) => err === repoError
  );
});

test('SearchPlanError has correct code property', () => {
  const err = new SearchPlanError('INPUT_INVALID', 'bad input', { field: 'cip' });
  assert.equal(err.code, 'INPUT_INVALID');
  assert.equal(err.context.field, 'cip');
  assert.ok(err instanceof Error);
});
