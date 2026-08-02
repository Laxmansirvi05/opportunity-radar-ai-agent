'use strict';

require('dotenv').config({ path: '../data/.env' }); // Load test DB URL

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const crypto   = require('crypto');

const data = require('../../data/src/index');
const { executeSearchPlan } = require('../src/orchestrator');

// Provide a mock provider registry that bypasses real HTTP
const mockRegistry = {
  select: (query) => {
    return [
      {
        name: 'mock-greenhouse',
        supports: () => true,
        execute: async () => [
          {
            title: `Mock Job`,
            company: 'Mock Inc',
            location: 'Remote',
            workplaceType: 'remote',
            employmentType: 'full-time',
            description: 'Mock desc',
            requirements: ['A'],
            skills: ['B'],
            applicationUrl: 'https://mock.com',
            deadline: null,
            sourceUrl: 'https://mock.com',
            rawJson: {}
          }
        ]
      }
    ];
  }
};

// Also mock Redis so we don't need a real Redis server for CI
const mockRedis = {
  incr: async () => 1,
  expire: async () => {},
};

test('Execution Fabric Integration: end-to-end with real DB', async (t) => {
  // 1. Setup DB
  const pool = data.getPool();
  
  await pool.query("DELETE FROM opportunities WHERE source_url = 'https://mock.com'");
  await pool.query("DELETE FROM dedup_signatures"); // Safe to clear all in this test
  await pool.query("DELETE FROM event_log");
  await pool.query("DELETE FROM execution_runs");
  await pool.query("DELETE FROM candidates");

  // Seed a candidate
  const candidateId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO candidates (id, resume_hash, profile_json, profile_schema_version, profile_model_version) VALUES ($1, $2, '{}', '1.0.0', 'test')",
    [candidateId, candidateId]
  );
  
  // Seed a search plan
  const planJson = {
    planVersion: '1.0.0',
    metadata: { generatedAt: new Date().toISOString(), model: 'test' },
    queries: [
      { queryId: 'q-1', tier: 1, keywords: [], exclusions: [] },
      { queryId: 'q-2', tier: 2, keywords: [], exclusions: [] }
    ]
  };

  const planRes = await pool.query(
    "INSERT INTO search_plans (candidate_id, profile_version, plan_json) VALUES ($1, 'v1', $2) RETURNING id",
    [candidateId, planJson]
  );
  const planId = planRes.rows[0].id;

  // 2. Execute Orchestrator
  const result = await executeSearchPlan({
    planId,
    candidateId,
    redisClient: mockRedis,
    registry: mockRegistry,
  });

  // 3. Verify Result Object
  assert.equal(result.status, 'completed');
  assert.equal(result.queriesTotal, 2);
  assert.equal(result.queriesCompleted, 2);
  assert.equal(result.queriesFailed, 0);

  // 4. Verify DB State (execution_runs)
  const runRes = await pool.query('SELECT * FROM execution_runs WHERE id = $1', [result.runId]);
  const run = runRes.rows[0];
  assert.equal(run.status, 'completed');
  assert.equal(run.queries_completed, 2);

  // 5. Verify DB State (opportunities)
  const oppRes = await pool.query("SELECT * FROM opportunities WHERE source_url = 'https://mock.com'");
  
  if (oppRes.rows.length !== 1) {
    console.log('Orchestrator Result:', result);
    
    const eventRes = await pool.query('SELECT event_type, payload_json FROM event_log WHERE run_id = $1 ORDER BY published_at ASC', [result.runId]);
    console.log('Event Log:', eventRes.rows);
  }

  assert.equal(oppRes.rows.length, 1, 'Should have deduplicated the second identical opportunity');

  assert.equal(result.opportunitiesFound, 1);
  assert.equal(run.opportunities_found, 1);
  
  // 6. Verify Event Log
  const eventRes = await pool.query('SELECT * FROM event_log WHERE run_id = $1 ORDER BY published_at ASC', [result.runId]);
  const events = eventRes.rows;
  assert.ok(events.length > 5, 'Should emit multiple lifecycle events');
  assert.equal(events[0].event_type, 'execution.started');
  assert.equal(events[events.length - 1].event_type, 'execution.completed');

  // Teardown
  await pool.end();
});
