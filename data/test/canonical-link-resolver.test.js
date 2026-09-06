'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCanonicalApplyUrl } = require('../src/canonical-link-resolver');
test('official application URLs outrank third-party and LinkedIn is blocked', () => {
  const resolved = resolveCanonicalApplyUrl({ company: 'Acme', sourceUrl: 'https://www.linkedin.com/jobs/view/1', candidates: ['https://jobs.lever.co/acme/123', 'https://jobs.example-board.test/acme'] });
  assert.deepEqual(resolved, { url: 'https://jobs.lever.co/acme/123', apply_url_tier: 'official_ats' });
});
