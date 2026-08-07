'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { executeQuery } = require('../src/worker');

function makeDeps(overrides = {}) {
  return {
    config: {
      maxRetryAttempts: 1,
      retryBaseDelayMs: 0,
    },
    circuitBreakers: {
      get: () => ({
        allowRequest: () => true,
        recordSuccess: () => null,
        recordFailure: () => null,
      }),
    },
    rateLimiter: {
      check: async () => ({ allowed: true, remaining: 10 }),
    },
    providerRegistry: {
      select: () => [
        {
          name: 'mock-provider',
          execute: async () => [
            {
              title: 'Software Engineer',
              company: 'Acme',
              location: { city: 'Remote', state: null, country: null },
              workplaceType: 'remote',
              employmentType: 'full-time',
              description: '...',
              requirements: [],
              skills: [],
              applicationUrl: 'https://acme.com',
              deadline: null,
              sourceUrl: 'https://acme.com',
              rawJson: {}
            }
          ]
        }
      ],
    },
    opportunityRepo: {
      upsertOpportunity: async () => ({ id: 'opp-1', isNew: true }),
    },
    dedupRepo: {
      hasSignature: async () => false,
      insertSignature: async () => {},
    },
    eventLogger: {
      logAsync: () => {},
      log: async () => {},
    },
    runId: 'run-123',
    ...overrides,
  };
}

const DUMMY_QUERY = { queryId: 'q-123', tier: 1 };

test('executeQuery: processes successfully when all dependencies succeed', async () => {
  const deps = makeDeps();
  const res = await executeQuery(DUMMY_QUERY, deps);
  
  assert.equal(res.queryId, 'q-123');
  assert.equal(res.providersAttempted, 1);
  assert.equal(res.opportunitiesFound, 1);
  assert.equal(res.errors.length, 0);
});

test('executeQuery: skips provider if circuit breaker is OPEN', async () => {
  const deps = makeDeps({
    circuitBreakers: {
      get: () => ({ allowRequest: () => false, state: 'OPEN' })
    }
  });
  const res = await executeQuery(DUMMY_QUERY, deps);
  assert.equal(res.providersAttempted, 0); // Didn't attempt
});

test('executeQuery: skips provider if rate limited', async () => {
  const deps = makeDeps({
    rateLimiter: { check: async () => ({ allowed: false, remaining: 0 }) }
  });
  const res = await executeQuery(DUMMY_QUERY, deps);
  assert.equal(res.providersAttempted, 0); // Blocked before attempt
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].reason, 'rate_limited');
});

test('executeQuery: does not fail worker if provider execution throws', async () => {
  const deps = makeDeps({
    providerRegistry: {
      select: () => [{
        name: 'fail-provider',
        execute: async () => { throw new Error('API down'); }
      }]
    }
  });
  const res = await executeQuery(DUMMY_QUERY, deps);
  assert.equal(res.providersAttempted, 1);
  assert.equal(res.opportunitiesFound, 0);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].error, 'API down');
});

test('executeQuery: handles validation failure without failing worker', async () => {
  const deps = makeDeps({
    providerRegistry: {
      select: () => [{
        name: 'mock-provider',
        execute: async () => [{ title: null }] // Invalid schema
      }]
    }
  });
  const res = await executeQuery(DUMMY_QUERY, deps);
  assert.equal(res.opportunitiesFound, 0);
  assert.equal(res.errors.length, 0); // Validation failure is skipped, not an error
});

test('executeQuery: does not count duplicates as new opportunities', async () => {
  const deps = makeDeps({
    dedupRepo: {
      hasSignature: async () => true, // Simulate existing duplicate
    }
  });
  const res = await executeQuery(DUMMY_QUERY, deps);
  assert.equal(res.opportunitiesFound, 0);
  assert.equal(res.errors.length, 0); // Duplicate is normal
});

test('executeQuery: returns zero if no providers support the query', async () => {
  const deps = makeDeps({
    providerRegistry: { select: () => [] }
  });
  const res = await executeQuery(DUMMY_QUERY, deps);
  assert.equal(res.providersAttempted, 0);
  assert.equal(res.opportunitiesFound, 0);
});
