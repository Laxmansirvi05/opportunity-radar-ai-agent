'use strict';

/**
 * Data Plane — Redis Client
 *
 * Provides a lazy-initialized ioredis client (singleton per process) and a
 * health-check utility.
 *
 * Usage:
 *   const { getClient, healthCheck, shutdown } = require('./redis');
 *   const redis = getClient();
 *   await redis.set('key', 'value', 'EX', 300);
 *
 * Shutdown:
 *   Call shutdown() before process exit.  QUIT is sent to Redis which flushes
 *   any pending commands and closes the TCP connection cleanly.
 */

const Redis = require('ioredis');
const { loadConfig } = require('./config');

/** @type {import('ioredis').Redis | null} */
let client = null;

/**
 * Returns the process-wide ioredis client, creating it on first call.
 * Subsequent calls return the same instance.
 *
 * @returns {import('ioredis').Redis}
 */
function getClient() {
  if (client) return client;

  const config = loadConfig();

  client = new Redis({
    host:     config.redis.host,
    port:     config.redis.port,
    // ioredis treats undefined as "no auth"; passing null or '' causes AUTH errors.
    ...(config.redis.password ? { password: config.redis.password } : {}),
    db:       config.redis.db,
    // Retry strategy: bounded exponential backoff capped at 5 s.
    // Returns null after 10 consecutive failures to prevent infinite reconnect loops
    // in environments where Redis is genuinely unavailable.
    retryStrategy(times) {
      if (times > 10) {
        process.stderr.write(
          JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'redis_reconnect_limit_reached', attempts: times }) + '\n'
        );
        return null; // Stop retrying — surface the error to callers.
      }
      return Math.min(times * 200, 5_000);
    },
    enableReadyCheck:      true,
    maxRetriesPerRequest:  3,
    lazyConnect:           false,
  });

  client.on('error', (err) => {
    process.stderr.write(
      JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'redis_client_error', err: err.message }) + '\n'
    );
  });

  client.on('connect', () => {
    process.stdout.write(
      JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'redis_connected' }) + '\n'
    );
  });

  return client;
}

/**
 * Verifies the Redis connection by issuing a PING command.
 * Resolves with { status: 'ok', latencyMs: number } on success.
 * Rejects with a plain Error on failure.
 *
 * @returns {Promise<{ status: 'ok', latencyMs: number }>}
 */
async function healthCheck() {
  const start = Date.now();
  const result = await getClient().ping();
  if (result !== 'PONG') {
    throw new Error(`Redis PING returned unexpected response: "${result}"`);
  }
  return { status: 'ok', latencyMs: Date.now() - start };
}

/**
 * Sends QUIT to Redis and destroys the client singleton.
 * Safe to call multiple times (no-op after first call).
 *
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (!client) return;
  const c = client;
  client = null;
  await c.quit();
}

module.exports = { getClient, healthCheck, shutdown };
