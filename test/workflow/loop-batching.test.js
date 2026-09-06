'use strict';

/**
 * loop-batching.test.js — proves WHY "Loop Over Items" must keep batchSize 1,
 * and fails if anyone raises it without first merging the loop's fan-in points.
 *
 * BACKGROUND
 * ----------
 * workflows.json's "Loop Over Items" (splitInBatches v3) carries an inline note
 * saying batchSize MUST stay 1, with a live measurement: "batch 5 produced 2-3
 * Finalize/Build Response runs emitting partial results". A hardcoded constant
 * that caps throughput deserves better than a comment nobody can verify, so
 * this test reproduces the mechanism against n8n's REAL node implementation and
 * pins the workflow against a silent regression.
 *
 * THE MECHANISM
 * -------------
 * n8n calls a node's execute() once per incoming DELIVERY. A node with one
 * input fed by two branches that were never merged therefore runs twice.
 *
 * The loop body has two such unmerged fan-in points:
 *   Clean HTML  <- If(false)  + playwright
 *   JSON Parse  <- If1(false) + HTTP Request2
 *
 * With batchSize 1 a batch holds a single item, that item takes exactly one
 * side of each If, and the loop is fed back exactly once per iteration.
 *
 * With batchSize > 1 a batch straddles both sides, both branches fire, and the
 * loop gets fed back twice per iteration. Look at SplitInBatchesV3.execute():
 * it returns the done branch on ANY call where the queue is already drained
 * (`if (returnItems.length === 0) { done = true; return [processedItems, []] }`).
 * Extra deliveries drain the queue early, then each remaining delivery hits
 * that branch again — so "Finalize Results" runs several times, each time with
 * a different partial slice of processedItems. No items are lost; the service
 * just emits multiple different answers for one run.
 *
 * WHEN batchSize MAY BE RAISED
 * ----------------------------
 * Only after each fan-in above gets a Merge node so the loop is fed back once
 * per iteration. The structural assertions below fail the moment that changes,
 * which is the signal that this cap can be revisited.
 *
 * Run: node --test test/workflow/loop-batching.test.js
 *
 * Lives under test/ (not tests/) on purpose: tests/ is Playwright's testDir,
 * and this is a node:test file, not a Playwright spec.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Load the real splitInBatches v3 implementation from the installed n8n.
// Testing against a hand-written mock of the node would only prove the mock
// matches our theory; the whole point is to check the theory against the code
// that actually runs in production.
// ---------------------------------------------------------------------------

function resolveSplitInBatchesV3() {
  const rel = 'n8n-nodes-base/dist/nodes/SplitInBatches/v3/SplitInBatchesV3.node.js';
  const candidates = [];

  // Wherever the `n8n` binary on PATH resolves from (this repo runs n8n via
  // `npx n8n execute`, so a global install is the normal case).
  try {
    const bin = execFileSync('command', ['-v', 'n8n'], { encoding: 'utf8', shell: '/bin/sh' }).trim();
    if (bin) {
      const real = fs.realpathSync(bin);            // .../lib/node_modules/n8n/bin/n8n
      const pkgRoot = path.resolve(path.dirname(real), '..');
      candidates.push(path.join(pkgRoot, 'node_modules', rel));
    }
  } catch { /* n8n not on PATH; fall through to the local lookups */ }

  candidates.push(path.join(REPO_ROOT, 'node_modules', rel));
  try {
    candidates.push(require.resolve(rel, { paths: [REPO_ROOT] }));
  } catch { /* not installed locally */ }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const V3_PATH = resolveSplitInBatchesV3();

/**
 * Drives the real node through a loop whose body fans back in `deliveries`
 * times per iteration, and reports how often the done branch fired.
 *
 * @param {object}   options
 * @param {number}   options.batchSize
 * @param {number}   options.itemCount
 * @param {Function} options.deliveriesFor — batch => number of feedback deliveries
 */
