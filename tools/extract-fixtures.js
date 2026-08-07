'use strict';

/**
 * extract-fixtures.js
 *
 * Captures the intermediate outputs of a real n8n pipeline run into
 * fixtures/ so the pipeline's pure logic (search planning, quality gate,
 * scoring bookkeeping, finalize, allocation) can be iterated against with
 * ZERO network calls and zero API quota spend.
 *
 * Usage:
 *   node tools/extract-fixtures.js [pipeline_execution.json] [outDir]
 *
 * n8n writes a log preamble before the JSON blob, so we locate the blob
 * rather than assuming the file is pure JSON.
 */

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'pipeline_execution.json';
const OUT = process.argv[3] || 'fixtures';

function loadRunData(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const start = txt.indexOf('{\n  "data"');
  if (start === -1) throw new Error(`no JSON blob found in ${file}`);
  let blob = txt.slice(start);
  try {
    return JSON.parse(blob).data.resultData.runData;
  } catch {
    const end = blob.lastIndexOf('}');
    return JSON.parse(blob.slice(0, end + 1)).data.resultData.runData;
  }
}

/** Flatten every item a node emitted across all of its runs. */
function itemsOf(runs) {
  const out = [];
  for (const run of runs || []) {
    for (const branch of run?.data?.main || []) {
      for (const item of branch || []) {
        if (item && item.json !== undefined) out.push(item.json);
      }
    }
  }
  return out;
}

const NODES = [
  'Code in JavaScript',
  'Build Multi-Source Search Plan',
  'HTTP Request',
  'Normalize + Classify Discovery Results',
  'Discovery Quality Gate + Dedup',
  'Standardize Opportunity',
  'Resume Match Engine',
  'Finalize Results',
  'Geographic Allocator',
];

const SAFE_NAME = {
  'Code in JavaScript': 'candidate',
  'Build Multi-Source Search Plan': 'search-plan',
  'HTTP Request': 'tavily-responses',
  'Normalize + Classify Discovery Results': 'normalized',
  'Discovery Quality Gate + Dedup': 'quality-gated',
  'Standardize Opportunity': 'standardized',
  'Resume Match Engine': 'scored',
  'Finalize Results': 'finalized',
  'Geographic Allocator': 'allocated',
};

function main() {
  const runData = loadRunData(SRC);
  fs.mkdirSync(OUT, { recursive: true });

  const manifest = { source: SRC, capturedAt: new Date().toISOString(), nodes: {} };

  for (const node of NODES) {
    if (!runData[node]) {
      console.log(`  (skip) ${node} — not present in run`);
      continue;
    }
    const items = itemsOf(runData[node]);
    const file = path.join(OUT, `${SAFE_NAME[node]}.json`);
    fs.writeFileSync(file, JSON.stringify(items, null, 2));
    manifest.nodes[node] = { file: path.basename(file), items: items.length };
    console.log(`  ${SAFE_NAME[node].padEnd(18)} ${String(items.length).padStart(4)} items -> ${file}`);
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest -> ${path.join(OUT, 'manifest.json')}`);
}

main();
