'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { CircuitBreaker, createRegistry, STATES } = require('../src/circuit-breaker');

// ---------------------------------------------------------------------------
// CircuitBreaker state machine
// ---------------------------------------------------------------------------

test('CircuitBreaker: starts in CLOSED state', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
  assert.equal(cb.state, STATES.CLOSED);
  assert.ok(cb.allowRequest());
  assert.ok(!cb.isOpen());
});

test('CircuitBreaker: stays CLOSED below failure threshold', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 1000 });
  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.state, STATES.CLOSED);
});

test('CircuitBreaker: transitions CLOSED → OPEN at threshold', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 60_000 });
  cb.recordFailure();
  cb.recordFailure();
  const transition = cb.recordFailure(); // 3rd failure = threshold
  assert.equal(cb.state, STATES.OPEN);
  assert.ok(cb.isOpen());
  assert.ok(!cb.allowRequest());
  assert.ok(transition?.transitioned);
  assert.equal(transition.to, STATES.OPEN);
});

test('CircuitBreaker: OPEN → HALF_OPEN after cooldown (simulated)', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, cooldownMs: 0 });
  cb.recordFailure(); // → OPEN
  // cooldownMs = 0 means any elapsed time is enough
  assert.equal(cb.state, STATES.HALF_OPEN);
  assert.ok(cb.allowRequest()); // HALF_OPEN allows one probe
});

test('CircuitBreaker: HALF_OPEN + success → CLOSED', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, cooldownMs: 0 });
  cb.recordFailure(); // → OPEN
  assert.equal(cb.state, STATES.HALF_OPEN); // cooldownMs=0 → immediate HALF_OPEN
  const transition = cb.recordSuccess();
  assert.equal(cb.state, STATES.CLOSED);
  assert.ok(transition?.transitioned);
  assert.equal(transition.to, STATES.CLOSED);
});

test('CircuitBreaker: HALF_OPEN + failure → OPEN', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, cooldownMs: 10000 });
  cb._state = STATES.HALF_OPEN; // manually simulate cooldown expired
  const transition = cb.recordFailure(); // fails probe → back to OPEN
  assert.equal(cb.state, STATES.OPEN);
  assert.equal(transition.to, STATES.OPEN);
});

test('CircuitBreaker: success in CLOSED resets failure counter', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3, cooldownMs: 60_000 });
  cb.recordFailure();
  cb.recordFailure();
  cb.recordSuccess(); // reset
  cb.recordFailure();
  cb.recordFailure();
  // Should still be CLOSED (only 2 consecutive failures after reset)
  assert.equal(cb.state, STATES.CLOSED);
});

test('CircuitBreaker: reset() restores to CLOSED', () => {
  const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1, cooldownMs: 60_000 });
  cb.recordFailure();
  assert.equal(cb.state, STATES.OPEN);
  cb.reset();
  assert.equal(cb.state, STATES.CLOSED);
  assert.equal(cb._consecutiveFails, 0);
});

test('CircuitBreaker: toJSON() returns state object', () => {
  const cb   = new CircuitBreaker({ name: 'my-provider', failureThreshold: 3, cooldownMs: 1000 });
  const json = cb.toJSON();
  assert.equal(json.name, 'my-provider');
  assert.equal(json.state, STATES.CLOSED);
  assert.equal(typeof json.consecutiveFails, 'number');
});

// ---------------------------------------------------------------------------
// createRegistry
// ---------------------------------------------------------------------------

test('createRegistry: creates CB on first get()', () => {
  const reg = createRegistry({ failureThreshold: 5, cooldownMs: 60_000 });
  const cb  = reg.get('greenhouse');
  assert.ok(cb instanceof CircuitBreaker);
  assert.equal(cb.state, STATES.CLOSED);
});

test('createRegistry: returns same instance on subsequent get()', () => {
  const reg = createRegistry({ failureThreshold: 5, cooldownMs: 60_000 });
  const a   = reg.get('greenhouse');
  const b   = reg.get('greenhouse');
  assert.equal(a, b); // referential equality
});

test('createRegistry: different providers get separate instances', () => {
  const reg = createRegistry({ failureThreshold: 5, cooldownMs: 60_000 });
  const a   = reg.get('greenhouse');
  const b   = reg.get('lever');
  assert.notEqual(a, b);
  a.recordFailure();
  assert.equal(b.state, STATES.CLOSED); // lever unaffected
});

test('createRegistry: getAll() returns snapshot of all CBs', () => {
  const reg = createRegistry({ failureThreshold: 5, cooldownMs: 60_000 });
  reg.get('greenhouse');
  reg.get('lever');
  const all = reg.getAll();
  assert.ok('greenhouse' in all);
  assert.ok('lever' in all);
  assert.equal(all.greenhouse.state, STATES.CLOSED);
});
