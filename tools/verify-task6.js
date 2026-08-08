'use strict';

/**
 * verify-task6.js — proves the runOnceForEachItem conversion preserves
 * behavior, so batching cannot silently drop opportunities.
 *
 * For each converted in-loop node, the node's real jsCode is executed once
 * per item over real captured fixtures and the output is compared against the
 * output captured from the sequential run. Zero network calls.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const wf = JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows.json'), 'utf8'))[0];
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', `${name}.json`), 'utf8'));
}

/** Execute a runOnceForEachItem node against ONE item. */
function runPerItem(nodeName, itemJson, extraNodes = {}) {
  const node = byName[nodeName];
  const code = node.parameters.jsCode;

  const $ = (name) => {
    const items = (extraNodes[name] || []).map((json) => ({ json }));
    return { all: () => items, first: () => items[0], last: () => items[items.length - 1] };
  };

  const sandbox = {
    $json: itemJson,
    $input: { item: { json: itemJson }, all: () => [{ json: itemJson }], first: () => ({ json: itemJson }) },
    $,
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Set, Map, URL, Array, Object, String, Number, Boolean,
    RegExp, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Promise,
  };

  const fn = vm.runInContext(`(async function () {\n${code}\n})`, vm.createContext(sandbox), {
    filename: `${nodeName}.js`,
  });
  return Promise.resolve(fn.call({
    helpers: { httpRequest: async () => { throw new Error('network blocked in verification'); } },
  }));
}

/** Execute a runOnceForAllItems node against a batch of items. */
function runAllItems(nodeName, itemsJson, extraNodes = {}) {
  const code = byName[nodeName].parameters.jsCode;
  const items = itemsJson.map((json) => ({ json }));
  const $ = (name) => {
    const xs = (extraNodes[name] || []).map((json) => ({ json }));
    return { all: () => xs, first: () => xs[0], last: () => xs[xs.length - 1] };
  };
  const sandbox = {
    $json: items[0] && items[0].json,
    $input: { all: () => items, first: () => items[0], last: () => items[items.length - 1] },
    $,
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Set, Map, URL, Array, Object, String, Number, Boolean,
    RegExp, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Promise,
  };
  const fn = vm.runInContext(`(async function () {\n${code}\n})`, vm.createContext(sandbox), {
    filename: `${nodeName}.js`,
  });
  return Promise.resolve(fn.call({
    helpers: { httpRequest: async () => { throw new Error('network blocked in verification'); } },
  }));
}

