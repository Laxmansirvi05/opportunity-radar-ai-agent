'use strict';

/**
 * rate-limiter.js
 *
 * Per-domain token-bucket rate limiter backed by Redis.
 *
 * Algorithm:
 *   - Each domain gets a Redis key with a TTL equal to the window.
 *   - On each request: INCR the counter. If counter > limit, reject.
 *   - On first request (counter was 0): EXPIRE the key to reset the window.
 *
 * FAIL-OPEN CONTRACT (Refinement #6):
 *   If Redis is unavailable (any error), the request is ALLOWED and the
 *   miss is logged. Execution must never fail solely because Redis is down.
 *
 * Injectability:
 *   The Redis client is injected via the factory function so unit tests
 *   can pass a mock without touching the real Redis client.
 */

/**
 * Create a rate limiter for a given domain.
 *
 * @param {object} options
 * @param {number} options.maxRequests  — token bucket capacity
 * @param {number} options.windowMs     — bucket refill window in ms
 * @param {object} options.redisClient  — ioredis client instance
 * @param {object} [options.logger]     — optional logger with .warn()
 * @returns {{ check(domain: string): Promise<{ allowed: boolean, remaining: number }> }}
 */
function createRateLimiter({ maxRequests, windowMs, redisClient, logger = console }) {
  const windowSec = Math.ceil(windowMs / 1000);

  return {
    /**
     * Check and consume one token for the given domain.
     *
     * @param {string} domain
     * @returns {Promise<{ allowed: boolean, remaining: number, failOpen?: boolean }>}
     */
    async check(domain) {
      const key = `ef:rate:${domain}`;

      try {
        // INCR is atomic and creates the key if it doesn't exist.
        const count = await redisClient.incr(key);

        // Set expiry only on the first increment (avoids re-arming the TTL on every call).
        if (count === 1) {
          await redisClient.expire(key, windowSec);
        }

        if (count > maxRequests) {
          return { allowed: false, remaining: 0 };
        }
        return { allowed: true, remaining: maxRequests - count };
      } catch (err) {
        // FAIL-OPEN: log and allow.
        logger.warn('[rate-limiter] Redis unavailable — failing open', {
          domain,
          error: err.message,
        });
        return { allowed: true, remaining: -1, failOpen: true };
      }
    },
  };
}

module.exports = { createRateLimiter };
