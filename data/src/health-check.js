'use strict';

/**
 * Data Plane — Health Check CLI
 *
 * Verifies connectivity to PostgreSQL and Redis.
 * Exits with code 0 if all checks pass, 1 if any fail.
 *
 * Usage:
 *   npm run health          (from /data directory)
 *   node src/health-check.js
 *
 * Output: structured JSON suitable for log aggregation.
 */

const { healthCheck: dbHealthCheck, shutdown: dbShutdown }       = require('./db');
const { healthCheck: redisHealthCheck, shutdown: redisShutdown } = require('./redis');

async function main() {
  const results = {};

  // Run both checks concurrently — failures are caught and surfaced as
  // structured objects rather than rejecting the whole Promise.allSettled.
  const [dbResult, redisResult] = await Promise.allSettled([
    dbHealthCheck(),
    redisHealthCheck(),
  ]);

  results.postgres = dbResult.status === 'fulfilled'
    ? dbResult.value
    : { status: 'error', message: dbResult.reason?.message ?? 'Unknown error' };

  results.redis = redisResult.status === 'fulfilled'
    ? redisResult.value
    : { status: 'error', message: redisResult.reason?.message ?? 'Unknown error' };

  const allOk = Object.values(results).every((r) => r.status === 'ok');

  const output = {
    ts:      new Date().toISOString(),
    status:  allOk ? 'ok' : 'degraded',
    checks:  results,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');

  // Graceful shutdown before exit.
  await Promise.allSettled([dbShutdown(), redisShutdown()]);

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'health_check_crashed', err: err.message }) + '\n'
  );
  process.exit(1);
});
