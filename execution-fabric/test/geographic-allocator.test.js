'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateGeography } = require('../src/geographic-allocator');

test('geographic-allocator respects 75% local rule', () => {
  const opps = [
    { id: 1, location: 'London, UK' }, // intl (1)
    { id: 2, location: 'New York, US' }, // intl (2)
    { id: 3, location: 'San Francisco, US' }, // intl (skip - max 2 for limit 8)
    { id: 4, location: 'Mumbai, India' }, // local
    { id: 5, location: 'Remote' }, // remote (local-equivalent)
    { id: 6, location: 'Delhi, India' }, // local
    { id: 7, location: 'Bangalore, India' }, // local
    { id: 8, location: 'Sydney, Australia' }, // intl (skip)
    { id: 9, location: 'Chennai, India' }, // local
    { id: 10, location: 'Pune, India' } // local
  ];

  // Limit 8 => Max international is Math.floor(8 * 0.25) = 2.
  const allocated = allocateGeography('India', opps, 8);
  
  assert.equal(allocated.length, 8);
  // It should pick IDs 1, 2 (intl), then skip 3, then pick 4,5,6,7, skip 8, pick 9,10
  assert.deepEqual(allocated.map(o => o.id), [1, 2, 4, 5, 6, 7, 9, 10]);
});

test('geographic-allocator allows full local if no international', () => {
  const opps = [
    { id: 1, location: 'Mumbai, India' },
    { id: 2, location: 'Delhi, India' },
    { id: 3, location: 'Remote - India' }
  ];

  const allocated = allocateGeography('India', opps, 3);
  assert.equal(allocated.length, 3);
  assert.deepEqual(allocated.map(o => o.id), [1, 2, 3]);
});

test('geographic-allocator handles all international gracefully by just filling up to quota', () => {
  const opps = [
    { id: 1, location: 'London, UK' },
    { id: 2, location: 'New York, US' },
    { id: 3, location: 'Sydney, Australia' },
  ];

  // Limit 4 => Max intl = 1
  const allocated = allocateGeography('India', opps, 4);
  assert.equal(allocated.length, 1);
  assert.deepEqual(allocated.map(o => o.id), [1]);
});
