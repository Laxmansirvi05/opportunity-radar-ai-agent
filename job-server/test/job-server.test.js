'use strict';

/**
 * job-server.test.js — the whole job server against a stubbed pipeline.
 *
 * Every case here runs with ZERO API calls: the pipeline is replaced by a stub
 * that replays a captured response from a real run.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../src/app');
const { createMemoryRepository } = require('../src/job-repository');
const { JobWorker } = require('../src/worker');
const { createStubRunner } = require('../src/pipeline-runner');

const CAPTURED = path.resolve(__dirname, '..', '..', 'tools', '.contract-example-ok.json');
const capturedResponse = JSON.parse(fs.readFileSync(CAPTURED, 'utf8'));

const silent = { info() {}, warn() {}, error() {} };

function testConfig(overrides = {}) {
  return {
    port: 0,
    enableCors: false,
    corsOrigin: '',
    maxUploadBytes: 5 * 1024 * 1024,
    stuckAfterMs: 30 * 60 * 1000,
    sweepIntervalMs: 60 * 1000,
    uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'js-test-')),
    ...overrides,
  };
}

/** Boot the app on an ephemeral port and return helpers. */
async function boot({ runner, config = testConfig(), autoRun = true } = {}) {
  const repository = createMemoryRepository();
  const worker = new JobWorker({
    repository,
    runPipeline: runner || createStubRunner({ response: capturedResponse }),
    config,
    logger: silent,
  });
  const app = createApp({
    repository, config, logger: silent,
    onSubmit: autoRun ? () => worker.tick() : undefined,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, repository, worker,
    close: () => new Promise((r) => server.close(r)),
  };
}

function pdfBuffer(sizeBytes = 512) {
  const head = Buffer.from('%PDF-1.4\n%test\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, sizeBytes - head.length), 0x20)]);
}

function multipart(content, filename = 'resume.pdf', field = 'resume') {
  const boundary = '----testboundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: application/pdf\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, content, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function submit(base, content, filename) {
  const { body, contentType } = multipart(content, filename);
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST', headers: { 'content-type': contentType }, body,
  });
  return { res, json: await res.json() };
}

