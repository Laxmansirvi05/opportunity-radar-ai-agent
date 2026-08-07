'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { validate, computeContentHash } = require('../src/validator');

// Mock dedup repository
function makeDedupRepo(existingHashes = []) {
  const store = new Set(existingHashes);
  return {
    hasSignature: async (hash) => store.has(hash),
  };
}

const VALID_RAW = {
  title:          'Software Engineer',
  company:        'Acme Corp',
  location:       { city: 'Remote', state: null, country: null },
  workplaceType:  'remote',
  employmentType: 'full-time',
  description:    'We are looking for a software engineer...',
  requirements:   ['Python', 'JavaScript'],
  skills:         ['Python', 'JavaScript'],
  applicationUrl: 'https://acme.com/jobs/123',
  deadline:       '2026-12-31',
};

test('computeContentHash: produces stable SHA-256 hex string', () => {
  const hash1 = computeContentHash({ title: 'A', company: 'B', location: 'C', employmentType: 'D' });
  const hash2 = computeContentHash({ title: 'a', company: ' b ', location: 'C', employmentType: 'D' });
  assert.equal(hash1, hash2, 'Hash must be case-insensitive and trimmed');
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64);
});

test('validate: returns valid opportunity when all checks pass', async () => {
  const repo = makeDedupRepo();
  const res  = await validate(VALID_RAW, repo);
  assert.ok(res.valid);
  assert.equal(res.opportunity.title, 'Software Engineer');
  assert.equal(typeof res.contentHash, 'string');
});

test('validate: fails on schema validation (ai-gateway logic)', async () => {
  const repo = makeDedupRepo();
  const invalidRaw = { ...VALID_RAW, workplaceType: 'invalid_type' }; // not in enum
  const res = await validate(invalidRaw, repo);
  assert.ok(!res.valid);
  assert.equal(res.code, 'SCHEMA_INVALID');
  assert.ok(res.reason.includes('workplaceType'));
});

test('validate: fails on missing title or company (quality check)', async () => {
  const repo = makeDedupRepo();
  const invalidRaw = { ...VALID_RAW, title: null };
  const res = await validate(invalidRaw, repo);
  assert.ok(!res.valid);
  assert.equal(res.code, 'QUALITY_INSUFFICIENT');
});

test('validate: fails when applicationUrl is not http/https', async () => {
  const repo = makeDedupRepo();
  const invalidRaw = { ...VALID_RAW, applicationUrl: 'ftp://acme.com/jobs/123' };
  const res = await validate(invalidRaw, repo);
  assert.ok(!res.valid);
  assert.equal(res.code, 'SCHEMA_INVALID');
});

test('validate: fails when content hash exists in dedup repository', async () => {
  const hash = computeContentHash(VALID_RAW);
  const repo = makeDedupRepo([hash]);
  const res  = await validate(VALID_RAW, repo);
  assert.ok(!res.valid);
  assert.equal(res.code, 'DUPLICATE');
  assert.ok(res.reason.includes('already stored'));
});

test('validate: NEVER throws exceptions, always returns error object', async () => {
  const throwingRepo = {
    hasSignature: async () => { throw new Error('DB Down'); }
  };
  const res = await validate(VALID_RAW, throwingRepo);
  assert.ok(!res.valid);
  assert.equal(res.code, 'DEDUP_ERROR');
  assert.equal(res.reason, 'DB Down');
});
