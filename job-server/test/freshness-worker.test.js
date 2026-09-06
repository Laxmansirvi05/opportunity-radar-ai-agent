'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPool } = require('../../data/src/db');
const { upsertOpportunity, getStaleOpportunities } = require('../../data/src/repositories/opportunity-repository');
const { FreshnessWorker } = require('../src/freshness-worker');

test('FreshnessWorker expires dead URLs and preserves alive ones', async () => {
  const pool = getPool();
  // We mock fetch for the test
  const originalFetch = global.fetch;

  try {
    // 1. Insert two test opportunities, backdating last_verified_at to 10 days ago
    const deadOp = await upsertOpportunity({
      sourceUrl: 'https://mock.com/dead',
      contentHash: 'mock-hash-dead-url',
      title: 'Dead Job',
      applyUrl: 'https://httpbin.org/status/404',
    });
    const aliveOp = await upsertOpportunity({
      sourceUrl: 'https://mock.com/alive',
      contentHash: 'mock-hash-alive-url',
      title: 'Alive Job',
      applyUrl: 'https://httpbin.org/status/200',
    });

    await pool.query(
      `UPDATE opportunities SET last_verified_at = now() - interval '10 days' WHERE id IN ($1, $2)`,
      [deadOp.id, aliveOp.id]
    );

    // Mock fetch so we don't depend on network for tests
    global.fetch = async (url) => {
      if (url === 'https://httpbin.org/status/404') {
        return { status: 404 };
      }
      if (url === 'https://httpbin.org/status/200') {
        return { status: 200 };
      }
      throw new Error('Unknown URL in mock');
    };

    const worker = new FreshnessWorker({
      opportunityRepository: require('../../data/src/repositories/opportunity-repository'),
      config: { freshnessStaleDays: 7, freshnessBatchSize: 10 },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    // 2. Run the worker tick
    await worker.tick();

    // 3. Verify outcomes
    const { rows } = await pool.query(`SELECT id, status, last_verified_at FROM opportunities WHERE id IN ($1, $2)`, [deadOp.id, aliveOp.id]);
    
    const dbDead = rows.find((r) => r.id === deadOp.id);
    const dbAlive = rows.find((r) => r.id === aliveOp.id);

    assert.equal(dbDead.status, 'expired', 'Dead URL should be marked expired');
    assert.equal(dbAlive.status, 'active', 'Alive URL should remain active');
    
    // Both should have an updated last_verified_at > 1 day ago
    assert.ok(new Date(dbDead.last_verified_at).getTime() > Date.now() - 1000 * 60 * 60, 'last_verified_at should be updated');
    assert.ok(new Date(dbAlive.last_verified_at).getTime() > Date.now() - 1000 * 60 * 60, 'last_verified_at should be updated');

  } finally {
    global.fetch = originalFetch;
    await pool.query(`DELETE FROM opportunities WHERE content_hash IN ('mock-hash-dead-url', 'mock-hash-alive-url')`);
  }
});
