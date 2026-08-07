'use strict';

/**
 * verify-gate-specificity.js — measures the quality gate's preference for
 * specific postings over search/listing pages, replayed against the normalized
 * discoveries captured from real runs. Zero API calls.
 *
 * Context: enforcing product rule 5 dropped real runs to 1-4 usable results.
 * The cause was NOT discovery breadth — runs already discover ~160 specific
 * postings — it was the gate spending its limited admission slots on listing
 * pages and discarding the specific ones.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { runNode } = require('./replay');

const ROOT = path.resolve(__dirname, '..');

const LISTING = /\/q-|\/jobs?\/[a-z0-9-]*(jobs|internships)\b|\/browse\b|[?&](q|query|keywords|search)=|naukri\.com\/[a-z-]+-jobs|internshala\.com\/internships\/?$|\/search\b/i;

function loadRun(label) {
  const txt = fs.readFileSync(path.join(ROOT, 'live-runs', label, 'execution.json'), 'utf8');
  let i = txt.indexOf('{\n  "data"');
  if (i === -1) i = txt.indexOf('{"data"');
  const blob = txt.slice(i);
  try { return JSON.parse(blob).data.resultData.runData; } catch {
    return JSON.parse(blob.slice(0, blob.lastIndexOf('}') + 1)).data.resultData.runData;
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
const urlOf = (o) => o.canonical_url || o.url || '';
const isSpecific = (o) => Boolean(urlOf(o)) && !LISTING.test(urlOf(o));

(async () => {
  const runs = ['runD-final', 'p1-student1-verify', 'p1-student3-noncs', 'p1-student2'];
  console.log('=== quality gate: specific postings vs listing pages (0 API calls) ===\n');

  let totalListingAdmitted = 0;
  const rows = [];

  for (const label of runs) {
    let rd;
    try { rd = loadRun(label); } catch { continue; }
    const normalized = itemsOf(rd, 'Normalize + Classify Discovery Results');
    if (!normalized.length) continue;

    const availableSpecific = normalized.filter(isSpecific).length;
    const admitted = await runNode('Discovery Quality Gate + Dedup', { input: normalized, nodes: {} });
    const admittedSpecific = admitted.filter(isSpecific).length;
    const admittedListing = admitted.length - admittedSpecific;
    totalListingAdmitted += admittedListing;

    const broadening = admitted[0] && admitted[0].discovery_broadening;
    rows.push({ label, normalized: normalized.length, availableSpecific, admitted: admitted.length, admittedSpecific, admittedListing, broadening });
    console.log(`--- ${label} ---`);
    console.log(`  normalized ${normalized.length}, of which specific postings: ${availableSpecific}`);
    console.log(`  gate admitted ${admitted.length}  ->  specific ${admittedSpecific} | listing ${admittedListing}`);
    console.log(`  broadening: applied=${broadening.applied} primary=${broadening.primary_admitted} +${broadening.broadened_admitted}`);
  }

  console.log('\n=== ASSERTIONS ===');
  assert.equal(totalListingAdmitted, 0,
    `the gate must not admit search/listing pages, but admitted ${totalListingAdmitted}`);
  console.log('  PASS  no search/listing page is admitted by the gate on any captured run');

  for (const r of rows) {
    assert.ok(r.admittedSpecific > 0, `${r.label}: gate admitted no specific postings`);
  }
  console.log('  PASS  every run still admits specific postings');

  // Broadening must be CONDITIONAL: it fires when the strict pass is thin, and
  // must not fire when it is healthy (otherwise every run pays the extra cost).
  for (const r of rows) {
    const b = r.broadening;
    assert.ok(b, `${r.label}: broadening decision must be reported downstream`);
    if (b.primary_admitted < b.threshold) {
      assert.equal(b.applied, true,
        `${r.label}: primary ${b.primary_admitted} < ${b.threshold} must trigger broadening`);
      assert.ok(b.broadened_admitted > 0,
        `${r.label}: broadening fired but admitted nothing extra`);
      assert.ok(r.admitted > b.primary_admitted,
        `${r.label}: broadening must increase the admitted set`);
    } else {
      assert.equal(b.applied, false,
        `${r.label}: a healthy primary pass (${b.primary_admitted}) must not broaden`);
    }
  }
  const fired = rows.filter((r) => r.broadening.applied);
  const skipped = rows.filter((r) => !r.broadening.applied);
  assert.ok(fired.length > 0 && skipped.length > 0,
    'the captured runs must exercise both the broadened and non-broadened paths');
  console.log(`  PASS  broadening is conditional: fired on ${fired.length} thin run(s), skipped on ${skipped.length} healthy run(s)`);
  for (const r of fired) {
    console.log(`        ${r.label}: ${r.broadening.primary_admitted} -> ${r.admitted} admitted`);
  }

  console.log('\n  admitted specific postings per run: ' +
    rows.map((r) => `${r.label.replace(/^p1-/, '')}=${r.admittedSpecific}`).join(', '));
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
