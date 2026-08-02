'use strict';

/**
 * circuit-breaker.js
 *
 * Per-provider circuit breaker implementing the three-state automaton:
 *
 *   CLOSED → (consecutive failures >= threshold) → OPEN
 *   OPEN   → (cooldown expires) → HALF_OPEN
 *   HALF_OPEN → (success) → CLOSED
 *   HALF_OPEN → (failure) → OPEN
 *
 * State is in-memory per process. Not distributed — each worker process
 * has its own circuit breaker state. This is acceptable for Sprint 3
 * because the Execution Fabric runs in a single process per run.
 *
 * Thread-safety note: Node.js is single-threaded so no locking needed.
 */

const STATES = Object.freeze({
  CLOSED:    'CLOSED',
  OPEN:      'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

class CircuitBreaker {
  /**
   * @param {object} options
   * @param {string} options.name             — provider name (for logging)
   * @param {number} options.failureThreshold — consecutive failures before OPEN
   * @param {number} options.cooldownMs       — ms to wait before trying HALF_OPEN
   */
  constructor({ name, failureThreshold = 5, cooldownMs = 60_000 }) {
    this.name             = name;
    this.failureThreshold = failureThreshold;
    this.cooldownMs       = cooldownMs;

    this._state            = STATES.CLOSED;
    this._consecutiveFails = 0;
    this._openedAt         = null;  // timestamp when last transitioned to OPEN
  }

  /** @returns {'CLOSED'|'OPEN'|'HALF_OPEN'} */
  get state() {
    // Lazily promote OPEN → HALF_OPEN when cooldown expires.
    if (this._state === STATES.OPEN) {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this.cooldownMs) {
        this._state = STATES.HALF_OPEN;
      }
    }
    return this._state;
  }

  /** Returns true when requests should be rejected without executing. */
  isOpen() {
    return this.state === STATES.OPEN;
  }

  /** Returns true when requests should be allowed (CLOSED or HALF_OPEN probe). */
  allowRequest() {
    return this.state !== STATES.OPEN;
  }

  /**
   * Record a successful provider call.
   * In HALF_OPEN: resets to CLOSED.
   * In CLOSED:    resets consecutive failure counter.
   *
   * @returns {{ transitioned: boolean, from: string, to: string }|null}
   */
  recordSuccess() {
    const prev = this.state;
    this._consecutiveFails = 0;

    if (this._state === STATES.HALF_OPEN || this._state === STATES.OPEN) {
      this._state    = STATES.CLOSED;
      this._openedAt = null;
      return { transitioned: true, from: prev, to: STATES.CLOSED };
    }
    return null;
  }

  /**
   * Record a failed provider call.
   *
   * @returns {{ transitioned: boolean, from: string, to: string }|null}
   */
  recordFailure() {
    const prev = this.state;
    this._consecutiveFails += 1;

    if (this._state === STATES.HALF_OPEN ||
        (this._state === STATES.CLOSED && this._consecutiveFails >= this.failureThreshold)) {
      this._state    = STATES.OPEN;
      this._openedAt = Date.now();
      return { transitioned: true, from: prev, to: STATES.OPEN };
    }
    return null;
  }

  /** Force reset to CLOSED — for testing and manual recovery. */
  reset() {
    this._state            = STATES.CLOSED;
    this._consecutiveFails = 0;
    this._openedAt         = null;
  }

  toJSON() {
    return {
      name:             this.name,
      state:            this.state,
      consecutiveFails: this._consecutiveFails,
      openedAt:         this._openedAt,
    };
  }
}

/**
 * Factory: create a circuit breaker registry keyed by provider name.
 *
 * @param {object} defaults — { failureThreshold, cooldownMs }
 * @returns {{ get(name: string): CircuitBreaker }}
 */
function createRegistry(defaults = {}) {
  const registry = new Map();
  return {
    get(name) {
      if (!registry.has(name)) {
        registry.set(name, new CircuitBreaker({ name, ...defaults }));
      }
      return registry.get(name);
    },
    getAll() {
      return Object.fromEntries(
        [...registry.entries()].map(([k, cb]) => [k, cb.toJSON()])
      );
    },
  };
}

module.exports = { CircuitBreaker, createRegistry, STATES };
