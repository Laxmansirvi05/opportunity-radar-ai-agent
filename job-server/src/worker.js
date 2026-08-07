'use strict';

/**
 * worker.js — runs one pipeline job at a time and sweeps stuck jobs.
 *
 * Concurrency is deliberately 1: the pipeline drives rate-limited LLM and
 * search APIs, and running two at once is what produced an 80% scoring failure
 * rate when it was tried inside the n8n loop.
 *
 * The pipeline runner is injected so the whole worker can be tested against a
 * stub that replays captured output, with no API calls.
 */

class JobWorker {
  /**
   * @param {object} deps
   * @param {object} deps.repository   — job repository
   * @param {(job: object) => Promise<object>} deps.runPipeline — resolves to the contract payload
   * @param {object} deps.config
   * @param {object} [deps.logger]
   */
  constructor({ repository, runPipeline, config, logger = console }) {
    this.repository = repository;
    this.runPipeline = runPipeline;
    this.config = config;
    this.logger = logger;
    this.pollTimer = null;
    this.sweepTimer = null;
    this.busy = false;
    this.stopped = false;
  }

  /** Claim and run at most one job. Returns the job it ran, or null. */
  async tick() {
    if (this.busy || this.stopped) return null;
    let job;
    try {
      job = await this.repository.claimNextQueued();
    } catch (error) {
      this.logger.error?.('job_claim_failed', { message: error.message });
      return null;
    }
    if (!job) return null;

    this.busy = true;
    try {
      const result = await this.runPipeline(job);
      await this.repository.markComplete(job.id, result);
      this.logger.info?.('job_complete', { jobId: job.id });
    } catch (error) {
      // Not silenced: the failure is recorded on the job in the contract's
      // error shape and surfaced through GET /api/jobs/:id.
      const err = {
        code: error.code === 'PIPELINE_TIMEOUT' ? 'PIPELINE_TIMEOUT' : 'PIPELINE_FAILED',
        message: error.message || 'Pipeline run failed',
      };
      await this.repository.markFailed(job.id, err);
      this.logger.error?.('job_failed', { jobId: job.id, ...err });
    } finally {
      this.busy = false;
    }
    return job;
  }

  /** Sweep jobs stuck in 'running' past the threshold. */
  async sweep() {
    try {
      const swept = await this.repository.sweepStuck(this.config.stuckAfterMs);
      if (swept.length) {
        this.logger.warn?.('jobs_swept', { count: swept.length, ids: swept.map((j) => j.id) });
      }
      return swept;
    } catch (error) {
      this.logger.error?.('sweep_failed', { message: error.message });
      return [];
    }
  }

  /** Start polling and the interval sweep. Sweeps once immediately too. */
  start({ pollIntervalMs = 1000 } = {}) {
    this.stopped = false;
    this.sweep();
    this.pollTimer = setInterval(() => { this.tick(); }, pollIntervalMs);
    // Sweeping on an INTERVAL, not only at startup — a job that hangs after the
    // server has been up for hours must still be reclaimed.
    this.sweepTimer = setInterval(() => { this.sweep(); }, this.config.sweepIntervalMs);
    this.pollTimer.unref?.();
    this.sweepTimer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.pollTimer = null;
    this.sweepTimer = null;
  }
}

module.exports = { JobWorker };
