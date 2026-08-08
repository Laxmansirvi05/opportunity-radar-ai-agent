'use strict';

/**
 * verify-workflow-config.js — static guards on workflows.json.
 *
 * These catch a class of mistake that produces NO error at runtime: the
 * pipeline keeps running and just yields empty pages. Specifically, the
 * playwright node authenticates against render-service, which validates its
 * own API_KEY — not the ai-gateway key. Both were once the same hardcoded
 * literal, so a key rotation silently pointed render-service at the wrong
 * secret and every JS-heavy page came back blank for a whole run.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const wf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'workflows.json'), 'utf8'))[0];
const byName = Object.fromEntries(wf.nodes.map((n) => [n.name, n]));

function headerOf(nodeName, headerName) {
  const hp = (byName[nodeName].parameters.headerParameters || {}).parameters || [];
  const h = hp.find((p) => p.name.toLowerCase() === headerName.toLowerCase());
  return h && h.value;
}

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${label}\n        ${e.message}`); }
}

console.log('=== workflow config guards (static, 0 API calls) ===\n');

check('every node targeting ai-gateway sends GATEWAY_API_KEY', () => {
  for (const n of wf.nodes) {
    const url = String(n.parameters && n.parameters.url || '');
    if (!/:4000/.test(url)) continue;
    const v = headerOf(n.name, 'x-api-key');
    assert.match(String(v), /\$env\.GATEWAY_API_KEY/, `${n.name} must send $env.GATEWAY_API_KEY`);
  }
});

check('every node targeting render-service sends RENDER_SERVICE_API_KEY', () => {
  for (const n of wf.nodes) {
    const url = String(n.parameters && n.parameters.url || '');
    if (!/:3000/.test(url)) continue;
    const v = headerOf(n.name, 'x-api-key');
    assert.match(String(v), /\$env\.RENDER_SERVICE_API_KEY/,
      `${n.name} targets render-service and must NOT send the gateway key`);
  }
});

check('no cleartext secret remains in the workflow', () => {
  const s = JSON.stringify(wf);
  // Any long base64-ish literal sitting in a header value is suspect.
  for (const n of wf.nodes) {
    const hp = (n.parameters.headerParameters || {}).parameters || [];
    for (const p of hp) {
      if (/^[A-Za-z0-9_-]{24,}$/.test(String(p.value))) {
        throw new Error(`${n.name} header ${p.name} looks like a cleartext secret`);
      }
    }
  }
  assert.ok(!/7Kf92LmPqX4zR8NwLs5YbH3cUv9TxQa1/.test(s), 'the retired key literal is still present');
});

check('resume input path is configurable, not hardcoded to one machine', () => {
  const v = byName['Read/Write Files from Disk'].parameters.fileSelector;
  assert.match(String(v), /\$env\.RESUME_INPUT_PATH/);
});

check('render fallback cannot abort the run', () => {
  assert.equal(byName['playwright'].onError, 'continueRegularOutput');
  assert.equal(byName['HTTP Request2'].onError, 'continueRegularOutput');
});

check('loop batchSize stays 1 (branch reconvergence)', () => {
  assert.equal(byName['Loop Over Items'].parameters.batchSize, 1);
});

console.log(failures ? `\n${failures} guard(s) FAILED` : '\nall workflow config guards passed');
process.exit(failures ? 1 : 0);
