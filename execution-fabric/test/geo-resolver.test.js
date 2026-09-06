'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCountry } = require('../src/geo-resolver');

test('geo-resolver extracts exact matches', () => {
  assert.equal(resolveCountry('San Francisco, CA'), 'US');
  assert.equal(resolveCountry('London, UK'), 'UK');
  assert.equal(resolveCountry('Mumbai, Maharashtra'), 'India');
  assert.equal(resolveCountry('Sydney'), 'Australia');
  assert.equal(resolveCountry('Remote - UK'), 'UK');
});

test('geo-resolver identifies remote', () => {
  assert.equal(resolveCountry('Remote'), 'remote');
  assert.equal(resolveCountry('Anywhere'), 'remote');
  // It checks for country matches first! So "Remote - UK" returns "UK".
});

test('geo-resolver falls back to unknown', () => {
  assert.equal(resolveCountry('Narnia'), 'unknown');
  assert.equal(resolveCountry(''), 'unknown');
  assert.equal(resolveCountry(null), 'unknown');
});
