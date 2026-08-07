'use strict';

/**
 * score-fit-gaps.test.js — Phase 2, STAGED AND UNVERIFIED AGAINST A REAL MODEL.
 *
 * These tests pin the CONTRACT the rewritten score_fit prompt is meant to
 * produce, and they run offline: they assert on the prompt text and on the
 * task's parsing, not on live model output.
 *
 * WHAT IS NOT PROVEN HERE: that a real model actually obeys the prompt. That
 * requires live scoring calls, which were deliberately not spent (API quota).
 * Until `node tools/verify-gap-quality.js` has been run against a live model,
 * Phase 2 must be reported as UNVERIFIED.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const scoreFit = require('../src/tasks/score-fit');

/** The exact artifacts observed in real captured output. */
const OBSERVED_ARTIFACTS = [
  'job description',
  'detailed job description',
  'required skills',
  'requirements',
  'location',
  'workplace type',
  'employment type',
  'employment type details',
  'specific company requirements',
];

function promptText() {
  // createModelInput exposes the system prompt used for the real call.
  return scoreFit.createModelInput({ candidate: {}, opportunity: {} }).systemPrompt;
}

test('prompt forbids every artifact actually seen in real scoring output', () => {
  const prompt = promptText().toLowerCase();
  for (const artifact of OBSERVED_ARTIFACTS) {
    assert.ok(
      prompt.includes(artifact),
      `prompt must explicitly forbid the observed artifact "${artifact}"`
    );
  }
});

test('prompt states the candidate-side framing of missing_requirements', () => {
  const prompt = promptText();
  assert.match(prompt, /what does this posting ask for that the CANDIDATE does not have/i);
  assert.match(prompt, /FORBIDDEN/);
});

test('prompt gives negative examples and permits an empty array', () => {
  const prompt = promptText();
  assert.match(prompt, /NEVER emit/i, 'negative examples are required');
  assert.match(prompt, /return an EMPTY ARRAY/i, 'empty must be an allowed answer');
  assert.match(prompt, /worse than no gap at all/i,
    'the prompt must say why filling the field is harmful');
});

test('prompt no longer describes job-seeking candidates (internships only)', () => {
  const prompt = promptText();
  assert.match(prompt, /INTERNSHIPS/);
  assert.ok(!/3rd\/4th year/.test(prompt),
    'the year-based framing was dropped with the internships-only scope change');
});

test('parseAndValidate still accepts a well-formed gap list', () => {
  const out = scoreFit.parseAndValidate(JSON.stringify({
    fit_score: 72,
    reasoning: 'Strong React overlap but no container experience.',
    missing_requirements: ['Docker', 'Kubernetes'],
  }));
  assert.equal(out.fit_score, 72);
  assert.deepEqual(out.missing_requirements, ['Docker', 'Kubernetes']);
});

test('parseAndValidate accepts an empty gap list — the correct answer for a bare posting', () => {
  const out = scoreFit.parseAndValidate(JSON.stringify({
    fit_score: 55,
    reasoning: 'Title matches but the posting states no requirements.',
    missing_requirements: [],
  }));
  assert.deepEqual(out.missing_requirements, []);
});

test('parseAndValidate rejects a response missing the gap field entirely', () => {
  assert.throws(
    () => scoreFit.parseAndValidate(JSON.stringify({ fit_score: 50, reasoning: 'x' })),
    (e) => e.code === 'TASK_OUTPUT_INVALID'
  );
});