async function pollUntil(base, jobId, predicate, { tries = 60, waitMs = 25 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    const body = await res.json();
    if (predicate(body)) return body;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error('poll timed out');
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('POST /api/jobs accepts a PDF and returns a job_id immediately', async () => {
  const ctx = await boot();
  try {
    const { res, json } = await submit(ctx.base, pdfBuffer());
    assert.equal(res.status, 202);
    assert.equal(json.status, 'processing');
    assert.match(json.job_id, /^[0-9a-f-]{36}$/i);
  } finally { await ctx.close(); }
});

test('GET /api/jobs/:id polls to complete and returns the contract payload', async () => {
  const ctx = await boot();
  try {
    const { json } = await submit(ctx.base, pdfBuffer());
    const done = await pollUntil(ctx.base, json.job_id, (b) => b.status === 'complete');
    assert.equal(done.status, 'complete');
    assert.ok(done.result, 'result must be present when complete');
    // Matches API_CONTRACT.md section 1.
    assert.ok(['ok', 'weak_profile'].includes(done.result.status));
    assert.equal(typeof done.result.opportunity_count, 'number');
    assert.ok(Array.isArray(done.result.opportunities));
    assert.ok(done.result.scoring && done.result.allocation);
    assert.ok(done.completed_at);
  } finally { await ctx.close(); }
});

test('a job is "processing" before it finishes', async () => {
  const ctx = await boot({
    runner: createStubRunner({ response: capturedResponse, delayMs: 300 }),
  });
  try {
    const { json } = await submit(ctx.base, pdfBuffer());
    const immediate = await (await fetch(`${ctx.base}/api/jobs/${json.job_id}`)).json();
    assert.equal(immediate.status, 'processing');
    assert.ok(!('result' in immediate), 'no result while processing');
    await pollUntil(ctx.base, json.job_id, (b) => b.status === 'complete');
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// Upload edge cases
// ---------------------------------------------------------------------------

test('oversized file is rejected with FILE_TOO_LARGE', async () => {
  const ctx = await boot({ config: testConfig({ maxUploadBytes: 2048 }) });
  try {
    const { res, json } = await submit(ctx.base, pdfBuffer(8192));
    assert.equal(res.status, 413);
    assert.equal(json.error.code, 'FILE_TOO_LARGE');
  } finally { await ctx.close(); }
});

test('wrong file type is rejected by magic bytes, not by extension', async () => {
  const ctx = await boot();
  try {
    // Named .pdf but is not a PDF — the exact edge case in the brief.
    const { res, json } = await submit(ctx.base, Buffer.from('this is plain text, not a pdf'), 'resume.pdf');
    assert.equal(res.status, 415);
    assert.equal(json.error.code, 'INVALID_FILE_TYPE');
  } finally { await ctx.close(); }
});

test('missing file is rejected with MISSING_FILE', async () => {
  const ctx = await boot();
  try {
    const boundary = '----testboundary1234567890';
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="notafile"\r\n\r\nx\r\n--${boundary}--\r\n`);
    const res = await fetch(`${ctx.base}/api/jobs`, {
      method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body,
    });
    const json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, 'MISSING_FILE');
  } finally { await ctx.close(); }
});

test('non-multipart POST is rejected', async () => {
  const ctx = await boot();
  try {
    const res = await fetch(`${ctx.base}/api/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'MISSING_FILE');
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// Lookup edge cases
// ---------------------------------------------------------------------------

test('unknown job_id returns JOB_NOT_FOUND', async () => {
  const ctx = await boot();
  try {
    const res = await fetch(`${ctx.base}/api/jobs/11111111-2222-4333-8444-555555555555`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'JOB_NOT_FOUND');
  } finally { await ctx.close(); }
});

test('malformed job_id returns JOB_NOT_FOUND rather than 500', async () => {
  const ctx = await boot();
  try {
    const res = await fetch(`${ctx.base}/api/jobs/not-a-uuid`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'JOB_NOT_FOUND');
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

test('two concurrent submissions both get ids; only one runs at a time', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const runner = async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 150));
    concurrent -= 1;
    return capturedResponse;
  };
  const ctx = await boot({ runner });
  try {
    const [a, b] = await Promise.all([
      submit(ctx.base, pdfBuffer()),
      submit(ctx.base, pdfBuffer()),
    ]);
    assert.equal(a.res.status, 202);
    assert.equal(b.res.status, 202);
    assert.notEqual(a.json.job_id, b.json.job_id);

    // Drive the worker until both finish.
    for (let i = 0; i < 60 && (await ctx.repository.runningCount()) >= 0; i++) {
      await ctx.worker.tick();
      const jobs = ctx.repository._all();
      if (jobs.every((j) => j.status === 'complete')) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const jobs = ctx.repository._all();
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.status === 'complete'), 'both jobs must complete');
    assert.equal(maxConcurrent, 1, 'concurrency limit of 1 must hold');
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test('pipeline crash mid-run marks the job failed with PIPELINE_FAILED', async () => {
  const ctx = await boot({
    runner: createStubRunner({ throws: new Error('render-service refused the connection') }),
  });
  try {
    const { json } = await submit(ctx.base, pdfBuffer());
    const done = await pollUntil(ctx.base, json.job_id, (b) => b.status === 'failed');
    assert.equal(done.status, 'failed');
    assert.equal(done.error.code, 'PIPELINE_FAILED');
    assert.match(done.error.message, /render-service/);
    assert.ok(!('result' in done), 'a failed job must not carry a result');
  } finally { await ctx.close(); }
});

test('stuck job is swept to failed with PIPELINE_TIMEOUT', async () => {
  const config = testConfig({ stuckAfterMs: 50 });
  const ctx = await boot({
    config,
    // Never resolves: the job stays 'running' until swept.
    runner: () => new Promise(() => {}),
  });
  try {
    const { json } = await submit(ctx.base, pdfBuffer());
    await new Promise((r) => setTimeout(r, 120));
    const swept = await ctx.worker.sweep();
    assert.equal(swept.length, 1, 'the stuck job must be swept');

    const body = await (await fetch(`${ctx.base}/api/jobs/${json.job_id}`)).json();
    assert.equal(body.status, 'failed');
    assert.equal(body.error.code, 'PIPELINE_TIMEOUT');
  } finally { await ctx.close(); }
});

test('sweep runs on an interval, not only at startup', async () => {
  const config = testConfig({ stuckAfterMs: 40, sweepIntervalMs: 50 });
  const ctx = await boot({ config, runner: () => new Promise(() => {}), autoRun: false });
  try {
    const { json } = await submit(ctx.base, pdfBuffer());
    ctx.worker.start({ pollIntervalMs: 10 });   // start AFTER submission
    const done = await pollUntil(ctx.base, json.job_id, (b) => b.status === 'failed',
      { tries: 60, waitMs: 30 });
    assert.equal(done.error.code, 'PIPELINE_TIMEOUT');
  } finally { ctx.worker.stop(); await ctx.close(); }
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

test('CORS is off by default', async () => {
  const ctx = await boot();
  try {
    const res = await fetch(`${ctx.base}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  } finally { await ctx.close(); }
});

test('CORS can be enabled behind the config flag, and requires an origin', async () => {
  const ctx = await boot({ config: testConfig({ enableCors: true, corsOrigin: 'https://radar.example' }) });
  try {
    const res = await fetch(`${ctx.base}/health`);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://radar.example');
  } finally { await ctx.close(); }

  assert.throws(
    () => createApp({ repository: createMemoryRepository(), config: testConfig({ enableCors: true }), logger: silent }),
    /CORS_ORIGIN is required/
  );
});
