'use strict';

/**
 * verify-scoring-payload.js — proves the compact scoring payload fixes the live
 * failure rate, using the REAL oversized opportunities captured from run5.
 *
 * Sends each captured opportunity to ai-gateway twice: once whole (as the
 * pipeline used to), once projected (as the fixed node now does), and reports
 * the failure rate for each. Tavily is not involved.
 *
 * Usage: node tools/verify-scoring-payload.js live-runs/<label>
 */

const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'live-runs/run5-batch5-seq';
const API_KEY = '7Kf92LmPqX4zR8NwLs5YbH3cUv9TxQa1';
const URL = 'http://localhost:4000/api/ai/chat';

const MAX_DESCRIPTION_CHARS = 4000;
const MAX_LIST_ITEMS = 25;

function toScoringPayload(opp) {
  const trim = (v) => (typeof v === 'string' ? v.slice(0, MAX_DESCRIPTION_CHARS) : v ?? null);
  const list = (v) => (Array.isArray(v) ? v.slice(0, MAX_LIST_ITEMS) : []);
  return {
    title: opp.title ?? null,
    company: opp.company ?? null,
    description: trim(opp.description),
    requirements: list(opp.requirements),
    skills: list(opp.skills),
    location: opp.location ?? null,
    work_mode: opp.work_mode ?? null,
    employment_type: opp.employment_type ?? null,
    is_paid: opp.is_paid ?? null,
    salary: opp.salary ?? null,
  };
}

function loadRun(file) {
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

async function score(candidate, opportunity) {
  const started = Date.now();
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({ task: 'score_fit', input: { candidate, opportunity } }),
    });
    const body = await res.json();
    return {
      ok: res.ok && body.success === true,
      code: body?.error?.code,
      score: body?.data?.fit_score,
      ms: Date.now() - started,
    };
  } catch (e) {
    return { ok: false, code: 'NETWORK', ms: Date.now() - started };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const d = loadRun(path.join(dir, 'execution.json'));
  const rd = d.data.resultData.runData;
  const opportunities = itemsOf(rd, 'Standardize Opportunity');
  const candidate = itemsOf(rd, 'Code in JavaScript')[0].candidate;

  console.log(`=== scoring payload comparison (${opportunities.length} real opportunities from ${path.basename(dir)}) ===`);
  const wholeSizes = opportunities.map((o) => JSON.stringify(o).length);
  const projSizes = opportunities.map((o) => JSON.stringify(toScoringPayload(o)).length);
  console.log(`  whole payload chars     : min ${Math.min(...wholeSizes)}  max ${Math.max(...wholeSizes)}`);
  console.log(`  projected payload chars : min ${Math.min(...projSizes)}  max ${Math.max(...projSizes)}`);

  for (const [label, project] of [['WHOLE (old behaviour)', false], ['PROJECTED (fixed)', true]]) {
    let ok = 0; const codes = {};
    console.log(`\n--- ${label} ---`);
    for (let i = 0; i < opportunities.length; i++) {
      const payload = project ? toScoringPayload(opportunities[i]) : opportunities[i];
      const r = await score(candidate, payload);
      if (r.ok) ok += 1; else codes[r.code] = (codes[r.code] || 0) + 1;
      process.stdout.write(r.ok ? '.' : 'x');
      await sleep(1500);
    }
    const failed = opportunities.length - ok;
    console.log(`\n  succeeded ${ok}/${opportunities.length}  failed ${failed}  (${((failed / opportunities.length) * 100).toFixed(1)}% failure)`);
    if (failed) console.log(`  codes: ${JSON.stringify(codes)}`);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
