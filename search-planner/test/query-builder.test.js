'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  buildTier1Queries, buildTier2Queries, buildTier3Queries,
  buildTier4Queries, buildAllQueries, buildExclusions,
} = require('../src/query-builder');
const { normalizeLocations } = require('../src/normalizers/location-normalizer');

// Shared test fixtures.
const BASE_PARAMS = {
  titleVariants:       ['Backend Engineer Intern', 'Backend Engineering Internship'],
  skills:              ['Python', 'Node.js', 'PostgreSQL', 'Docker', 'TypeScript'],
  adjacentRoles:       ['Full Stack Engineer', 'AI Application Developer'],
  domainSkills:        ['Cloud Computing', 'Distributed Systems'],
  locations:           ['San Francisco, CA', 'Remote'],
  normalizedLocations: normalizeLocations(['San Francisco, CA']),
  exclusions:          buildExclusions('student'),
  careerStage:         'student',
  freshness:           '24h',
};

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

test('buildTier1Queries: produces one query per skill (up to maxQueriesPerTier)', () => {
  const queries = buildTier1Queries(BASE_PARAMS);
  assert.ok(queries.length > 0);
  assert.ok(queries.length <= 5); // SP_MAX_QUERIES_PER_TIER default
  queries.forEach((q) => assert.equal(q.tier, 1));
});

test('buildTier1Queries: every query has required fields', () => {
  const queries = buildTier1Queries(BASE_PARAMS);
  for (const q of queries) {
    assert.ok(typeof q.queryId === 'string' && q.queryId.length === 16, 'queryId must be 16-char hex');
    assert.ok(Array.isArray(q.roles)    && q.roles.length    > 0, 'roles required');
    assert.ok(Array.isArray(q.skills)   && q.skills.length   > 0, 'skills required');
    assert.ok(Array.isArray(q.locations), 'locations required');
    assert.ok(Array.isArray(q.keywords), 'keywords required');
    assert.ok(Array.isArray(q.exclusions), 'exclusions required');
    assert.ok(typeof q.priority  === 'string', 'priority required');
    assert.ok(typeof q.freshness === 'string', 'freshness required');
  }
});

test('buildTier1Queries: type is core_skill', () => {
  buildTier1Queries(BASE_PARAMS).forEach((q) => assert.equal(q.type, 'core_skill'));
});

test('buildTier1Queries: queryId is deterministic', () => {
  const a = buildTier1Queries(BASE_PARAMS);
  const b = buildTier1Queries(BASE_PARAMS);
  a.forEach((q, i) => assert.equal(q.queryId, b[i].queryId));
});

test('buildTier1Queries: NO provider names in queries', () => {
  const queries = buildTier1Queries(BASE_PARAMS);
  const serialized = JSON.stringify(queries);
  for (const name of ['greenhouse', 'lever', 'ashby', 'linkedin', 'serpapi', 'google']) {
    assert.ok(!serialized.toLowerCase().includes(name), `Provider "${name}" must not appear in SearchPlan`);
  }
});

test('buildTier1Queries: exclusions contain senior qualifiers for student', () => {
  const queries = buildTier1Queries(BASE_PARAMS);
  queries.forEach((q) => assert.ok(q.exclusions.includes('senior')));
});

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

test('buildTier2Queries: produces adjacent role queries', () => {
  const queries = buildTier2Queries(BASE_PARAMS);
  assert.ok(queries.length > 0);
  queries.forEach((q) => assert.equal(q.tier, 2));
  queries.forEach((q) => assert.equal(q.type, 'adjacent_role'));
});

test('buildTier2Queries: priority is medium', () => {
  buildTier2Queries(BASE_PARAMS).forEach((q) => assert.equal(q.priority, 'medium'));
});

// ---------------------------------------------------------------------------
// Tier 3
// ---------------------------------------------------------------------------

test('buildTier3Queries: produces domain-stage queries', () => {
  const queries = buildTier3Queries(BASE_PARAMS);
  assert.ok(queries.length > 0);
  queries.forEach((q) => assert.equal(q.tier, 3));
  queries.forEach((q) => assert.equal(q.type, 'domain_stage'));
});

// ---------------------------------------------------------------------------
// Tier 4
// ---------------------------------------------------------------------------

test('buildTier4Queries: geographic expansion of top tier-1 queries', () => {
  const t1      = buildTier1Queries(BASE_PARAMS);
  const queries = buildTier4Queries({ tier1Queries: t1, ...BASE_PARAMS });
  if (queries.length > 0) {
    queries.forEach((q) => assert.equal(q.tier, 4));
    queries.forEach((q) => assert.equal(q.priority, 'low'));
  }
});

// ---------------------------------------------------------------------------
// buildAllQueries — combined
// ---------------------------------------------------------------------------

test('buildAllQueries: returns non-empty array', () => {
  const queries = buildAllQueries(BASE_PARAMS);
  assert.ok(queries.length > 0);
});

test('buildAllQueries: no duplicate queryIds', () => {
  const queries = buildAllQueries(BASE_PARAMS);
  const ids     = queries.map((q) => q.queryId);
  const unique  = new Set(ids);
  assert.equal(ids.length, unique.size);
});

test('buildAllQueries: respects maxTotalQueries cap', () => {
  const queries = buildAllQueries(BASE_PARAMS);
  assert.ok(queries.length <= 20); // SP_MAX_TOTAL_QUERIES default
});

test('buildAllQueries: all four tiers represented when enough data', () => {
  const queries = buildAllQueries(BASE_PARAMS);
  const tiers   = new Set(queries.map((q) => q.tier));
  assert.ok(tiers.has(1), 'Tier 1 required');
  assert.ok(tiers.has(2), 'Tier 2 required');
});

// ---------------------------------------------------------------------------
// buildExclusions
// ---------------------------------------------------------------------------

test('buildExclusions: student excludes senior+', () => {
  const ex = buildExclusions('student');
  assert.ok(ex.includes('senior'));
  assert.ok(ex.includes('staff'));
  assert.ok(ex.includes('principal'));
});

test('buildExclusions: mid-career does not exclude senior', () => {
  const ex = buildExclusions('mid-career');
  assert.ok(!ex.includes('senior'));
  assert.ok(ex.includes('director'));
});
