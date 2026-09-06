'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isEligible } = require('../src/eligibility-gate');

test('eligibility-gate allows internships for 2nd year', () => {
  const profile = { eligibility_tier: '2nd_year' };
  const opp = { employment_type: 'Internship', description: 'Summer intern' };
  assert.equal(isEligible(profile, opp), true);
});

test('eligibility-gate rejects full-time for 2nd year', () => {
  const profile = { eligibility_tier: '2nd_year' };
  const opp = { employment_type: 'Full-time', description: 'Entry level developer' };
  assert.equal(isEligible(profile, opp), false);
});

test('eligibility-gate rejects full-time for 4th_year_strong if it does not explicitly accept freshers', () => {
  const profile = { eligibility_tier: '4th_year_strong' };
  const opp = { employment_type: 'Full-time', description: 'Looking for 3-5 years of experience.' };
  assert.equal(isEligible(profile, opp), false);
});

test('eligibility-gate allows full-time for 4th_year_strong if it accepts freshers', () => {
  const profile = { eligibility_tier: '4th_year_strong' };
  const opp = { employment_type: 'Full-time', description: 'Looking for a new grad or fresher to join.' };
  assert.equal(isEligible(profile, opp), true);
});

test('eligibility-gate allows unknown employment type if title contains intern', () => {
  const profile = { eligibility_tier: '3rd_year' };
  const opp = { title: 'Software Engineer Intern', description: 'Come work for us' };
  assert.equal(isEligible(profile, opp), true);
});
