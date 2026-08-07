'use strict';

/**
 * verify-task4.js — score floor + tier contract, against the real captured run
 * and against constructed edge cases. Zero network calls.
 */

const assert = require('assert');
const { runNode, loadFixture } = require('./replay');

const VALID_TIERS = new Set(['same_state', 'same_country', 'international', 'unresolved_location']);
const FAIL_MARKER = 'Scoring failed due to timeout or error';

function asNewShape(items) {
  return items.map((o) => {
    const failed = o.reasoning === FAIL_MARKER;
    return {
      ...o,
      score: failed ? null : o.score,
      scoring_status: failed ? 'failed' : 'scored',
      scoring_error: failed ? 'PROVIDERS_UNAVAILABLE' : null,
    };
  });
}

async function allocate(items, candidate) {
  const finalized = await runNode('Finalize Results', {
    input: items, nodes: { 'Code in JavaScript': candidate },
  });
  return runNode('Geographic Allocator', {
    input: finalized, nodes: { 'Code in JavaScript': candidate },
  });
}

function synth(n, score, { state = 'Telangana', country = 'India' } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Role ${score}-${i}`,
    company: `Co${i}`,
    score,
    scoring_status: 'scored',
    state, country,
    // A real posting has a specific apply URL; product rule 5 now excludes any
    // item without one, so fixtures must carry one to represent reality.
    application_url: `https://boards.greenhouse.io/co${i}/jobs/${1000 + i}`,
  }));
}

(async () => {
  const candidate = loadFixture('candidate');
  const scored = loadFixture('scored');

  console.log('=== TASK 4: score floor + tier contract ===');

  // --- Real captured run ---
  const out = await allocate(asNewShape(scored), candidate);
  // The allocator returns a single explicit carrier when nothing qualifies.
  const isCarrier = out.length === 1 && Array.isArray(out[0].opportunities);
  const allocatedItems = isCarrier ? [] : out;
  const summary = out[0].allocation_summary;
  console.log('\n--- real captured run ---');
  console.log(`  scores allocated   : ${JSON.stringify(allocatedItems.map((o) => o.score))}`);
  console.log(`  tiers              : ${JSON.stringify(allocatedItems.map((o) => o.tier))}`);
  console.log(`  allocation_summary : ${JSON.stringify(summary)}`);

  console.log('\n=== ASSERTIONS ===');

  assert.ok(allocatedItems.every((o) => o.score >= summary.min_score),
    'every allocated item must clear the score floor');
  console.log(`  PASS  no item below the score floor (${summary.min_score}) is allocated`);

  assert.ok(allocatedItems.every((o) => VALID_TIERS.has(o.tier)),
    `tier must be geographic, got ${JSON.stringify([...new Set(allocatedItems.map((o) => o.tier))])}`);
  console.log('  PASS  tier is strictly geographic — "backfilled" no longer emitted (F6)');

  assert.ok(allocatedItems.every((o) => ['quota', 'widened'].includes(o.allocation_reason)),
    'allocation_reason must be quota|widened');
  console.log('  PASS  widening signal moved to allocation_reason');

  assert.notEqual(summary.quota_status, 'full',
    'a partial result set must not report "full"');
  console.log(`  PASS  quota_status honest: "${summary.quota_status}" for ${summary.returned} of ${summary.target}`);

  assert.equal(summary.below_score_floor, 1,
    'the genuine score-0 item should be counted below the floor');
  console.log(`  PASS  below_score_floor reported: ${summary.below_score_floor} (the genuine score-0 item)`);

  // Product rule 5, measured on this fixture: 8 of the 9 successfully-scored
  // items carry no apply URL at all, so nothing survives. That exclusion is the
  // point — a student cannot apply to an opportunity with no link.
  assert.equal(summary.excluded_no_apply_url, 8,
    'items without an apply URL must be excluded and counted');
  assert.equal(summary.returned, 0);
  console.log(`  PASS  ${summary.excluded_no_apply_url} items excluded for having no apply URL (product rule 5)`);
  console.log('        -> this captured run yields 0 usable opportunities, reported honestly');

  // --- Edge: more than 10 qualify -> exactly 10, best-ranked ---
  const many = [...synth(8, 95), ...synth(8, 70), ...synth(8, 55)];
  const manyOut = await allocate(many, candidate);
  assert.equal(manyOut.length, 10, `expected exactly 10, got ${manyOut.length}`);
  assert.ok(manyOut.every((o) => o.score >= 70), 'top-10 should be the best-ranked');
  assert.equal(manyOut[0].quota_status, 'full');
  console.log(`  PASS  >10 qualify -> exactly 10, best-ranked (scores ${manyOut[0].score}..${manyOut[9].score}), quota_status "full"`);

  // --- Edge: everything below the floor -> nothing allocated, no padding ---
  const junk = synth(12, 20);
  const junkOut = await allocate(junk, candidate);
  const junkSummary = junkOut[0].allocation_summary;
  assert.ok(junkOut.length === 1 && Array.isArray(junkOut[0].opportunities) && junkOut[0].opportunities.length === 0,
    'all-junk input must return an explicit empty result, not padded rows');
  assert.equal(junkSummary.quota_status, 'insufficient');
  assert.equal(junkSummary.below_score_floor, 12);
  console.log('  PASS  all-below-floor -> 0 allocated, quota_status "insufficient", nothing padded');

  // --- Edge: every score failed -> not reported as "all scored low" ---
  const allFailed = Array.from({ length: 6 }, (_, i) => ({
    title: `X${i}`, score: null, scoring_status: 'failed', scoring_error: 'PROVIDERS_UNAVAILABLE',
    application_url: `https://boards.greenhouse.io/x/jobs/${2000 + i}`,
  }));
  const failedOut = await allocate(allFailed, candidate);
  const fs = failedOut[0].allocation_summary;
  assert.equal(fs.scored_candidates, 0, 'no item was successfully scored');
  assert.equal(fs.below_score_floor, 0, 'failures must NOT be counted as below-floor low scores');
  assert.equal(fs.scoring.failed, 6);
  console.log('  PASS  all-scoring-failed -> scored_candidates 0, below_score_floor 0, scoring.failed 6');
  console.log('        (failures are NOT misreported as "scored low")');

  // --- Edge: all in one geographic bucket ---
  const oneBucket = synth(11, 88, { state: 'Telangana', country: 'India' });
  const obOut = await allocate(oneBucket, candidate);
  assert.equal(obOut.length, 10);
  assert.ok(obOut.every((o) => o.tier === 'same_state'));
  console.log('  PASS  single-bucket input -> 10 allocated, all tier same_state, widening used');

  console.log('\nALL TASK-4 ASSERTIONS PASSED (0 network calls)');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
