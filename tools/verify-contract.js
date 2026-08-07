'use strict';

/**
 * verify-contract.js — replays Finalize -> Allocator -> Build Response against
 * the SCORED items captured from real live runs, so the contract shape and the
 * product-rule-5 filter are verified with zero API calls.
 *
 * Usage: node tools/verify-contract.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { runNode } = require('./replay');

const ROOT = path.resolve(__dirname, '..');

function loadRun(label) {
  const file = path.join(ROOT, 'live-runs', label, 'execution.json');
  const txt = fs.readFileSync(file, 'utf8');
  let i = txt.indexOf('{\n  "data"');
  if (i === -1) i = txt.indexOf('{"data"');
  const blob = txt.slice(i);
  try { return JSON.parse(blob); } catch {
    return JSON.parse(blob.slice(0, blob.lastIndexOf('}') + 1));
  }
}

function itemsOf(rd, name) {
  const out = [];
  for (const r of rd[name] || []) {
    for (const b of (r.data && r.data.main) || []) {
      for (const it of b || []) if (it && it.json !== undefined) out.push(it.json);
    }
  }
  return out;
}

const CONTRACT_KEYS = [
  'title', 'company', 'description', 'location', 'apply_url', 'employment_type',
  'work_mode', 'salary', 'is_paid', 'deadline', 'requirements', 'skills',
  'score', 'reasoning', 'missing_requirements', 'tier', 'allocation_reason',
];
const VALID_TIERS = new Set(['same_state', 'same_country', 'international', 'unresolved_location']);
const AGG = /\/q-|\/jobs?\/[a-z-]*(jobs|internships)|linkedin\.com\/jobs\/[a-z]|indeed\.com\/q-|\/browse|search\?|naukri\.com\/[a-z-]+-jobs/i;
const LISTING = /^\s*[\d,]+\+?\s|jobs and vacan|vacancies in|find \d+|\d+\s+internships?\b/i;

(async () => {
  const runs = ['runD-final', 'p1-student1-verify', 'p1-student2', 'p1-student1-batch1', 'p1-student3-noncs'];
  console.log('=== CONTRACT VERIFICATION against captured live runs (0 API calls) ===\n');

  let anyOpportunity = null;
  let anyWeak = null;

  for (const label of runs) {
    let d;
    try { d = loadRun(label); } catch { console.log(`  (skip ${label})`); continue; }
    const rd = d.data.resultData.runData;
    const scored = itemsOf(rd, 'Resume Match Engine');
    const candidate = itemsOf(rd, 'Code in JavaScript');
    if (!scored.length || !candidate.length) { console.log(`  (skip ${label}: no scored items)`); continue; }

    const finalized = await runNode('Finalize Results', {
      input: scored, nodes: { 'Code in JavaScript': candidate },
    });
    const allocated = await runNode('Geographic Allocator', {
      input: finalized, nodes: { 'Code in JavaScript': candidate },
    });
    const resp = (await runNode('Build Response', {
      input: allocated,
      nodes: { 'Code in JavaScript': candidate, 'Finalize Results': finalized },
    }))[0];

    const a = resp.allocation;
    console.log(`--- ${label} ---`);
    console.log(`  scored ${a.scored_candidates} -> below_floor ${a.below_score_floor}, ` +
      `no_apply_url ${a.excluded_no_apply_url}, aggregator ${a.excluded_aggregator_page} ` +
      `=> returned ${resp.opportunity_count} (${resp.status})`);

    // --- contract assertions ---
    for (const o of resp.opportunities) {
      assert.deepEqual(Object.keys(o).sort(), [...CONTRACT_KEYS].sort(),
        `${label}: opportunity keys deviate from the contract`);
      assert.ok(o.apply_url, `${label}: every returned opportunity must have an apply_url`);
      assert.ok(!AGG.test(o.apply_url), `${label}: aggregator URL leaked: ${o.apply_url}`);
      assert.ok(!LISTING.test(String(o.title || '')), `${label}: listing-page title leaked: ${o.title}`);
      assert.ok(VALID_TIERS.has(o.tier), `${label}: invalid tier ${o.tier}`);
      assert.ok(['quota', 'widened'].includes(o.allocation_reason), `${label}: bad allocation_reason`);
      assert.equal(typeof o.score, 'number', `${label}: score must be a number`);
      assert.ok(o.score >= a.min_score, `${label}: score below floor leaked`);
      // No internal bookkeeping may leak.
      for (const banned of ['allocation_summary', 'scoring_summary', 'quota_status', 'pipeline', 'schema_version', 'scoring_status']) {
        assert.ok(!(banned in o), `${label}: internal field "${banned}" leaked into the contract`);
      }
    }
    if (resp.opportunities.length && !anyOpportunity) anyOpportunity = { label, resp };
    if (resp.status === 'weak_profile' && !anyWeak) anyWeak = { label, resp };
  }

  console.log('\n  PASS  every returned opportunity has a real apply_url');
  console.log('  PASS  no aggregator/listing pages returned');
  console.log('  PASS  tier is geographic only — "backfilled" never emitted (F6 resolved)');
  console.log('  PASS  no internal bookkeeping leaks into the response');
  console.log('  PASS  opportunity keys match the locked contract exactly');

  // Emit real examples for API_CONTRACT.md
  if (anyOpportunity) {
    fs.writeFileSync(path.join(ROOT, 'tools', '.contract-example-ok.json'),
      JSON.stringify(anyOpportunity.resp, null, 2));
    console.log(`\n  success example written from ${anyOpportunity.label}`);
  }
  if (anyWeak) {
    fs.writeFileSync(path.join(ROOT, 'tools', '.contract-example-weak.json'),
      JSON.stringify(anyWeak.resp, null, 2));
    console.log(`  weak example written from ${anyWeak.label}`);
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
