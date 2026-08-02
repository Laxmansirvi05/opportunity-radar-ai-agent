'use strict';

/**
 * event-logger.js
 *
 * Wraps the Data Plane event-log-repository for use in the Execution Fabric.
 *
 * Key contract:
 *   - All writes are FIRE-AND-FORGET on the critical execution path.
 *   - logAsync() — used on the hot path; errors are swallowed (logged to console).
 *   - logSync()  — awaited version for use at lifecycle boundaries where
 *     ordering matters (e.g. 'execution.started', 'execution.completed').
 *   - Never throw. A logging failure must never fail the execution run.
 *
 * The repository is injected so unit tests can use a mock without touching
 * the database.
 */

/**
 * Create an event logger bound to a specific candidateId and runId.
 *
 * @param {object} options
 * @param {string} options.candidateId
 * @param {string} options.runId
 * @param {object} options.repository       — event-log-repository (injectable)
 * @returns {{ log(eventType, payload?): Promise<void>, logAsync(eventType, payload?): void }}
 */
function createEventLogger({ candidateId, runId, repository }) {
  /**
   * Write an event. Returns a promise. Use with await at lifecycle boundaries.
   *
   * @param {string} eventType
   * @param {object} [payload]
   * @returns {Promise<void>}
   */
  async function log(eventType, payload = {}) {
    try {
      await repository.appendEvent({
        eventType,
        payloadJson: payload,
        candidateId,
        runId,
      });
    } catch (err) {
      // Swallow — event write failures must not affect execution.
      console.error('[event-logger] Failed to write event', { eventType, error: err.message });
    }
  }

  /**
   * Fire-and-forget version — use on the hot path where awaiting would
   * add latency to the critical execution loop.
   *
   * @param {string} eventType
   * @param {object} [payload]
   */
  function logAsync(eventType, payload = {}) {
    repository.appendEvent({
      eventType,
      payloadJson: payload,
      candidateId,
      runId,
    }).catch((err) => {
      console.error('[event-logger] Failed to write event (async)', { eventType, error: err.message });
    });
  }

  return { log, logAsync };
}

module.exports = { createEventLogger };
