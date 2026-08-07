'use strict';

/**
 * analyze-run.js — summarize one live n8n execution.
 *
 * Usage: node tools/analyze-run.js live-runs/<label>
 *
 * Reports item conservation through the loop (the batch-5 correctness check),
 * scoring outcomes, year routing, and the final response.
 */

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/analyze-run.js live-runs/<label>'); process.exit(1); }

function loadRun(file) {
  const txt = fs.readFileSync(file, 'utf8');
  let i = txt.indexOf('{\n  "data"');
  if (i === -1) i = txt.indexOf('{"data"');
  const blob = txt.slice(i);
  try { return JSON.parse(blob); } catch {
    return JSON.parse(blob.slice(0, blob.lastIndexOf('}') + 1));
  }
}

const d = loadRun(path.join(dir, 'execution.json'));
const rd = d.data.resultData.runData;
const err = d.data.resultData.error;

function items(name) {
  const runs = rd[name] || [];
  const out = [];
  for (const r of runs) {
    for (const branch of (r.data && r.data.main) || []) {
      for (const it of branch || []) if (it && it.json !== undefined) out.push(it.json);
    }
  }
  return out;
}

const wall = fs.existsSync(path.join(dir, 'wall_clock_seconds.txt'))
  ? fs.readFileSync(path.join(dir, 'wall_clock_seconds.txt'), 'utf8').trim() : '?';

console.log(`=== ${path.basename(dir)} ===`);
console.log(`status: ${err ? 'ERROR at ' + (err.node && err.node.name) : 'success'}   wall-clock: ${wall}s`);
if (err) console.log(`error: ${err.message} | ${String(err.description).slice(0, 200)}`);

console.log('\n--- node throughput ---');
for (const name of Object.keys(rd)) {
  const n = items(name).length;
  console.log(`  ${name.padEnd(42)} runs=${String((rd[name] || []).length).padStart(3)}  items=${String(n).padStart(4)}`);
}

// ---- Batch correctness: item conservation through the loop ----
const gated = items('Discovery Quality Gate + Dedup');
const scored = items('Resume Match Engine');
const finalized = items('Finalize Results');

console.log('\n--- LOOP ITEM CONSERVATION (batch-5 correctness) ---');
console.log(`  quality-gated (into loop) : ${gated.length}`);
console.log(`  scraped (HTTP Request1)   : ${items('HTTP Request1').length}`);
console.log(`  standardized              : ${items('Standardize Opportunity').length}`);
console.log(`  scored (Resume Match)     : ${scored.length}`);
const conserved = scored.length === gated.length;
console.log(`  => ${conserved ? 'OK  every discovered opportunity survived the loop'
  : `DROPPED ${gated.length - scored.length} of ${gated.length} items`}`);

// ---- Scoring ----
const ok = scored.filter((o) => o.scoring_status === 'scored');
const failed = scored.filter((o) => o.scoring_status === 'failed');
console.log('\n--- SCORING ---');
console.log(`  attempted: ${scored.length}  succeeded: ${ok.length}  failed: ${failed.length}` +
  (scored.length ? `  (${((failed.length / scored.length) * 100).toFixed(1)}% failure)` : ''));
if (failed.length) {
  const codes = {};
  for (const f of failed) codes[f.scoring_error] = (codes[f.scoring_error] || 0) + 1;
  console.log(`  failure codes: ${JSON.stringify(codes)}`);
}
console.log(`  scores: ${JSON.stringify(ok.map((o) => o.score))}`);

// ---- Year routing ----
const plan = items('Build Multi-Source Search Plan');
if (plan.length) {
  const p = plan[0];
  const internQ = plan.filter((q) => /intern/i.test(String(q.query))).length;
  console.log('\n--- YEAR ROUTING ---');
  console.log(`  opportunity_type : ${p.opportunity_type}`);
  console.log(`  source           : ${p.opportunity_type_source}`);
  console.log(`  graduation_year  : ${p.graduation_year}`);
  console.log(`  target_roles     : ${JSON.stringify(p.target_roles)}`);
  console.log(`  queries          : ${plan.length}  (${internQ} mention "intern")`);
  console.log(`  planner          : ${(p.search_metadata || {}).planner || 'n/a'}`);
}

// ---- Final response ----
const resp = items('Build Response');
if (resp.length) {
  const r = resp[0];
  console.log('\n--- FINAL RESPONSE ---');
  console.log(`  status            : ${r.status}`);
  console.log(`  opportunity_count : ${r.opportunity_count}`);
  console.log(`  scoring           : ${JSON.stringify(r.scoring)}`);
  console.log(`  allocation        : ${JSON.stringify(r.allocation)}`);
  if (r.opportunities && r.opportunities.length) {
    console.log('  opportunities:');
    for (const o of r.opportunities) {
      console.log(`    [${o.tier}/${o.allocation_reason}] ${o.score} — ${String(o.title).slice(0, 58)}`);
    }
  }
  if (r.weak_profile) {
    console.log(`  weak_profile.reasons: ${JSON.stringify(r.weak_profile.reasons)}`);
    console.log(`  weak_profile.gaps   : ${JSON.stringify(r.weak_profile.gaps.map((g) => g.skill))}`);
  }
} else {
  const alloc = items('Geographic Allocator');
  if (alloc.length) console.log(`\n--- allocator out: ${alloc.length} items (Build Response did not run) ---`);
}
