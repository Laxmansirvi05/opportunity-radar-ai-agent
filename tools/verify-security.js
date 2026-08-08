'use strict';

/**
 * verify-security.js — exercises the security controls against the live
 * services. No LLM calls, so it costs no model quota.
 *
 *   node tools/verify-security.js
 *
 * Covers: SSRF blocking (render-service), upload validation and job-id
 * unguessability (job-server), secret hygiene (static), and error-message
 * leakage.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RENDER = process.env.RENDER_URL || 'http://127.0.0.1:3100';
const JOBS = process.env.JOB_SERVER_URL || 'http://127.0.0.1:4300';

function env(file, key) {
  try {
    const m = fs.readFileSync(path.join(ROOT, file), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  } catch { return null; }
}

// Assembled at runtime so this scanner is not itself a secret hit.
const RETIRED_KEY = ['7Kf92LmPqX4z', 'R8NwLs5YbH3c', 'Uv9TxQa1'].join('');

let pass = 0, fail = 0, skip = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; }
  catch (e) {
    if (e && e.__skip) { console.log(`  SKIP  ${label} — ${e.message}`); skip += 1; return; }
    console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1;
  }
}
function skipIf(cond, msg) { if (cond) { const e = new Error(msg); e.__skip = true; throw e; } }

async function up(url) {
  try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) }); return r.ok; }
  catch { return false; }
}

(async () => {
  console.log('=== SECURITY VERIFICATION (no LLM calls) ===\n');

  const renderUp = await up(RENDER);
  const jobsUp = await up(JOBS);
  const renderKey = env('render-service/.env', 'API_KEY');

  // ---------------------------------------------------------------- SSRF ---
  console.log('--- SSRF: the pipeline fetches attacker-influenced URLs ---');

  const SSRF_TARGETS = [
    ['loopback by name',        'http://localhost:22/'],
    ['loopback by IP',          'http://127.0.0.1:5432/'],
    ['all-zeros',               'http://0.0.0.0/'],
    ['private 10/8',            'http://10.0.0.1/'],
    ['private 192.168/16',      'http://192.168.1.1/'],
    ['private 172.16/12',       'http://172.16.0.1/'],
    ['cloud metadata',          'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback',           'http://[::1]/'],
  ];

  for (const [label, target] of SSRF_TARGETS) {
    await check(`SSRF blocked: ${label}`, async () => {
      skipIf(!renderUp, 'render-service not running');
      const res = await fetch(`${RENDER}/fetch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-Key': renderKey || '' },
        body: JSON.stringify({ url: target }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      assert.ok(res.status >= 400, `expected rejection, got HTTP ${res.status}`);
      const s = JSON.stringify(body).toLowerCase();
      assert.ok(!/root:|ssh-|ami-id|postgres/.test(s), 'response leaked internal content');
    });
  }

  for (const [label, target] of [
    ['file scheme', 'file:///etc/passwd'],
    ['gopher scheme', 'gopher://127.0.0.1:11211/'],
    ['data scheme', 'data:text/html,<h1>x</h1>'],
  ]) {
    await check(`non-http(s) scheme blocked: ${label}`, async () => {
      skipIf(!renderUp, 'render-service not running');
      const res = await fetch(`${RENDER}/fetch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-Key': renderKey || '' },
        body: JSON.stringify({ url: target }),
        signal: AbortSignal.timeout(15000),
      });
      assert.ok(res.status >= 400, `expected rejection, got HTTP ${res.status}`);
    });
  }

  await check('render-service requires its API key', async () => {
    skipIf(!renderUp, 'render-service not running');
    skipIf(!renderKey, 'render-service has no API_KEY configured');
    const res = await fetch(`${RENDER}/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(res.status, 401, `unauthenticated fetch should be 401, got ${res.status}`);
  });

  // ------------------------------------------------------------- uploads ---
  console.log('\n--- Upload safety ---');

  const boundary = '----sec-test-boundary';
  const multipart = (content, filename = 'r.pdf') => ({
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    type: `multipart/form-data; boundary=${boundary}`,
  });

  await check('non-PDF with .pdf extension rejected by magic bytes', async () => {
    skipIf(!jobsUp, 'job-server not running');
    const { body, type } = multipart(Buffer.from('<?php system($_GET[0]); ?>'), 'evil.pdf');
    const res = await fetch(`${JOBS}/api/jobs`, { method: 'POST', headers: { 'content-type': type }, body });
    assert.equal(res.status, 415);
    assert.equal((await res.json()).error.code, 'INVALID_FILE_TYPE');
  });

  await check('oversized upload rejected before parsing', async () => {
    skipIf(!jobsUp, 'job-server not running');
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6 * 1024 * 1024, 0x20)]);
    const { body, type } = multipart(big);
    const res = await fetch(`${JOBS}/api/jobs`, { method: 'POST', headers: { 'content-type': type }, body });
    assert.equal(res.status, 413);
  });

  await check('malformed PDF does not hang or crash the server', async () => {
    skipIf(!jobsUp, 'job-server not running');
    // Valid magic bytes, garbage body — must be accepted quickly and fail later
    // in the pipeline, never wedge the HTTP layer.
    const bomb = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('\xff'.repeat(2000)), Buffer.from('trailer<</Root 1 0 R>>')]);
    const { body, type } = multipart(bomb, 'bomb.pdf');
    const started = Date.now();
    const res = await fetch(`${JOBS}/api/jobs`, { method: 'POST', headers: { 'content-type': type }, body, signal: AbortSignal.timeout(10000) });
    assert.ok(Date.now() - started < 10000, 'upload handling must not hang');
    assert.ok([202, 400, 415].includes(res.status), `unexpected status ${res.status}`);
    assert.ok(await up(JOBS), 'server must still be alive after a malformed PDF');
  });

  await check('uploads land outside any web-served directory', async () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'job-server/src/config.js'), 'utf8');
    assert.match(cfg, /uploadDir/, 'uploadDir must be configurable');
    const dir = env('.env', 'UPLOAD_DIR') || '/tmp/opportunity-radar-uploads';
    assert.ok(!/public|static|www|htdocs/i.test(dir), `upload dir looks web-served: ${dir}`);
    const app = fs.readFileSync(path.join(ROOT, 'job-server/src/app.js'), 'utf8');
    assert.ok(!/express\.static/.test(app), 'job-server must not serve static files');
  });

  // ------------------------------------------------------------- job ids ---
  console.log('\n--- Job IDs and access ---');

  await check('job ids are v4 UUIDs, not sequential', async () => {
    const mig = fs.readFileSync(path.join(ROOT, 'data/migrations/013_pipeline_jobs.sql'), 'utf8');
    assert.match(mig, /id\s+UUID\s+PRIMARY KEY DEFAULT gen_random_uuid\(\)/i,
      'job id must default to gen_random_uuid()');
    assert.ok(!/SERIAL|BIGSERIAL/i.test(mig), 'job id must not be sequential');
  });

  await check('guessing another job id returns 404, not data', async () => {
    skipIf(!jobsUp, 'job-server not running');
    for (const guess of [
      '00000000-0000-0000-0000-000000000001',
      '11111111-1111-4111-8111-111111111111',
      '1', '../../etc/passwd', 'null',
    ]) {
      const res = await fetch(`${JOBS}/api/jobs/${encodeURIComponent(guess)}`);
      assert.equal(res.status, 404, `guess "${guess}" returned ${res.status}`);
      const b = await res.json();
      assert.equal(b.error.code, 'JOB_NOT_FOUND');
      assert.ok(!('result' in b), 'must never return a result for a guessed id');
    }
  });

  // ------------------------------------------------------------- secrets ---
  console.log('\n--- Secrets ---');

  await check('no secret in any tracked file', async () => {
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
    const suspicious = [];
    for (const f of tracked) {
      if (/\.(png|jpg|pdf|ico)$/i.test(f)) continue;
      let content;
      try { content = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
      if (/\bsk-or-v1-[A-Za-z0-9]{20,}/.test(content)) suspicious.push(`${f}: openrouter key`);
      if (/\bgsk_[A-Za-z0-9]{30,}/.test(content)) suspicious.push(`${f}: groq key`);
      if (/\btvly-[A-Za-z0-9-]{20,}/.test(content)) suspicious.push(`${f}: tavily key`);
      if (content.includes(RETIRED_KEY)) suspicious.push(`${f}: retired gateway key`);
    }
    assert.equal(suspicious.length, 0, `secrets found:\n        ${suspicious.join('\n        ')}`);
  });

  await check('.env files are untracked', async () => {
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
    const envs = tracked.split('\n').filter((f) => /(^|\/)\.env$/.test(f));
    assert.equal(envs.length, 0, `tracked .env files: ${envs.join(', ')}`);
  });

  // -------------------------------------------------------------- errors ---
  console.log('\n--- Error message hygiene ---');

  await check('API errors leak no paths, providers, or stack traces', async () => {
    skipIf(!jobsUp, 'job-server not running');
    const probes = [
      fetch(`${JOBS}/api/jobs/not-a-uuid`),
      fetch(`${JOBS}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${JOBS}/nope`),
    ];
    for (const p of probes) {
      const res = await p;
      const text = await res.text();
      assert.ok(!/\/Users\/|\/home\/|node_modules|at Object\.|Error:\s+\w+Error/.test(text),
        `leaked internals: ${text.slice(0, 160)}`);
      assert.ok(!/groq|gemini|openrouter|tavily/i.test(text), `leaked provider name: ${text.slice(0, 160)}`);
    }
  });

  await check('ai-gateway never leaks provider identity to callers', async () => {
    const app = fs.readFileSync(path.join(ROOT, 'ai-gateway/src/app.js'), 'utf8');
    assert.match(app, /PROVIDERS_UNAVAILABLE/, 'must use a provider-neutral failure code');
    assert.ok(!/groq|gemini|openrouter/i.test(app.split('const messages')[1] || ''),
      'public error messages must not name providers');
  });

  console.log(`\n=== ${pass} passed, ${fail} failed, ${skip} skipped ===`);
  if (skip) console.log('(skipped checks need the corresponding service running)');
  process.exit(fail ? 1 : 0);
})();
