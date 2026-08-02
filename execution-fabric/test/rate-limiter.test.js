'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { createRateLimiter } = require('../src/rate-limiter');

// Mock Redis client — synchronous in-memory implementation for unit tests.
function makeRedis({ failOn = false, delay = 0 } = {}) {
  const store = {};
  return {
    async incr(key) {
      if (failOn) throw new Error('Redis connection refused');
      store[key] = (store[key] || 0) + 1;
      return store[key];
    },
    async expire() {
      if (failOn) throw new Error('Redis connection refused');
    },
    _store: store,
  };
}

// Silent logger for tests.
const silent = { warn() {} };

test('rate-limiter: allows first request (count=1)', async () => {
  const redis = makeRedis();
  const rl    = createRateLimiter({ maxRequests: 10, windowMs: 60_000, redisClient: redis, logger: silent });
  const result = await rl.check('greenhouse');
  assert.ok(result.allowed);
  assert.equal(result.remaining, 9);
});

test('rate-limiter: allows requests up to limit', async () => {
  const redis = makeRedis();
  const rl    = createRateLimiter({ maxRequests: 3, windowMs: 60_000, redisClient: redis, logger: silent });
  for (let i = 0; i < 3; i++) {
    const r = await rl.check('greenhouse');
    assert.ok(r.allowed, `Request ${i + 1} should be allowed`);
  }
});

test('rate-limiter: blocks when limit exceeded', async () => {
  const redis = makeRedis();
  const rl    = createRateLimiter({ maxRequests: 2, windowMs: 60_000, redisClient: redis, logger: silent });
  await rl.check('greenhouse'); // 1
  await rl.check('greenhouse'); // 2
  const result = await rl.check('greenhouse'); // 3 > limit
  assert.ok(!result.allowed);
  assert.equal(result.remaining, 0);
});

test('rate-limiter: different domains have independent counters', async () => {
  const redis = makeRedis();
  const rl    = createRateLimiter({ maxRequests: 1, windowMs: 60_000, redisClient: redis, logger: silent });
  const r1 = await rl.check('greenhouse'); // count=1
  const r2 = await rl.check('lever');      // different key, count=1
  assert.ok(r1.allowed);
  assert.ok(r2.allowed);
  const r3 = await rl.check('greenhouse'); // count=2 > limit=1
  assert.ok(!r3.allowed);
  const r4 = await rl.check('lever');      // count=2 > limit=1
  assert.ok(!r4.allowed);
});

test('rate-limiter: FAIL-OPEN when Redis throws', async () => {
  const redis = makeRedis({ failOn: true });
  let warnCalled = false;
  const logger = { warn() { warnCalled = true; } };
  const rl = createRateLimiter({ maxRequests: 1, windowMs: 60_000, redisClient: redis, logger });
  const result = await rl.check('greenhouse');
  assert.ok(result.allowed,   'Must allow when Redis is down (fail-open)');
  assert.ok(result.failOpen,  'failOpen flag must be set');
  assert.ok(warnCalled,       'Must log warning on Redis failure');
});

test('rate-limiter: remaining = -1 on fail-open', async () => {
  const redis = makeRedis({ failOn: true });
  const rl    = createRateLimiter({ maxRequests: 10, windowMs: 60_000, redisClient: redis, logger: silent });
  const result = await rl.check('test');
  assert.equal(result.remaining, -1);
});
