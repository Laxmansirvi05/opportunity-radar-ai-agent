'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { deriveOpportunityTarget, parseEndYear, mostRecentEndYear }
  = require('../src/opportunity-type');

const NOW = 2026; // fixed so these tests never rot as real time passes

// ---------------------------------------------------------------------------
// Branch 1 — endYear >= 2 years in the future → internship
// ---------------------------------------------------------------------------

test('branch 1: graduating 2+ years out routes to internship', () => {
  const t = deriveOpportunityTarget({ education: [{ endYear: 2028 }], careerStage: 'student', currentYear: NOW });
  assert.equal(t.primary, 'internship');
  assert.deepEqual([...t.fallback], []);
  assert.equal(t.source, 'education_end_year');
  assert.equal(t.endYear, 2028);
  assert.equal(t.yearsUntilGraduation, 2);
  assert.equal(t.fallbackReason, null);
});

test('branch 1: a 2nd-year student far from graduating still routes to internship', () => {
  const t = deriveOpportunityTarget({ education: [{ endYear: 2030 }], careerStage: 'student', currentYear: NOW });
  assert.equal(t.primary, 'internship');
  assert.equal(t.yearsUntilGraduation, 4);
});

// ---------------------------------------------------------------------------
// Branch 2 — endYear is this year or next → job, internships as fallback
// ---------------------------------------------------------------------------

test('branch 2: graduating this year routes to job with internship fallback', () => {
  const t = deriveOpportunityTarget({ education: [{ endYear: NOW }], careerStage: 'student', currentYear: NOW });
  assert.equal(t.primary, 'job');
  assert.deepEqual([...t.fallback], ['internship']);
  assert.equal(t.source, 'education_end_year');
  assert.equal(t.yearsUntilGraduation, 0);
});

test('branch 2: graduating next year routes to job with internship fallback', () => {
  const t = deriveOpportunityTarget({ education: [{ endYear: 2027 }], careerStage: 'student', currentYear: NOW });
  assert.equal(t.primary, 'job');
  assert.deepEqual([...t.fallback], ['internship']);
  assert.equal(t.yearsUntilGraduation, 1);
});

test('branch 2: final-year student is NOT routed to internships despite careerStage student', () => {
  // This is the exact bug F3 describes: careerStage alone would say "internship".
  const t = deriveOpportunityTarget({ education: [{ endYear: NOW }], careerStage: 'student', currentYear: NOW });
  assert.notEqual(t.primary, 'internship');
  assert.equal(t.primary, 'job');
});

// ---------------------------------------------------------------------------
// Branch 3 — endYear in the past → job only
// ---------------------------------------------------------------------------

test('branch 3: already graduated routes to job with no internship fallback', () => {
  const t = deriveOpportunityTarget({ education: [{ endYear: 2024 }], careerStage: 'student', currentYear: NOW });
  assert.equal(t.primary, 'job');
  assert.deepEqual([...t.fallback], []);
  assert.equal(t.source, 'education_end_year');
  assert.equal(t.yearsUntilGraduation, -2);
});

// ---------------------------------------------------------------------------
// Branch 4 — missing / unparseable endYear → careerStage fallback, recorded
// ---------------------------------------------------------------------------

test('branch 4: missing education falls back to careerStage and records it', () => {
  const t = deriveOpportunityTarget({ education: undefined, careerStage: 'student', currentYear: NOW });
  assert.equal(t.primary, 'internship');
  assert.equal(t.source, 'career_stage_fallback');
  assert.equal(t.endYear, null);
  assert.match(t.fallbackReason, /no parseable education endYear/);
});

test('branch 4: null endYear falls back to careerStage and records it', () => {
  const t = deriveOpportunityTarget({
    education: [{ institution: 'State University', endYear: null }],
    careerStage: 'student',
    currentYear: NOW,
  });
  assert.equal(t.source, 'career_stage_fallback');
  assert.equal(t.endYear, null);
  assert.ok(t.fallbackReason.includes('student'));
});

test('branch 4: unparseable endYear falls back to careerStage and records it', () => {
  for (const bad of ['expected', '', 'N/A', {}, [], NaN, 'soon']) {
    const t = deriveOpportunityTarget({
      education: [{ endYear: bad }],
      careerStage: 'student',
      currentYear: NOW,
    });
    assert.equal(t.source, 'career_stage_fallback', `should not trust endYear: ${JSON.stringify(bad)}`);
  }
});

test('branch 4: implausible endYear is rejected rather than trusted', () => {
  // A typo like 22027 must not silently route the candidate to internships forever.
  const t = deriveOpportunityTarget({ education: [{ endYear: 22027 }], careerStage: 'senior', currentYear: NOW });
  assert.equal(t.source, 'career_stage_fallback');
  assert.equal(t.primary, 'job');
});

// ---------------------------------------------------------------------------
// Branch 5 — careerStage fallback maps non-students to job
// ---------------------------------------------------------------------------

test('branch 5: non-student careerStage falls back to job', () => {
  for (const stage of ['early-career', 'mid-career', 'senior', 'transitioning']) {
    const t = deriveOpportunityTarget({ education: [], careerStage: stage, currentYear: NOW });
    assert.equal(t.primary, 'job', `careerStage ${stage} should route to job`);
    assert.equal(t.source, 'career_stage_fallback');
  }
});

test('branch 5: entirely absent careerStage still yields a usable target', () => {
  const t = deriveOpportunityTarget({ currentYear: NOW });
  assert.equal(t.primary, 'job');
  assert.equal(t.source, 'career_stage_fallback');
  assert.match(t.fallbackReason, /unknown/);
});

// ---------------------------------------------------------------------------
// Most-recent-entry selection
// ---------------------------------------------------------------------------

test('uses the most recent education entry when several are present', () => {
  const education = [
    { institution: 'High School',      endYear: 2022 },
    { institution: 'State University', endYear: 2029 },
    { institution: 'Community College', endYear: 2024 },
  ];
  const t = deriveOpportunityTarget({ education, careerStage: 'student', currentYear: NOW });
  assert.equal(t.endYear, 2029);
  assert.equal(t.primary, 'internship');
});

test('ignores unparseable entries when picking the most recent', () => {
  const education = [
    { institution: 'A', endYear: 2024 },
    { institution: 'B', endYear: 'present' },
    { institution: 'C', endYear: null },
  ];
  assert.equal(mostRecentEndYear(education, NOW), 2024);
});

// ---------------------------------------------------------------------------
// parseEndYear
// ---------------------------------------------------------------------------

test('parseEndYear accepts numbers and year-leading strings', () => {
  assert.equal(parseEndYear(2027, NOW), 2027);
  assert.equal(parseEndYear('2027', NOW), 2027);
  assert.equal(parseEndYear('2027-05', NOW), 2027);
  assert.equal(parseEndYear(' 2027 ', NOW), 2027);
  assert.equal(parseEndYear('May 2027', NOW), null);
  assert.equal(parseEndYear(undefined, NOW), null);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('derivation is deterministic for the same inputs', () => {
  const args = { education: [{ endYear: 2028 }], careerStage: 'student', currentYear: NOW };
  assert.deepEqual(deriveOpportunityTarget(args), deriveOpportunityTarget(args));
});
