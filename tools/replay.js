'use strict';

/**
 * replay.js — offline replay harness for n8n Code nodes.
 *
 * Executes the REAL jsCode of a node from workflows.json against captured
 * fixtures, with zero network calls. This deliberately runs the node's own
 * source rather than a reimplementation, so the harness cannot drift away
 * from what the pipeline actually does.
 *
 * Usage (library):
 *   const { runNode } = require('./tools/replay');
 *   const out = runNode('Finalize Results', { input: items, nodes: { 'Code in JavaScript': [...] } });
 *
 * Usage (CLI):
 *   node tools/replay.js "Finalize Results" fixtures/scored.json
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function loadWorkflow(file = path.join(ROOT, 'workflows.json')) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function getNodeCode(nodeName, workflow = loadWorkflow()) {
  const node = (workflow.nodes || []).find((n) => n.name === nodeName);
  if (!node) throw new Error(`node not found in workflow: ${nodeName}`);
  const code = node.parameters && node.parameters.jsCode;
  if (typeof code !== 'string') throw new Error(`node has no jsCode: ${nodeName}`);
  return code;
}

/** Wrap a plain JSON array into n8n item shape. */
function toItems(values) {
  return values.map((json) => ({ json }));
}

/**
 * Execute a Code node's source against supplied inputs.
 *
 * @param {string} nodeName
 * @param {object} ctx
 * @param {object[]} ctx.input            — plain JSON objects for $input
 * @param {Object<string,object[]>} ctx.nodes — plain JSON objects per referenced node name, for $('Name')
 * @param {object} [ctx.helpers]          — override this.helpers (e.g. stub httpRequest)
 * @returns {object[]} plain JSON objects the node returned
 */
function runNode(nodeName, { input = [], nodes = {}, helpers = {} } = {}) {
  const code = getNodeCode(nodeName);
  const inputItems = toItems(input);

  const $input = {
    all: () => inputItems,
    first: () => inputItems[0],
    last: () => inputItems[inputItems.length - 1],
  };

  const $ = (name) => {
    if (!(name in nodes)) {
      throw new Error(`replay: node "${nodeName}" referenced $('${name}') but no fixture was supplied for it`);
    }
    const items = toItems(nodes[name]);
    return { all: () => items, first: () => items[0], last: () => items[items.length - 1] };
  };

  const thisArg = {
    helpers: {
      httpRequest: async () => {
        throw new Error('replay: network call attempted — supply a stub via ctx.helpers.httpRequest');
      },
      ...helpers,
    },
  };

  const sandbox = {
    $input,
    $,
    $json: inputItems[0] ? inputItems[0].json : {},
    console,
    JSON,
    Date,
    Math,
    Set,
    Map,
    URL,
    URLSearchParams,
    Buffer,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
  };

  // Code nodes may use top-level await and `return`, so wrap in an async fn.
  const wrapped = `(async function () {\n${code}\n})`;
  const context = vm.createContext(sandbox);
  const fn = vm.runInContext(wrapped, context, { filename: `${nodeName}.js` });
  return Promise.resolve(fn.call(thisArg)).then((result) => {
    if (!Array.isArray(result)) return [];
    return result.map((item) => (item && item.json !== undefined ? item.json : item));
  });
}

function loadFixture(name) {
  const file = name.endsWith('.json') ? name : path.join(ROOT, 'fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { runNode, getNodeCode, loadWorkflow, loadFixture, toItems };

if (require.main === module) {
  const [nodeName, fixtureFile] = process.argv.slice(2);
  if (!nodeName) {
    console.error('usage: node tools/replay.js "<Node Name>" [fixture.json]');
    process.exit(1);
  }
  const input = fixtureFile ? loadFixture(fixtureFile) : [];
  runNode(nodeName, { input, nodes: { 'Code in JavaScript': loadFixture('candidate') } })
    .then((out) => {
      console.log(`${nodeName}: ${input.length} in -> ${out.length} out`);
      console.log(JSON.stringify(out.slice(0, 3), null, 2));
    })
    .catch((e) => { console.error('replay failed:', e.message); process.exit(1); });
}
