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

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const N8N_FILE = '/Users/laxmansirvi/.n8n-files/sample-1.pdf';
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

function createCliRunner({ repoRoot, timeoutMs = 20 * 60 * 1000, logger = console } = {}) {
  return function runPipeline(job) {
    return new Promise((resolve, reject) => {
      try {
        fs.copyFileSync(job.resume_path, N8N_FILE);
      } catch (error) {
        return reject(new Error(`could not stage resume: ${error.message}`));
      }
      logger.info?.('pipeline_start', { jobId: job.id });
      execFile(
        'npx',
        ['--yes', 'n8n', 'execute', '--id', WORKFLOW_ID],
        { cwd: repoRoot, timeout: timeoutMs, maxBuffer: 512 * 1024 * 1024,
          env: { ...process.env, N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false' } },
        (error, stdout) => {
          if (error && error.killed) {
            const e = new Error('pipeline exceeded its time limit');
            e.code = 'PIPELINE_TIMEOUT';
            return reject(e);
          }
          try {
            return resolve(extractResponse(stdout || ''));
          } catch (parseError) {
            return reject(parseError);
          }
        }
      );
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
