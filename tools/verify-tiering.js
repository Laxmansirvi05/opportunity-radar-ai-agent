'use strict';

/**
 * verify-tiering.js — the result-tiering spec, replayed through the REAL
 * Build Response node code. Zero API calls.
 *
 * Spec:
 *   8-10  results only, no warning
 *   5-7   results + light suggestions
 *   3-4   results + clear resume-strength message
 *   1-2   results + strong message
 *   0     no results + what to build first
 *
 * The message must be specific and constructive, never discouraging, and a
 * scoring outage must never be framed as a weak resume.
 */

const assert = require('assert');
const { runNode, loadFixture } = require('./replay');

const DISCOURAGING = /\b(weak|poor|bad|inadequate|unqualified|insufficient resume|not good enough)\b/i;

function synth(n, score, missing = []) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Frontend Developer Intern ${i}`,
    company: `Co${i}`,
    score,
    scoring_status: 'scored',
    state: 'Telangana',
    country: 'India',
    missing_requirements: missing,
    application_url: `https://boards.greenhouse.io/co${i}/jobs/${1000 + i}`,
  }));
}

async function pipeline(items, candidate) {
  const finalized = await runNode('Finalize Results', {
    input: items, nodes: { 'Code in JavaScript': candidate },
  });
  const allocated = await runNode('Geographic Allocator', {
    input: finalized, nodes: { 'Code in JavaScript': candidate },
  });
  return (await runNode('Build Response', {
    input: allocated,
    nodes: {
      'Code in JavaScript': candidate,
      'Finalize Results': finalized,
      'Discovery Quality Gate + Dedup': [],
    },
  }))[0];
}

(async () => {
  const candidate = loadFixture('candidate');
  console.log('=== RESULT TIERING (replayed through real node code, 0 API calls) ===\n');

  const GAPS = ['Docker', 'AWS', 'TypeScript'];
  const cases = [
    { label: '8-10 → full',          n: 9, expectTier: 'full',         expectStrength: 'strong',     wantMessage: false },
    { label: '5-7  → good',          n: 6, expectTier: 'good',         expectStrength: 'strong',     wantMessage: true },
    { label: '3-4  → limited',       n: 4, expectTier: 'limited',      expectStrength: 'moderate',   wantMessage: true },
    { label: '1-2  → very_limited',  n: 2, expectTier: 'very_limited', expectStrength: 'needs_work', wantMessage: true },
    { label: '0    → none',          n: 0, expectTier: 'none',         expectStrength: 'needs_work', wantMessage: true },
  ];

  for (const c of cases) {
    // Extra low-scoring items give the gap aggregator real evidence to work from.
    const input = [...synth(c.n, 90, GAPS), ...synth(4, 20, GAPS)];
    const r = await pipeline(input, candidate);

    console.log(`--- ${c.label} ---`);
    console.log(`  count=${r.opportunity_count} status=${r.status} tier=${r.result_tier} strength=${r.resume_strength}`);
    console.log(`  feedback: ${r.resume_feedback ? `"${r.resume_feedback}"` : '(none — correct for a full list)'}`);

    assert.equal(r.opportunity_count, c.n, `${c.label}: count must be exactly what qualified`);
    assert.equal(r.result_tier, c.expectTier, `${c.label}: wrong tier`);
    assert.equal(r.resume_strength, c.expectStrength, `${c.label}: wrong resume_strength`);

    if (c.wantMessage) {
      assert.ok(r.resume_feedback && r.resume_feedback.length > 40,
        `${c.label}: a short list must carry a specific message`);
      assert.ok(!DISCOURAGING.test(r.resume_feedback),
        `${c.label}: message must not be discouraging — got "${r.resume_feedback}"`);
      // Specific: it must name real aggregated evidence, not generic filler.
      assert.ok(/Docker|AWS|TypeScript|project/i.test(r.resume_feedback),
        `${c.label}: message must be specific about what to add`);
    } else {
      assert.equal(r.resume_feedback, null, 'a full list must carry no warning');
    }
    console.log('');
  }

  console.log('=== ASSERTIONS ===');
  console.log('  PASS  every tier boundary assigns the correct tier and resume_strength');
  console.log('  PASS  short lists always carry a specific, non-discouraging message');
  console.log('  PASS  a full list carries no warning');

  // --- A scoring outage must never be blamed on the resume ---
  const outage = [
    ...synth(2, 90, GAPS),
    ...Array.from({ length: 9 }, (_, i) => ({
      title: `F${i}`, score: null, scoring_status: 'failed',
      scoring_error: 'PROVIDERS_UNAVAILABLE', missing_requirements: null,
      application_url: `https://boards.greenhouse.io/f/jobs/${3000 + i}`,
    })),
  ];
  const o = await pipeline(outage, candidate);
  console.log(`\n--- scoring outage (2 scored, 9 failed) ---`);
  console.log(`  feedback: "${o.resume_feedback}"`);
  assert.match(o.resume_feedback, /on our side|not a reflection/i,
    'a scoring outage must be owned, not blamed on the resume');
  assert.ok(!/resume is currently limiting|resume needs/i.test(o.resume_feedback),
    'must not tell the student their resume is the problem when scoring broke');
  console.log('  PASS  scoring outage is owned by us, never framed as a weak resume');

  // --- Never pads ---
  const few = await pipeline(synth(3, 90, GAPS), candidate);
  assert.equal(few.opportunity_count, 3, 'must return exactly what qualified');
  assert.equal(few.opportunities.length, 3);
  assert.ok(few.opportunities.every((x) => x.apply_url), 'every returned item must be applyable');
  console.log('  PASS  never pads: 3 real qualifying items returned as 3');

  console.log('\nALL TIERING ASSERTIONS PASSED (0 API calls)');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