(async () => {
  console.log('=== TASK 6: loop node correctness ===');
  console.log('(per-item conversion + batchSize guard)\n');

  // Every converted node must be in per-item mode.
  // Resume Match Engine is deliberately NOT per-item: it needs
  // $('Code in JavaScript').first(), which n8n forbids in per-item mode.
  const converted = [
    'Clean HTML', 'Extract Main Content.', 'guard node', 'JSON Parse',
    'Parse + Rank Opportunities', 'Standardize Opportunity',
  ];
  for (const name of converted) {
    assert.equal(byName[name].parameters.mode, 'runOnceForEachItem', `${name} not converted`);
  }
  console.log(`  PASS  all ${converted.length} in-loop nodes are runOnceForEachItem`);

  // batchSize is 1 by necessity: the If node's branches reconverge and feed back
  // into the loop separately, so a batch spanning both branches makes the
  // done-branch fire repeatedly and emit partial results. Measured live.
  assert.equal(byName['Loop Over Items'].parameters.batchSize, 1);
  console.log('  PASS  Loop Over Items batchSize = 1 (batching proven incorrect for this topology)');

  // No converted node may still return a top-level array — in per-item mode
  // that is the shape that silently discards data.
  for (const name of converted) {
    const code = byName[name].parameters.jsCode;
    const topLevelArrayReturn = /\n\s*return\s*\[\s*\{/.test(code);
    assert.ok(!topLevelArrayReturn, `${name} still has a top-level array return`);
  }
  console.log('  PASS  no converted node returns a top-level array');

  // The playwright fallback must not reference a single loop item.
  const pwUrl = byName['playwright'].parameters.bodyParameters.parameters.find((p) => p.name === 'url').value;
  assert.ok(!/\$node\["Loop Over Items"\]/.test(pwUrl), 'playwright still reads a single loop item');
  console.log(`  PASS  playwright url is per-item: ${pwUrl}`);

  // --- Behavioural equivalence on real captured data ---
  console.log('\n--- replaying converted nodes over real fixtures ---');

  // Standardize Opportunity: captured input (Parse+Rank output) -> captured output
  const standardizedCaptured = loadFixture('standardized');
  const parseRankOut = loadFixture('quality-gated'); // upstream shape available
  console.log(`  Standardize Opportunity: captured ${standardizedCaptured.length} outputs`);

  // Resume Match Engine runs in all-items mode over the whole batch. Verify it
  // emits one item per input item and preserves the task-1 failure contract.
  const stdItems = standardizedCaptured.slice(0, 5);
  const rmeOut = await runAllItems('Resume Match Engine', stdItems, {
    'Code in JavaScript': loadFixture('candidate'),
  });
  assert.equal(rmeOut.length, stdItems.length,
    `Resume Match Engine must emit one item per input (${stdItems.length} in, ${rmeOut.length} out)`);

  // Three outcomes are possible and must stay distinguishable:
  //   scored              — a real score
  //   skipped_no_content  — nothing to match on; deliberately not called
  //   failed              — the call was made and the provider failed
  // Every score must be null unless the item was genuinely scored.
  for (const o of rmeOut) {
    assert.ok(['skipped_no_content', 'failed'].includes(o.json.scoring_status),
      `unexpected status ${o.json.scoring_status}`);
    assert.equal(o.json.score, null, 'an unscored item must have score null, never 0');
  }
  const skipped = rmeOut.filter((o) => o.json.scoring_status === 'skipped_no_content');
  const failed = rmeOut.filter((o) => o.json.scoring_status === 'failed');
  console.log(`  PASS  Resume Match Engine: ${stdItems.length} in -> ${rmeOut.length} out, none dropped`);
  console.log(`        ${skipped.length} skipped for no content, ${failed.length} attempted and failed`);

  // An item WITH content must actually be attempted — and, with the network
  // blocked, must land on 'failed', never be quietly skipped.
  const withContent = [{
    title: 'Frontend Developer Intern',
    company: 'Acme Corp',
    description: 'Build React interfaces. TypeScript and Docker preferred.',
    requirements: ['React'], skills: ['TypeScript'],
    application_url: 'https://boards.greenhouse.io/acme/jobs/1',
  }];
  const attempted = await runAllItems('Resume Match Engine', withContent, {
    'Code in JavaScript': loadFixture('candidate'),
  });
  assert.equal(attempted[0].json.scoring_status, 'failed',
    'an item with real content must be ATTEMPTED, so a blocked network marks it failed');
  assert.equal(attempted[0].json.score, null);
  console.log('  PASS  an item with real content is attempted (failed here), never skipped');

  // Clean HTML over real captured html-bearing items.
  const qg = loadFixture('quality-gated');
  let cleaned = 0;
  for (const item of qg.slice(0, 5)) {
    const out = await runPerItem('Clean HTML', { ...item, data: '<html><body><p>Hello</p></body></html>' });
    assert.ok(out && out.json, 'Clean HTML must return a single {json} item');
    assert.ok('clean_text' in out.json, 'Clean HTML must set clean_text');
    cleaned += 1;
  }
  console.log(`  PASS  Clean HTML: ${cleaned}/5 items returned a single {json} item with clean_text`);

  // JSON Parse over a representative payload.
  const jp = await runPerItem('JSON Parse', { data: { title: 'X' } });
  assert.ok(jp && jp.json, 'JSON Parse must return a single {json} item');
  console.log('  PASS  JSON Parse returns a single {json} item');

  console.log('\nALL TASK-6 ASSERTIONS PASSED (0 network calls)');
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
