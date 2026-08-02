'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { execute, classifyError, computeDelay, ProviderHttpError,
        TRANSIENT_HTTP_CODES, PERMANENT_HTTP_CODES } = require('../src/retry-policy');

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

test('classifyError: TRANSIENT for 429', () => {
  const err = new ProviderHttpError(429, 'Rate limited', 'http://example.com');
  assert.equal(classifyError(err), 'TRANSIENT');
});

test('classifyError: TRANSIENT for 503', () => {
  assert.equal(classifyError(new ProviderHttpError(503, 'Service unavailable', '')), 'TRANSIENT');
});

test('classifyError: PERMANENT for 404', () => {
  assert.equal(classifyError(new ProviderHttpError(404, 'Not found', '')), 'PERMANENT');
});

test('classifyError: PERMANENT for 403', () => {
  assert.equal(classifyError(new ProviderHttpError(403, 'Forbidden', '')), 'PERMANENT');
});

test('classifyError: PERMANENT for 400', () => {
  assert.equal(classifyError(new ProviderHttpError(400, 'Bad request', '')), 'PERMANENT');
});

test('classifyError: TRANSIENT for network ECONNREFUSED', () => {
  const err = new Error('connect ECONNREFUSED');
  err.code = 'ECONNREFUSED';
  assert.equal(classifyError(err), 'TRANSIENT');
});

test('classifyError: TRANSIENT for ETIMEDOUT', () => {
  const err = new Error('timeout');
  err.code = 'ETIMEDOUT';
  assert.equal(classifyError(err), 'TRANSIENT');
});

test('classifyError: PERMANENT for ValidationError', () => {
  const err = new Error('schema invalid');
  err.name = 'ValidationError';
  assert.equal(classifyError(err), 'PERMANENT');
});

test('classifyError: TRANSIENT for unknown error (default)', () => {
  const err = new Error('mysterious error');
  assert.equal(classifyError(err), 'TRANSIENT');
});

// ---------------------------------------------------------------------------
// computeDelay
// ---------------------------------------------------------------------------

test('computeDelay: returns number >= 0', () => {
  for (let i = 0; i < 10; i++) {
    const d = computeDelay(i, 1000);
    assert.ok(d >= 0);
    assert.ok(Number.isFinite(d));
  }
});

test('computeDelay: capped by maxDelay', () => {
  for (let i = 0; i < 20; i++) {
    const d = computeDelay(10, 1000, 5000);
    assert.ok(d <= 5000);
  }
});

// ---------------------------------------------------------------------------
// execute() — retry logic
// ---------------------------------------------------------------------------

test('execute: returns result on first success', async () => {
  let calls = 0;
  const result = await execute(async () => { calls++; return 'ok'; }, { maxAttempts: 3 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('execute: retries TRANSIENT errors and succeeds on 3rd attempt', async () => {
  let calls = 0;
  const result = await execute(async () => {
    calls++;
    if (calls < 3) {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return 'recovered';
  }, { maxAttempts: 3, baseDelayMs: 0 });
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
});

test('execute: does NOT retry PERMANENT errors', async () => {
  let calls = 0;
  const permanentErr = new ProviderHttpError(404, 'Not found', '');
  await assert.rejects(
    () => execute(async () => { calls++; throw permanentErr; }, { maxAttempts: 3 }),
    (err) => err === permanentErr
  );
  assert.equal(calls, 1); // No retries
});

test('execute: throws after maxAttempts exhausted', async () => {
  let calls = 0;
  const transientErr = new ProviderHttpError(503, 'Down', '');
  await assert.rejects(
    () => execute(async () => { calls++; throw transientErr; }, { maxAttempts: 3, baseDelayMs: 0 }),
    (err) => err === transientErr
  );
  assert.equal(calls, 3);
});

test('execute: calls onRetry with attempt number and delay', async () => {
  const retries = [];
  const err503  = new ProviderHttpError(503, 'Service down', '');
  await assert.rejects(
    () => execute(
      async () => { throw err503; },
      {
        maxAttempts:  3,
        baseDelayMs:  0,
        onRetry:      (attempt, err, delay) => retries.push({ attempt, delay }),
      }
    ),
    () => true
  );
  assert.equal(retries.length, 2); // 2 retries for 3 total attempts
  assert.equal(retries[0].attempt, 1);
  assert.equal(retries[1].attempt, 2);
});

// ---------------------------------------------------------------------------
// ProviderHttpError
// ---------------------------------------------------------------------------

test('ProviderHttpError: has statusCode and url properties', () => {
  const err = new ProviderHttpError(429, 'Too Many Requests', 'https://api.example.com');
  assert.equal(err.statusCode, 429);
  assert.equal(err.url, 'https://api.example.com');
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// Constant sets
// ---------------------------------------------------------------------------

test('TRANSIENT_HTTP_CODES includes 429, 503, 504', () => {
  assert.ok(TRANSIENT_HTTP_CODES.has(429));
  assert.ok(TRANSIENT_HTTP_CODES.has(503));
  assert.ok(TRANSIENT_HTTP_CODES.has(504));
});

test('PERMANENT_HTTP_CODES includes 400, 403, 404', () => {
  assert.ok(PERMANENT_HTTP_CODES.has(400));
  assert.ok(PERMANENT_HTTP_CODES.has(403));
  assert.ok(PERMANENT_HTTP_CODES.has(404));
});