async function runLoop({ batchSize, itemCount, deliveriesFor }) {
  const { SplitInBatchesV3 } = require(V3_PATH);
  const node = new SplitInBatchesV3();

  // nodeContext must be the SAME object across calls: that is how the node
  // remembers its queue between iterations (this.getContext('node')).
  const nodeContext = {};
  const sourceData = { previousNode: 'Discovery Quality Gate + Dedup' };

  const seed = Array.from({ length: itemCount }, (_, i) => ({ json: { idx: i } }));

  let inputData = seed;
  const doneEmissions = [];
  let calls = 0;

  // Pending feedback deliveries, each one a separate execute() call.
  const pending = [];

  const context = {
    getInputData: () => inputData,
    getContext: (type) => {
      assert.equal(type, 'node');
      return nodeContext;
    },
    getNodeParameter: (name, _idx, fallback) => {
      if (name === 'batchSize') return batchSize;
      if (name === 'options') return {};
      return fallback;
    },
    getInputSourceData: () => sourceData,
    getNode: () => ({ name: 'Loop Over Items' }),
  };

  const MAX_CALLS = itemCount * 8 + 20; // generous; guards against an infinite loop

  for (;;) {
    if (++calls > MAX_CALLS) throw new Error('loop did not terminate');

    const [doneBranch, loopBranch] = await node.execute.call(context);

    if (loopBranch.length === 0) {
      // Done branch fired. Record the slice it carried — a correct run emits
      // this exactly once, carrying every item.
      doneEmissions.push(doneBranch.map((item) => item.json.idx));
      if (pending.length === 0) break;
    } else {
      // The loop body ran. Queue one feedback delivery per unmerged branch
      // that the batch touched.
      const count = deliveriesFor(loopBranch);
      const perDelivery = Math.max(1, Math.ceil(loopBranch.length / count));
      for (let i = 0; i < count; i += 1) {
        pending.push(loopBranch.slice(i * perDelivery, (i + 1) * perDelivery));
      }
    }

    if (pending.length === 0) break;
    inputData = pending.shift();
  }

  return { doneEmissions, calls };
}

// ---------------------------------------------------------------------------
// Mechanism: what unmerged fan-in actually does to the done branch
// ---------------------------------------------------------------------------

test('batchSize 1: the done branch fires exactly once, with every item', async () => {
  if (!V3_PATH) return; // covered by the guard test below
  const { doneEmissions } = await runLoop({
    batchSize: 1,
    itemCount: 10,
    // A single item takes exactly one side of the If, so one delivery back.
    deliveriesFor: () => 1,
  });

  assert.equal(doneEmissions.length, 1,
    'batchSize 1 must produce one final answer');
  assert.deepEqual(doneEmissions[0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'the single done emission must carry every processed item');
});

test('batchSize 5 with unmerged fan-in: the done branch fires repeatedly, each time partial', async () => {
  if (!V3_PATH) return;
  const { doneEmissions } = await runLoop({
    batchSize: 5,
    itemCount: 10,
    // A batch of 2+ straddles the If: both branches fire and reconverge
    // without a Merge node, so the loop is fed back twice per iteration.
    deliveriesFor: (batch) => (batch.length > 1 ? 2 : 1),
  });

  // Measured here: 3 emissions carrying 5, then 8, then 10 items. That matches
  // the "batch 5 produced 2-3 Finalize/Build Response runs" note in the node.
  assert.ok(doneEmissions.length > 1,
    `expected several final answers, got ${doneEmissions.length} — if this now passes with 1, `
    + 'the fan-in was merged and batchSize can be revisited');

  // Each emission is a separate Finalize Results -> Build Response run, so the
  // pipeline emits several different answers for a single request.
  //
  // Only the LAST one is complete. That is what makes this a correctness bug
  // rather than a cosmetic one: pipeline-runner.js's extractResponse() scans
  // Build Response's runs in order and returns the FIRST item it finds, so the
  // job server would hand the student the first partial slice — here 5 of 10
  // opportunities — and report it as the whole result set.
  const last = doneEmissions[doneEmissions.length - 1];
  assert.deepEqual(last, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    'the final emission should be the complete set');

  const first = doneEmissions[0];
  assert.ok(first.length < 10,
    `the first emission must be partial for this bug to bite (got ${first.length}/10); `
    + 'extractResponse() reads the first run, so a partial first emission is '
    + 'silently served as the full answer');

  // Nothing is dropped from the pipeline's own accounting — the items are all
  // present across emissions. That is why this looked harmless in n8n's UI.
  assert.equal(new Set(doneEmissions.flat()).size, 10);
});

// ---------------------------------------------------------------------------
// Guard: pin the production workflow so this cannot silently regress
// ---------------------------------------------------------------------------

function loadWorkflow() {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'workflows.json'), 'utf8'));
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Every node feeding `target`'s input, across all sources. */
function sourcesOf(workflow, target) {
  const found = [];
  for (const [from, outputs] of Object.entries(workflow.connections || {})) {
    for (const branches of Object.values(outputs)) {
      (branches || []).forEach((branch, branchIndex) => {
        for (const conn of branch || []) {
          if (conn.node === target) found.push({ from, branchIndex });
        }
      });
    }
  }
  return found;
}

