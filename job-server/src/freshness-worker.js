'use strict';

/**
 * freshness-worker.js
 *
 * Implements Phase 8: Freshness & Recency Verification.
 * Periodically polls the DB for active opportunities that haven't been
 * verified in N days. Performs a lightweight HEAD request to the apply_url,
 * with a GET fallback for 405s.
 */

const Bottleneck = require('bottleneck');

class FreshnessWorker {
  constructor({ opportunityRepository, config, logger = console }) {
    this.opportunityRepository = opportunityRepository;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.busy = false;

    // Rate limiter matching Phase 4's logic to prevent bursting ATS domains
    this.domainLimiters = new Bottleneck.Group({ maxConcurrent: 1, minTime: 750 });
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;

    try {
      const staleDays = this.config.freshnessStaleDays || 7;
      const batchSize = this.config.freshnessBatchSize || 5;

      const ops = await this.opportunityRepository.getStaleOpportunities(staleDays, batchSize);
      if (ops.length === 0) {
        this.busy = false;
        return;
      }

      for (const op of ops) {
        try {
          if (!op.apply_url) continue;
          
          const hostname = new URL(op.apply_url).hostname;
          const result = await this.domainLimiters.key(hostname).schedule(() => this.checkUrl(op.apply_url));

          if (result.conclusive) {
            if (result.alive) {
              await this.opportunityRepository.updateVerification(op.id, 'active', 0);
              this.logger.info?.('freshness_verified_alive', { id: op.id, url: op.apply_url, status: result.status });
            } else {
              await this.opportunityRepository.updateVerification(op.id, 'expired', 0);
              this.logger.info?.('freshness_verified_expired', { id: op.id, url: op.apply_url, status: result.status });
            }
          } else {
            // Inconclusive (e.g. network timeout, 5xx)
            const failures = (op.verification_failures || 0) + 1;
            if (failures >= 3) {
              await this.opportunityRepository.updateVerification(op.id, 'expired', failures);
              this.logger.info?.('freshness_expired_after_retries', { id: op.id, url: op.apply_url, failures });
            } else {
              // Just update the failure count but leave status='active'.
              // We also don't bump last_verified_at, so it gets picked up again on the next pass.
              const pool = require('../../data/src/db').getPool();
              await pool.query(
                `UPDATE opportunities SET verification_failures = $1, updated_at = now() WHERE id = $2`,
                [failures, op.id]
              );
              this.logger.warn?.('freshness_check_inconclusive', { id: op.id, url: op.apply_url, failures, status: result.status });
            }
          }
        } catch (err) {
          this.logger.warn?.('freshness_check_failed', { id: op.id, message: err.message });
        }
      }
    } catch (err) {
      this.logger.error?.('freshness_worker_failed', { message: err.message });
    } finally {
      this.busy = false;
    }
  }

  /**
   * Check if a URL is still alive.
   * Returns: { alive: boolean, conclusive: boolean, status: number|string }
   */
  async checkUrl(url) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 10000);

      let res = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)' },
      });

      // 405 Method Not Allowed - retry with GET
      if (res.status === 405) {
        res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)' },
        });
      }
      clearTimeout(id);

      // Definitively removed
      if (res.status === 404 || res.status === 410) {
        return { alive: false, conclusive: true, status: res.status };
      }

      // Server error or Too Many Requests - inconclusive
      if (res.status >= 500 || res.status === 429) {
        return { alive: false, conclusive: false, status: res.status };
      }

      // All other 2xx, 3xx, 4xx (like 403 Forbidden which implies alive WAF)
      return { alive: true, conclusive: true, status: res.status };
    } catch (error) {
      // Network errors (DNS fail, timeout) - inconclusive
      return { alive: false, conclusive: false, status: error.message };
    }
  }

  start({ pollIntervalMs = 60000 } = {}) {
    this.timer = setInterval(() => { this.tick(); }, pollIntervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { FreshnessWorker };
