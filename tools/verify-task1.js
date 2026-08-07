'use strict';

/**
 * verify-task1.js — proves the scoring-visibility fix against a REAL captured run.
 *
 * Replays the actual Finalize Results + Geographic Allocator node code from
 * workflows.json against fixtures/scored.json, with zero network calls.
 *
 * The captured fixture predates the fix, so it carries the OLD failure shape
 * (score: 0, reasoning: 'Scoring failed due to timeout or error'). We first
 * re-express those items the way the FIXED Resume Match Engine now emits them
 * (score: null, scoring_status: 'failed'), then run the real downstream nodes.
 */

const { runNode, loadFixture } = require('./replay');

const FAIL_MARKER = 'Scoring failed due to timeout or error';

function asOldShape(items) {
  return items;
}

/** Re-express captured items as the FIXED Resume Match Engine emits them. */
function asNewShape(items) {
  return items.map((o) => {
    const failed = o.reasoning === FAIL_MARKER;
    return {
      ...o,
      score: failed ? null : o.score,
      scoring_status: failed ? 'failed' : 'scored',
      scoring_error: failed ? 'PROVIDERS_UNAVAILABLE' : null,
      reasoning: failed ? null : o.reasoning,
      missing_requirements: failed ? null : o.missing_requirements,
    };
  });
}

function summarize(label, allocated) {
  const scores = allocated.map((o) => o.score);
  // A genuine LLM score of 0 is "scored low", NOT "failed to score" — the whole
  // point of task-1. Only null/absent scores and failed status count as failures.
  // (Excluding genuinely-low scores from allocation is task-4's score floor.)
  const failedShown = allocated.filter(
    (o) => o.scoring_status !== 'scored' || typeof o.score !== 'number'
  ).length;
  console.log(`\n--- ${label} ---`);
  console.log(`  allocated items      : ${allocated.length}`);
  console.log(`  scores               : ${JSON.stringify(scores)}`);
  console.log(`  tiers                : ${JSON.stringify(allocated.map((o) => o.tier))}`);
  console.log(`  quota_status         : ${JSON.stringify([...new Set(allocated.map((o) => o.quota_status))])}`);
  console.log(`  FAILED scores shown  : ${failedShown}`);
  if (allocated[0] && allocated[0].scoring_summary) {
    console.log(`  scoring_summary      : ${JSON.stringify(allocated[0].scoring_summary)}`);
  }
  return { count: allocated.length, failedShown };
}

(async () => {
  const scored = loadFixture('scored');
  const candidate = loadFixture('candidate');

  const failed = scored.filter((o) => o.reasoning === FAIL_MARKER).length;
  console.log('=== REAL CAPTURED RUN ===');
  console.log(`  Resume Match Engine items : ${scored.length}`);
  console.log(`  failed to score           : ${failed} (${((failed / scored.length) * 100).toFixed(1)}%)`);

  // AFTER: run the real (fixed) node code on the corrected item shape.
  const newFinalized = await runNode('Finalize Results', {
    input: asNewShape(scored),
    nodes: { 'Code in JavaScript': candidate },
  });
  const newAllocated = await runNode('Geographic Allocator', {
    input: newFinalized,
    nodes: { 'Code in JavaScript': candidate },
  });
  const isCarrier = newAllocated.length === 1 && Array.isArray(newAllocated[0].opportunities);
  const allocatedItems = isCarrier ? [] : newAllocated;
  const after = summarize('AFTER fix (current workflow code)', allocatedItems);

  console.log('\n=== ASSERTIONS ===');
  const assert = require('assert');

  assert.equal(
    after.failedShown, 0,
    'no failed-to-score item may be allocated'
  );
  console.log('  PASS  no failed score is presented as a result');

  assert.ok(
    newFinalized.every((o) => o.scoring_status === 'scored'),
    'Finalize must emit only scored items'
  );
  console.log('  PASS  Finalize Results emits only successfully-scored items');

  const summary = newFinalized[0] && newFinalized[0].scoring_summary;
  assert.ok(summary, 'run-level scoring summary must be present');
  assert.equal(summary.attempted, scored.length);
  assert.equal(summary.failed, failed);
  assert.equal(summary.succeeded, scored.length - failed);
  console.log(`  PASS  run-level summary is honest: ${JSON.stringify(summary)}`);

  // Since task-4 the allocated set is (genuinely scored) AND (>= score floor),
  // so the ceiling is the number that cleared the floor, never the failed ones.
  const floor = newAllocated[0]?.allocation_summary?.min_score ?? 0;
  const aboveFloor = newFinalized.filter((o) => o.score >= floor).length;
  assert.ok(
    allocatedItems.length <= Math.min(10, aboveFloor),
    'allocation must not pad beyond the genuinely-scored, above-floor set'
  );
  assert.ok(
    allocatedItems.length <= summary.succeeded,
    'allocation can never exceed the number of successful scores'
  );
  console.log(`  PASS  allocated ${allocatedItems.length} from ${summary.succeeded} genuinely scored (no padding with failures)`);

  // Distinguishing "scored low" from "failed to score" is the whole point.
  const genuineLow = newFinalized.filter((o) => o.scoring_status === 'scored' && o.score === 0);
  console.log(`\n  NOTE  ${genuineLow.length} item(s) carry a genuine LLM score of 0 — retained by task-1 as`);
  console.log(`        "scored low" (not a failure), then excluded by task-4's floor of ${floor}.`);
  const alloc = newAllocated[0]?.allocation_summary;
  if (alloc) {
    console.log(`  NOTE  product rule 5 then excluded ${alloc.excluded_no_apply_url} item(s) with no apply URL`);
    console.log(`        and ${alloc.excluded_aggregator_page} aggregator page(s), leaving ${alloc.returned}.`);
  }

  console.log('\nALL TASK-1 FIXTURE ASSERTIONS PASSED (0 network calls)');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
