'use strict';

/**
 * dispatcher.js
 *
 * Promise-pool concurrency controller.
 *
 * Runs up to maxConcurrentWorkers simultaneous tasks. No external libraries.
 *
 * Algorithm (slot-based):
 *   - Start `maxConcurrentWorkers` concurrent "slot" coroutines.
 *   - Each slot pulls the next task from the shared queue and executes it.
 *   - When a slot finishes, it immediately picks up the next task.
 *   - All slots share a single atomic index variable (safe in single-threaded JS).
 *
 * This approach ensures max concurrency is never exceeded and that a stalled
 * worker does not block other slots — they continue processing independently.
 */

/**
 * Dispatch an array of tasks with bounded concurrency.
 *
 * @param {object[]} tasks         — array of items to process
 * @param {Function} handler       — async (task) => result
 * @param {number}   maxConcurrency
 * @returns {Promise<Array<{ task: object, result?: any, error?: Error }>>}
 */
async function dispatch(tasks, handler, maxConcurrency = 5) {
  if (tasks.length === 0) return [];

  const results = new Array(tasks.length);
  let nextIndex = 0;

  // Each "slot" is a coroutine that runs until the queue is drained.
  async function slot() {
    while (true) {
      // Atomically claim the next task index.
      const idx = nextIndex++;
      if (idx >= tasks.length) break;

      const task = tasks[idx];
      try {
        results[idx] = { task, result: await handler(task) };
      } catch (err) {
        // Worker errors are captured, not thrown — one failure does not
        // cancel other slots.
        results[idx] = { task, error: err };
      }
    }
  }

  // Launch `min(maxConcurrency, tasks.length)` concurrent slots.
  const slotCount = Math.min(maxConcurrency, tasks.length);
  const slots = Array.from({ length: slotCount }, () => slot());
  await Promise.all(slots);

  return results;
}

module.exports = { dispatch };
