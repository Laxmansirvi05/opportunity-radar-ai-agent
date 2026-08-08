'use strict';

/**
 * measure-cost.js — per-run LLM cost and quota, measured from captured runs.
 *
 * Token counts are estimated from the actual payloads the pipeline sent
 * (chars/4), not guessed: the gateway does not record provider token usage, so
 * this reconstructs it from what each node actually transmitted. Marked as an
 * estimate everywhere it is reported.
 *
 *   node tools/measure-cost.js [run-label ...]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHARS_PER_TOKEN = 4;

// Free-tier limits, from the provider error bodies we have actually hit.
const LIMITS = {
  groq:   { tpd: 100_000, tpm: 12_000, label: 'Groq free (llama-3.3-70b)' },
  gemini: { rpd: 20,                    label: 'Gemini free (flash)' },
};

// Published per-million-token pricing for a typical PAID tier. Rates change;
// this is a sizing aid, not a quote.
const PAID = {
  'groq llama-3.3-70b': { in: 0.59, out: 0.79 },
  'gpt-4o-mini':        { in: 0.15, out: 0.60 },
  'gemini flash':       { in: 0.075, out: 0.30 },
};

function loadRun(label) {
  const file = path.join(ROOT, 'live-runs', label, 'execution.json');
  const txt = fs.readFileSync(file, 'utf8');
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
const tokens = (s) => Math.round(String(s || '').length / CHARS_PER_TOKEN);

function measure(label) {
  const rd = loadRun(label);
  const wallFile = path.join(ROOT, 'live-runs', label, 'wall_clock_seconds.txt');
  const wall = fs.existsSync(wallFile) ? Number(fs.readFileSync(wallFile, 'utf8').trim()) : null;

  // 1. Profile build — one call, the resume plus a large system prompt.
  const resume = itemsOf(rd, 'Extract from File')[0] || {};
  const profilePrompt = 12_113; // current prompt length, chars
  const profileIn = tokens(resume.text) + Math.round(profilePrompt / CHARS_PER_TOKEN);
  const profileOut = tokens(JSON.stringify(itemsOf(rd, 'Code in JavaScript')[0] || {}));

  // 2. Extraction — one call per item that passed the guard.
  const extracted = itemsOf(rd, 'HTTP Request2');
  const extractIn = extracted.length * (Math.round(1444 / CHARS_PER_TOKEN) + 4500); // prompt + 18k-char cap
  const extractOut = extracted.reduce((a, o) => a + tokens(JSON.stringify(o)), 0);

  // 3. Scoring — one call per scored item, with the projected payload.
  const scored = itemsOf(rd, 'Resume Match Engine');
  const scoreSystem = Math.round(3887 / CHARS_PER_TOKEN);
  const scoreIn = scored.reduce((a, o) => a + scoreSystem + 350
    + tokens(JSON.stringify({ t: o.title, c: o.company, d: String(o.description || '').slice(0, 4000) })), 0);
  const scoreOut = scored.length * 90;

  const totalIn = profileIn + extractIn + scoreIn;
  const totalOut = profileOut + extractOut + scoreOut;
  const calls = 1 + extracted.length + scored.length;

  return {
    label, wall, calls,
    tavily: itemsOf(rd, 'HTTP Request').length,
    renders: itemsOf(rd, 'playwright').length,
    breakdown: [
      { stage: 'profile build', calls: 1, in: profileIn, out: profileOut },
      { stage: 'extraction', calls: extracted.length, in: extractIn, out: extractOut },
      { stage: 'scoring', calls: scored.length, in: scoreIn, out: scoreOut },
    ],
    totalIn, totalOut, total: totalIn + totalOut,
  };
}

const labels = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(path.join(ROOT, 'live-runs')).filter((d) =>
      fs.existsSync(path.join(ROOT, 'live-runs', d, 'execution.json')));

console.log('=== PER-RUN COST AND QUOTA (token counts are ESTIMATES from actual payloads) ===\n');

const rows = [];
for (const label of labels) {
  let m;
  try { m = measure(label); } catch { continue; }
  if (!m.calls || m.calls < 2) continue;
  rows.push(m);
  console.log(`--- ${label} ---`);
  console.log(`  wall-clock ${m.wall != null ? m.wall + 's' : '?'} | LLM calls ${m.calls} | Tavily searches ${m.tavily} | renders ${m.renders}`);
  for (const b of m.breakdown) {
    const pct = m.total ? Math.round(((b.in + b.out) / m.total) * 100) : 0;
    console.log(`    ${b.stage.padEnd(15)} calls ${String(b.calls).padStart(3)}  in ~${String(b.in).padStart(6)}  out ~${String(b.out).padStart(5)}  (${pct}% of tokens)`);
  }
  console.log(`    TOTAL           in ~${m.totalIn}  out ~${m.totalOut}  =  ~${m.total} tokens\n`);
}

if (!rows.length) { console.log('no usable runs found'); process.exit(0); }

const avg = (f) => Math.round(rows.reduce((a, r) => a + f(r), 0) / rows.length);
const avgTotal = avg((r) => r.total);
const avgCalls = avg((r) => r.calls);
const avgTavily = avg((r) => r.tavily);
const avgWall = avg((r) => r.wall || 0);

console.log('=== AVERAGE PER RUN (one student) ===');
console.log(`  LLM calls        ~${avgCalls}`);
console.log(`  tokens           ~${avgTotal}  (in ~${avg((r) => r.totalIn)}, out ~${avg((r) => r.totalOut)})`);
console.log(`  Tavily searches  ~${avgTavily}`);
console.log(`  wall-clock       ~${avgWall}s`);

console.log('\n=== RUNS PER DAY ===');
console.log(`  Groq free tier   ${LIMITS.groq.tpd.toLocaleString()} tokens/day  ->  ~${Math.floor(LIMITS.groq.tpd / avgTotal)} runs/day`);
console.log(`  Groq TPM ceiling ${LIMITS.groq.tpm.toLocaleString()} tokens/min  ->  ~${Math.floor(LIMITS.groq.tpm / (avgTotal / Math.max(1, avgWall / 60)))} concurrent-ish; in practice this is what forces sequential scoring`);
console.log(`  Gemini free      ${LIMITS.gemini.rpd} requests/day -> ~${Math.floor(LIMITS.gemini.rpd / avgCalls)} runs/day (cannot carry a run alone)`);

console.log('\n=== COST PER STUDENT ON A PAID TIER (sizing aid, not a quote) ===');
for (const [name, p] of Object.entries(PAID)) {
  const cost = (avg((r) => r.totalIn) / 1e6) * p.in + (avg((r) => r.totalOut) / 1e6) * p.out;
  console.log(`  ${name.padEnd(22)} $${cost.toFixed(4)} per student   ($${(cost * 1000).toFixed(2)} per 1,000)`);
}
console.log(`  Tavily                 ~${avgTavily} searches per student — priced separately by plan`);

console.log('\n=== TOP TOKEN CONSUMERS ===');
const byStage = {};
for (const r of rows) for (const b of r.breakdown) byStage[b.stage] = (byStage[b.stage] || 0) + b.in + b.out;
const total = Object.values(byStage).reduce((a, b) => a + b, 0);
for (const [stage, t] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${stage.padEnd(15)} ${Math.round((t / total) * 100)}%`);
}
