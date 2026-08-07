'use strict';

/**
 * pipeline-runner.js — invokes the n8n pipeline for one job.
 *
 * Two implementations:
 *   createCliRunner    — real: stages the PDF and runs `n8n execute` one-shot,
 *                        then extracts the Build Response payload.
 *   createStubRunner   — replays a captured response, so the entire job server
 *                        can be tested with zero API calls.
 *
 * n8n webhook mode is NOT used yet — see FINAL_REPORT.md. The one-shot CLI path
 * is what the pipeline has actually been verified with.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Where the workflow's "Read/Write Files from Disk" node reads the resume.
// MUST match $env.RESUME_INPUT_PATH that n8n sees, or the pipeline reads a
// stale file. Defaulted off the home directory rather than hardcoded to one
// developer's machine.
const N8N_FILE = process.env.RESUME_INPUT_PATH
  || path.join(os.homedir(), '.n8n-files', 'resume-input.pdf');
const WORKFLOW_ID = '3bwLRC7IC0yDFog7';

/** Pull the Build Response payload out of an n8n CLI execution dump. */
function extractResponse(stdout) {
  let i = stdout.indexOf('{\n  "data"');
  if (i === -1) i = stdout.indexOf('{"data"');
  if (i === -1) throw new Error('n8n produced no execution JSON');
  const blob = stdout.slice(i);
  let parsed;
  try { parsed = JSON.parse(blob); } catch {
    parsed = JSON.parse(blob.slice(0, blob.lastIndexOf('}') + 1));
  }
  const rd = parsed.data?.resultData?.runData;
  if (!rd) throw new Error('n8n execution had no runData');

  const err = parsed.data.resultData.error;
  const br = rd['Build Response'];
  if (!br) {
    throw new Error(err
      ? `pipeline failed at ${err.node?.name || 'unknown node'}: ${err.message}`
      : 'pipeline produced no Build Response');
  }
  for (const run of br) {
    for (const branch of run?.data?.main || []) {
      for (const item of branch || []) {
        if (item && item.json) return item.json;
      }
    }
  }
  throw new Error('Build Response was empty');
}

function createCliRunner({ repoRoot, timeoutMs = 15 * 60 * 1000, maxStdoutBytes = 512 * 1024 * 1024, logger = console } = {}) {
  return function runPipeline(job) {
    return new Promise((resolve, reject) => {
      try {
        fs.mkdirSync(path.dirname(N8N_FILE), { recursive: true });
        fs.copyFileSync(job.resume_path, N8N_FILE);
      } catch (error) {
        return reject(new Error(`could not stage resume: ${error.message}`));
      }
      logger.info?.('pipeline_start', { jobId: job.id });

      // spawn, NOT execFile: `npx n8n` spawns a grandchild, and execFile's
      // timeout signals only its direct child — a hung run left n8n alive for
      // 31 minutes, past both the timeout and the job sweeper. `detached: true`
      // is also a spawn-only option (execFile silently ignores it), and it is
      // what puts the child in its own process GROUP so the whole tree can be
      // signalled with kill(-pid).
      const child = spawn(
        'npx',
        ['--yes', 'n8n', 'execute', '--id', WORKFLOW_ID],
        {
          cwd: repoRoot,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false' },
        }
      );

      let timedOut = false;
      let settled = false;
      const chunks = [];
      let total = 0;

      const killTree = (signal) => {
        try { process.kill(-child.pid, signal); }
        catch { try { child.kill(signal); } catch { /* already gone */ } }
      };

      const timer = setTimeout(() => {
        timedOut = true;
        logger.warn?.('pipeline_timeout_killing_tree', { jobId: job.id, pid: child.pid });
        killTree('SIGTERM');
        // Escalate if the group ignores SIGTERM.
        const hard = setTimeout(() => killTree('SIGKILL'), 5000);
        hard.unref?.();
      }, timeoutMs);
      timer.unref?.();

      child.stdout.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxStdoutBytes) {
          if (!settled) { settled = true; clearTimeout(timer); killTree('SIGKILL'); }
          return reject(new Error('pipeline produced more output than the buffer allows'));
        }
        chunks.push(chunk);
      });
      // n8n logs to stderr; drain it so the pipe cannot fill and block the child.
      child.stderr.on('data', () => {});

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`could not start n8n: ${error.message}`));
      });

      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (timedOut) {
          const e = new Error('pipeline exceeded its time limit');
          e.code = 'PIPELINE_TIMEOUT';
          return reject(e);
        }
        try {
          return resolve(extractResponse(Buffer.concat(chunks).toString('utf8')));
        } catch (parseError) {
          return reject(parseError);
        }
      });
    });
  };
}

/**
 * Replays a captured pipeline response. Used for every job-server test so the
 * HTTP surface, worker, sweeper, and error paths are verified without spending
 * API quota.
 *
 * @param {object} options
 * @param {object} [options.response]  — payload to return
 * @param {string} [options.fromFile]  — read the payload from disk instead
 * @param {number} [options.delayMs]   — simulate a slow run
 * @param {Error}  [options.throws]    — simulate a mid-run crash
 */
function createStubRunner({ response, fromFile, delayMs = 0, throws = null } = {}) {
  let payload = response;
  if (!payload && fromFile) payload = JSON.parse(fs.readFileSync(fromFile, 'utf8'));
  return async function runPipeline() {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (throws) throw throws;
    return payload;
  };
}

module.exports = { createCliRunner, createStubRunner, extractResponse };
