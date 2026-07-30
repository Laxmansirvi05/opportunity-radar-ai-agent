'use strict';

const config = require('./config');
const { QueueFullError, RenderTimeoutError } = require('./errors');

/**
 * A minimal, dependency-free concurrency-limited queue.
 *
 * Why hand-rolled instead of a library: the required tech stack is
 * Node/Express/Playwright only, and the semantics we need are simple -
 * bound concurrent Chromium pages, bound total queue depth, and fail fast
 * if a request waits too long just to START being processed.
 */
class RequestQueue {
  constructor({ concurrency, maxQueueSize }) {
    this.concurrency = concurrency;
    this.maxQueueSize = maxQueueSize;
    this.active = 0;
    this.queue = [];
    this.completedCount = 0;
    this.failedCount = 0;
  }

  get queuedCount() {
    return this.queue.length;
  }

  get activeCount() {
    return this.active;
  }

  /**
   * Enqueues an async task. Resolves/rejects with the task's own outcome.
   * Rejects immediately (without queueing) if already at max queue depth.
   */
  enqueue(task, { waitTimeoutMs = config.queueWaitTimeoutMs } = {}) {
    if (this.queue.length >= this.maxQueueSize) {
      this.failedCount += 1;
      return Promise.reject(
        new QueueFullError('Request queue is full, please retry later', {
          queueSize: this.queue.length,
          maxQueueSize: this.maxQueueSize,
        })
      );
    }

    return new Promise((resolve, reject) => {
      let settled = false;

      const entry = {
        run: async () => {
          clearTimeout(waitTimer);
          if (settled) return; // already timed out waiting in the queue
          try {
            const result = await task();
            settled = true;
            this.completedCount += 1;
            resolve(result);
          } catch (err) {
            settled = true;
            this.failedCount += 1;
            reject(err);
          }
        },
      };

      // Fail fast if this request sits behind a saturated queue for too
      // long, rather than let it wait indefinitely.
      const waitTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) this.queue.splice(idx, 1);
        this.failedCount += 1;
        reject(
          new RenderTimeoutError('Timed out waiting in queue for an available worker', {
            waitedMs: waitTimeoutMs,
          })
        );
      }, waitTimeoutMs);

      this.queue.push(entry);
      this._drain();
    });
  }

  _drain() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift();
      this.active += 1;
      Promise.resolve(entry.run()).finally(() => {
        this.active -= 1;
        this._drain();
      });
    }
  }
}

module.exports = new RequestQueue({
  concurrency: config.maxConcurrency,
  maxQueueSize: config.maxQueueSize,
});
