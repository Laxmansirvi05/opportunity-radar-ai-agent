'use strict';

/**
 * freshness-worker.js
 *
 * Implements Phase 8: Freshness & Recency Verification.
 * Periodically polls the DB for active opportunities that haven't been
 * verified in N days. Performs a lightweight HEAD request to the apply_url.
 * If the link is dead (404, DNS error, timeout), marks the opportunity as 'expired'.
 * Otherwise, updates last_verified_at so it isn't checked again for N days.
 */

class FreshnessWorker {
  constructor({ opportunityRepository, config, logger = console }) {
    this.opportunityRepository = opportunityRepository;
    this.config = config;
    this.logger = logger;
    this.timer = null;
    this.busy = false;
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
          const isAlive = await this.checkUrl(op.apply_url);
          const status = isAlive ? 'active' : 'expired';
          await this.opportunityRepository.updateVerification(op.id, status);
          this.logger.info?.('freshness_verified', { id: op.id, url: op.apply_url, status });
        } catch (err) {
          // If the check crashes, just log it. We shouldn't fail the whole loop.
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
   * Returns false on 404/410, or network failure (timeout/DNS).
   * Returns true on 200-399 and 401/403 (auth errors mean the server is up but blocked us).
   */
  async checkUrl(url) {
    if (!url) return false;

    try {
      // 10s timeout, avoid hanging on dead servers
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 10000);

      // Use a standard user-agent so we don't get blocked by WAFs instantly
      const res = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpportunityRadar/1.0)' },
      });
      clearTimeout(id);

      // 404 Not Found and 410 Gone mean the job is definitely removed.
      if (res.status === 404 || res.status === 410) {
        return false;
      }

      // 2xx, 3xx, and other 4xx/5xx (like 403 Forbidden or 500) we assume it's still alive
      // or at least not definitively closed. We don't want to expire a job just because
      // Cloudflare blocked our HEAD request.
      return true;
    } catch (error) {
      // Network errors (DNS fail, timeout, connection refused) indicate a dead URL.
      // But some might be temporary. We could add a retry mechanism later if needed.
      // For now, if we can't reach it, it's dead.
      return false;
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
