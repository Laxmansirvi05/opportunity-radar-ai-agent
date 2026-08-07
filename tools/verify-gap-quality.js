'use strict';

/**
 * verify-gap-quality.js — Phase 2 acceptance check. NOT YET RUN.
 *
 * Scores real captured opportunities against a real candidate through the live
 * ai-gateway and measures whether missing_requirements now contains genuine
 * candidate-side gaps instead of field-name artifacts.
 *
 * THIS SPENDS API QUOTA — one scoring call per opportunity. It is deliberately
 * NOT part of any test suite. Run it only when quota has reset:
 *
 *   node tools/verify-gap-quality.js [limit]
 *
 * Acceptance (stated up front so the result cannot be rationalised afterwards):
 *   - ZERO artifact entries across all responses, and
 *   - at least half the postings that state real requirements yield >=1 gap, and
 *   - the aggregated feedback surfaces >=1 gap appearing in >=2 postings.
 *
 * Anything less means the prompt work did not succeed. Report that plainly
 * rather than loosening the filter downstream — filtering is what produces the
 * zero-gap output we have today.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_KEY = process.env.GATEWAY_API_KEY || '7Kf92LmPqX4zR8NwLs5YbH3cUv9TxQa1';
const URL = 'http://localhost:4000/api/ai/chat';
const LIMIT = Number(process.argv[2] || 20);

// Exactly the artifacts observed in real captured output.
const ARTIFACTS = new Set([
  'job description', 'detailed job description', 'description', 'required skills',
  'requirements', 'location', 'workplace type', 'employment type',
  'employment type details', 'specific company requirements', 'company information',
  'salary', 'compensation', 'deadline', 'not specified', 'unknown', 'n/a', 'none',
  'experience', 'skills', 'technical skills', 'qualifications',
]);

const MAX_DESCRIPTION_CHARS = 4000;
function toScoringPayload(opp) {
  const trim = (v) => (typeof v === 'string' ? v.slice(0, MAX_DESCRIPTION_CHARS) : v ?? null);
  const list = (v) => (Array.isArray(v) ? v.slice(0, 25) : []);
  return {
    title: opp.title ?? null, company: opp.company ?? null,
    description: trim(opp.description), requirements: list(opp.requirements),
    skills: list(opp.skills), location: opp.location ?? null,
    work_mode: opp.work_mode ?? null, employment_type: opp.employment_type ?? null,
    is_paid: opp.is_paid ?? null, salary: opp.salary ?? null,
  };
}

function loadRun(label) {
  const txt = fs.readFileSync(path.join(ROOT, 'live-runs', label, 'execution.json'), 'utf8');
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const d = loadRun('runD-final');
  const rd = d.data.resultData.runData;
  const opportunities = itemsOf(rd, 'Standardize Opportunity').slice(0, LIMIT);
  const candidate = itemsOf(rd, 'Code in JavaScript')[0].candidate;

  console.log(`=== Phase 2 gap quality — ${opportunities.length} real opportunities ===`);
  console.log('(this spends one scoring call per opportunity)\n');

  const allGaps = [];
  let artifactCount = 0;
  let withRequirements = 0;
  let yieldedGap = 0;
  let failures = 0;

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const statesRequirements =
      (Array.isArray(opp.requirements) && opp.requirements.length > 0) ||
      (typeof opp.description === 'string' && opp.description.length > 200);
    if (statesRequirements) withRequirements += 1;

    let body;
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
        body: JSON.stringify({ task: 'score_fit', input: { candidate, opportunity: toScoringPayload(opp) } }),
      });
      body = await res.json();
      if (!res.ok || body.success !== true) { failures += 1; process.stdout.write('x'); await sleep(1500); continue; }
    } catch { failures += 1; process.stdout.write('x'); await sleep(1500); continue; }

    const gaps = body.data.missing_requirements || [];
    const arts = gaps.filter((g) => ARTIFACTS.has(String(g).trim().toLowerCase()));
    artifactCount += arts.length;
    if (statesRequirements && gaps.length > 0) yieldedGap += 1;
    allGaps.push({ title: String(opp.title || '').slice(0, 40), gaps, artifacts: arts });
    process.stdout.write(arts.length ? 'A' : '.');
    await sleep(1500);
  }

  console.log('\n');
  for (const g of allGaps) {
    console.log(`  ${g.artifacts.length ? 'ARTIFACT' : 'ok      '} ${g.title.padEnd(42)} ${JSON.stringify(g.gaps)}`);
  }

  const counts = new Map();
  for (const g of allGaps) {
    for (const raw of new Set(g.gaps.map((x) => String(x).trim().toLowerCase()))) {
      if (ARTIFACTS.has(raw)) continue;
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
  }
  const repeated = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

  console.log('\n=== RESULT ===');
  console.log(`  scoring failures        : ${failures}`);
  console.log(`  artifact entries        : ${artifactCount}          (acceptance: 0)`);
  console.log(`  postings with real reqs : ${withRequirements}`);
  console.log(`  of those, yielded a gap : ${yieldedGap}  (acceptance: >= ${Math.ceil(withRequirements / 2)})`);
  console.log(`  gaps appearing in >=2   : ${repeated.length}  (acceptance: >= 1)`);
  if (repeated.length) {
    console.log('\n  aggregated feedback this would produce:');
    for (const [skill, n] of repeated.slice(0, 5)) {
      console.log(`    "${n} of ${allGaps.length} internships wanted ${skill}, which your resume doesn't show."`);
    }
  }

  const pass = artifactCount === 0 && yieldedGap >= Math.ceil(withRequirements / 2) && repeated.length >= 1;
  console.log(`\n  ${pass ? 'PASS — Phase 2 verified' : 'FAIL — Phase 2 remains UNVERIFIED; do not paper over with filtering'}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('harness failed:', e.message); process.exit(1); });
