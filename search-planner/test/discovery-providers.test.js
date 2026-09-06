'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { searchFreeFirst, jobSpy } = require('../src/discovery-providers');

test('free-first search returns successful providers while isolating failures', async () => {
  const response = await searchFreeFirst('software intern', { providers: [
    { name: 'ok', available: () => true, search: async () => [{ title: 'Intern', url: 'https://example.test/job', provider: 'ok' }] },
    { name: 'down', available: () => true, search: async () => { throw new Error('offline'); } },
    { name: 'disabled', available: () => false, search: async () => [] },
  ] });
  assert.equal(response.results.length, 1);
  assert.deepEqual(response.providers, [
    { name: 'ok', status: 'ok', count: 1 },
    { name: 'down', status: 'unavailable', error: 'offline', count: 0 },
  ]);
});

test('JobSpy is optional and excludes LinkedIn from every request', async () => {
  const provider = jobSpy({ baseUrl: 'http://127.0.0.1:9999' });
  assert.equal(provider.available(), true);
  const source = provider.search.toString();
  assert.match(source, /indeed,glassdoor,google,zip_recruiter,bayt,bdjobs,naukri/);
  assert.doesNotMatch(source, /site_name.*linkedin/i);
});