test('the n8n version under test still emits the done branch on a drained queue', () => {
  assert.ok(V3_PATH,
    'could not locate n8n-nodes-base SplitInBatchesV3. Install n8n (this repo '
    + 'runs it via `npx n8n execute`) so the loop cap can be verified against '
    + 'the real implementation instead of trusted on faith.');

  const source = fs.readFileSync(V3_PATH, 'utf8');
  // The exact line the bug hinges on. If a future n8n rewrites this, the
  // mechanism above may no longer hold and this cap must be re-derived.
  assert.match(source, /returnItems\.length === 0/,
    'SplitInBatchesV3 no longer short-circuits on an empty batch — re-verify '
    + 'the batchSize cap against the new implementation before trusting it');
});

test('Loop Over Items keeps batchSize 1', () => {
  const workflow = loadWorkflow();
  const loop = workflow.nodes.find((n) => n.name === 'Loop Over Items');
  assert.ok(loop, 'Loop Over Items node is missing from workflows.json');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');

  assert.equal(loop.parameters.batchSize, 1,
    'batchSize must stay 1 while the loop body has unmerged fan-in points. '
    + 'Raising it makes Finalize Results run several times per request, each '
    + 'with a partial slice of the results (see the mechanism tests above). '
    + 'To raise it, first add a Merge node at each fan-in listed in the '
    + 'structural test below.');

  assert.ok(
    typeof loop.notes === 'string' && /batchSize MUST stay 1/i.test(loop.notes),
    'the node must keep an inline note explaining the cap, so it is visible in '
    + 'the n8n editor where someone would go to change it'
  );
});

test('the loop body still has exactly the two unmerged fan-in points this cap assumes', () => {
  const workflow = loadWorkflow();

  // Documented so that whoever adds the Merge nodes knows what to look for.
  const expected = {
    'Clean HTML': ['If', 'playwright'],
    'JSON Parse': ['If1', 'HTTP Request2'],
  };

  for (const [target, sources] of Object.entries(expected)) {
    const actual = sourcesOf(workflow, target).map((s) => s.from).sort();
    assert.deepEqual(actual, [...sources].sort(),
      `${target} is expected to be fed by ${sources.join(' + ')} with no Merge `
      + 'node between them. If this changed, re-read loop-batching.test.js: '
      + 'merging these is exactly what unblocks a larger batchSize.');
  }

  // The loop is fed back from a single node, but that node inherits both
  // fan-ins above, which is how one iteration still produces two deliveries.
  const feedback = sourcesOf(workflow, 'Loop Over Items')
    .map((s) => s.from)
    .filter((from) => from !== 'Discovery Quality Gate + Dedup');
  assert.deepEqual(feedback, ['Resume Match Engine'],
    'the loop feedback edge moved; the delivery-count reasoning must be redone');
});

test('no Merge node has been added yet (raise batchSize only once one is)', () => {
  const workflow = loadWorkflow();
  const merges = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.merge');
  assert.equal(merges.length, 0,
    'a Merge node appeared in the workflow. If it merges the loop-body fan-in '
    + 'points, the batchSize 1 cap may no longer be needed — re-run the '
    + 'mechanism tests, update the expectations here, then raise batchSize.');
});
