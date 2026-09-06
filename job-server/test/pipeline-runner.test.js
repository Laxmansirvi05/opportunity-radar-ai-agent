'use strict';

/**
 * pipeline-runner.test.js — the CLI runner's timeout must kill the whole
 * process tree, not just its direct child.
 *
 * Regression: a hung run left `n8n` alive for 31 minutes, past both the
 * runner's own timeout and the job sweeper, because `npx` spawns a grandchild
 * and execFile's `timeout` only signals the direct child.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

/** Is a pid alive? signal 0 tests existence without signalling. */
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('a detached child group can be killed as a unit', async () => {
  // Mirrors the runner's mechanism: a shell that spawns a grandchild which
  // outlives its parent unless the whole GROUP is signalled.
  // NOTE: spawn, not execFile — `detached` is a spawn-only option that
  // execFile silently ignores, which is precisely why the original fix failed.
  const child = spawn('/bin/sh', ['-c', 'sleep 60 & echo $!; wait'], {
    detached: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const grandchildPid = await new Promise((resolve) => {
    child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
  });

  assert.ok(alive(child.pid), 'child should be running');
  assert.ok(alive(grandchildPid), 'grandchild should be running');

  // Killing only the direct child leaves the grandchild alive — the bug.
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  assert.ok(alive(grandchildPid), 'grandchild survives a direct-child kill (this is the bug)');

  // Killing the process GROUP reclaims it — the fix.
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group already gone */ }
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(alive(grandchildPid), false, 'group kill must reclaim the grandchild');
});

test('createCliRunner is configured to kill the tree on timeout', () => {
  const src = require('node:fs').readFileSync(
    require.resolve('../src/pipeline-runner.js'), 'utf8'
  );
  assert.match(src, /detached:\s*true/, 'child must be detached to have its own group');
  assert.match(src, /spawn\(/, 'must use spawn — execFile ignores the detached option');
  assert.ok(!/execFile\(/.test(src), 'execFile must not be used: it ignores detached');
  assert.match(src, /process\.kill\(-child\.pid/, 'timeout must signal the process group');
  assert.match(src, /SIGKILL/, 'must escalate if SIGTERM is ignored');
});

const { extractResponse } = require('../src/pipeline-runner');

/**
 * Build an n8n CLI dump where Build Response ran `slices.length` times, each
 * run carrying the given number of opportunities. Mirrors the multi-run output
 * splitInBatches produces when the loop body reconverges without a Merge node.
 */
function dumpWithRuns(slices) {
  const runs = slices.map((n, r) => ({
    data: { main: [[{ json: { run: r, opportunities: Array.from({ length: n }, (_, i) => i) } }]] },
  }));
  return JSON.stringify({ data: { resultData: { runData: { 'Build Response': runs } } } });
}

test('extractResponse returns the LAST Build Response run, not the first', () => {
  // The exact shape of the batchSize bug: earlier runs are partial, the last
  // is complete. Returning the first would hand the student 5 of 10.
  const out = extractResponse(dumpWithRuns([5, 8, 10]));
  assert.equal(out.run, 2, 'must read the final run');
  assert.equal(out.opportunities.length, 10, 'the final run carries the complete set');
});

test('extractResponse still works for a single Build Response run', () => {
  const out = extractResponse(dumpWithRuns([7]));
  assert.equal(out.run, 0);
  assert.equal(out.opportunities.length, 7);
});

test('extractResponse surfaces the failing node when Build Response never ran', () => {
  const dump = JSON.stringify({
    data: { resultData: { runData: { 'Some Node': [] }, error: { node: { name: 'playwright' }, message: 'boom' } } },
  });
  assert.throws(() => extractResponse(dump), /pipeline failed at playwright: boom/);
});
