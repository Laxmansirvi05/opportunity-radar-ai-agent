'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTrust, scanKeywords, checkDomainOrgConsistency, scoreCompleteness } = require('../src/trust-screener');

// ── Signal 1: keyword scanning ──

test('payment-request keywords flag as scam', () => {
  const result = scanKeywords('Send ₹500 processing fee to apply for this internship');
  assert.equal(result.flagged, true);
  assert.ok(result.matches.some((m) => m.category === 'payment_requests'));
});

test('credential-harvesting keywords flag as scam', () => {
  const result = scanKeywords('Please share your OTP and bank account details for verification');
  assert.equal(result.flagged, true);
  assert.ok(result.matches.some((m) => m.category === 'credential_harvesting'));
});

test('clean description is not flagged', () => {
  const result = scanKeywords('We are looking for a motivated frontend developer intern to join our engineering team in Hyderabad. Strong React and TypeScript skills required.');
  assert.equal(result.flagged, false);
  assert.equal(result.matches.length, 0);
});

// ── Signal 2: domain-org consistency ──

test('trusted ATS domain is consistent', () => {
  const result = checkDomainOrgConsistency('https://jobs.lever.co/stripe/12345', 'Stripe');
  assert.equal(result.consistent, true);
  assert.equal(result.reason, 'trusted_ats');
});

test('company name in domain is consistent', () => {
  const result = checkDomainOrgConsistency('https://careers.google.com/jobs/12345', 'Google');
  assert.equal(result.consistent, true);
  assert.equal(result.reason, 'company_in_domain');
});

test('suspicious TLD is flagged inconsistent', () => {
  const result = checkDomainOrgConsistency('https://apply-now.xyz/job/12345', 'FakeCorp');
  assert.equal(result.consistent, false);
  assert.equal(result.reason, 'suspicious_tld');
});

// ── Signal 3: completeness ──

test('complete listing scores high', () => {
  const result = scoreCompleteness({
    title: 'Frontend Dev Intern', company: 'Acme', description: 'Build UIs',
    location: 'Remote', requirements: ['React'], skills: ['JS'], apply_url: 'https://example.com', employment_type: 'internship',
  });
  assert.ok(result.score >= 0.9);
  assert.equal(result.missing.length, 0);
});

test('missing required fields scores low', () => {
  const result = scoreCompleteness({ title: '', company: '', description: '' });
  assert.ok(result.score <= 0.3);
});

// ── Main classifier: three-way verdict ──

test('scam listing with payment request is excluded', () => {
  const result = classifyTrust({
    title: 'Amazing Internship Opportunity',
    company: 'Dream Corp',
    description: 'Pay ₹500 processing fee to apply. Guaranteed placement after training.',
    apply_url: 'https://dream-corp.xyz/apply',
  });
  assert.equal(result.verdict, 'excluded');
  assert.equal(result.scam_flagged, true);
});

test('well-formed listing from trusted ATS is trusted', () => {
  const result = classifyTrust({
    title: 'Software Engineering Intern',
    company: 'Stripe',
    description: 'Join our payments infrastructure team. Work on distributed systems at scale.',
    apply_url: 'https://jobs.lever.co/stripe/abc123',
    location: 'San Francisco, CA',
    requirements: ['CS degree in progress', 'Python or Java experience'],
    skills: ['Python', 'Distributed Systems'],
    employment_type: 'internship',
  });
  assert.equal(result.verdict, 'trusted');
  assert.equal(result.fraud_flagged, false);
  assert.equal(result.scam_flagged, false);
  assert.ok(result.trust_score >= 0.8);
});

test('listing with suspicious TLD and MLM language needs review', () => {
  const result = classifyTrust({
    title: 'Business Development Associate',
    company: 'WealthNow',
    description: 'Join our network marketing opportunity. Recruit members and earn commission.',
    apply_url: 'https://wealthnow.buzz/join',
  });
  assert.ok(['needs_review', 'excluded'].includes(result.verdict));
  assert.equal(result.fraud_flagged, true);
});
