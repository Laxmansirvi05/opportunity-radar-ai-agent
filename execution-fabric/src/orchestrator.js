'use strict';

/**
 * orchestrator.js
 *
 * Top-level execution run lifecycle manager.
 *
 * Responsibilities:
 *   1. Load the immutable Search Plan from the Data Plane
 *   2. Create an execution_run record (status: 'running')
 *   3. Set up shared per-run dependencies:
 *        - Circuit breaker registry (per-provider, in-memory)
 *        - Rate limiter (Redis-backed, fail-open)
 *        - Event logger (bound to runId + candidateId)
 *   4. Dispatch all queries via the promise-pool Dispatcher
 *   5. Aggregate results
 *   6. Finalize execution_run (status: completed/partial/failed)
 *   7. Log lifecycle events
 *   8. Return ExecutionResult
 *
 * All SQL access goes through injected repositories.
 * The overall run timeout is enforced via Promise.race.
 */

require('./config');

const { createRegistry }    = require('./circuit-breaker');
const { createRateLimiter } = require('./rate-limiter');
const { createEventLogger } = require('./event-logger');
const { dispatch }          = require('./dispatcher');
const { executeQuery }      = require('./worker');
const providerRegistry      = require('./providers/index');
const config                = require('./config');

// Default repositories — loaded lazily so unit tests inject mocks.
let _repos = null;
function getRepositories() {
  if (!_repos) {
    const data = require('../../data/src/index');
    _repos = {
      searchPlan:   data.searchPlanRepository,
      executionRun: data.executionRunRepository,
      opportunity:  data.opportunityRepository,
      dedup:        data.dedupRepository,
      eventLog:     data.eventLogRepository,
    };
  }
  return _repos;
}

// Default Redis client — lazy.
let _redis = null;
function getRedisClient() {
  if (!_redis) {
    _redis = require('../../data/src/redis').getClient();
  }
  return _redis;
}

/**
 * Execute a Search Plan end-to-end.
 *
 * @param {object} options
 * @param {string} options.planId         — UUID of a search_plans row
 * @param {string} options.candidateId    — redundant validation (must match plan)
 * @param {object} [options.repositories] — injectable for testing
 * @param {object} [options.redisClient]  — injectable for testing
 * @param {object} [options.registry]     — provider registry (injectable)
 * @returns {Promise<{
 *   runId:              string,
 *   candidateId:        string,
 *   planId:             string,
 *   status:             string,
 *   opportunitiesFound: number,
 *   queriesTotal:       number,
 *   queriesCompleted:   number,
 *   queriesFailed:      number,
 *   durationMs:         number,
 *   providerStats:      object
 * }>}
 */
async function executeSearchPlan({ planId, candidateId, repositories, redisClient, registry }) {
  const repos   = repositories || getRepositories();
  const redis   = redisClient  || getRedisClient();
  const reg     = registry     || providerRegistry;

  const startedAt = Date.now();

  // 1. Load the immutable Search Plan.
  const plan = await repos.searchPlan.getSearchPlanById(planId);
  if (!plan) {
    throw new Error(`Search plan not found: ${planId}`);
  }
  if (plan.candidate_id !== candidateId) {
    throw new Error(`Plan ${planId} does not belong to candidate ${candidateId}`);
  }

  const planJson = plan.plan_json;
  const queries  = planJson.queries || [];

  // 2. Create execution_run.
  const { id: runId } = await repos.executionRun.createExecutionRun({
    candidateId,
    searchPlanId: planId,
    queriesTotal: queries.length,
  });

  // 3. Set up shared per-run dependencies.
  const circuitBreakers = createRegistry({
    failureThreshold: config.cbFailureThreshold,
    cooldownMs:       config.cbCooldownMs,
  });

  const rateLimiter = createRateLimiter({
    maxRequests: config.rateLimitRequests,
    windowMs:    config.rateLimitWindowMs,
    redisClient: redis,
  });

  const eventLogger = createEventLogger({
    candidateId,
    runId,
    repository: repos.eventLog,
  });

  await eventLogger.log('execution.started', {
    planId,
    queryCount: queries.length,
  });

  await eventLogger.log('execution.plan_loaded', {
    planId,
    planVersion: planJson.planVersion,
    queryCount:  queries.length,
  });

  // Shared worker deps.
  const workerDeps = {
    config,
    circuitBreakers,
    rateLimiter,
    providerRegistry: reg,
    opportunityRepo:  repos.opportunity,
    dedupRepo:        repos.dedup,
    eventLogger,
    runId,
  };

  // 4. Dispatch all queries with concurrency control + overall timeout.
  const runPromise = dispatch(
    queries,
    (query) => executeQuery(query, workerDeps),
    config.maxConcurrentWorkers
  );

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Execution run ${runId} exceeded overall timeout of ${config.runTimeoutMs}ms`)),
      config.runTimeoutMs
    );
  });

  let dispatchResults;
  let timedOut = false;

  try {
    dispatchResults = await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    timedOut = true;
    await eventLogger.log('execution.timeout', { runId, error: err.message });
    // Finalize with current counts.
    const durationMs = Date.now() - startedAt;
    await repos.executionRun.finalizeExecutionRun(runId, {
      status: 'failed',
      opportunitiesFound: 0,
      queriesCompleted: 0,
      queriesFailed: queries.length,
      providerStats: {},
      durationMs,
    });
    await eventLogger.log('execution.failed', { runId, reason: 'timeout', durationMs });
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // 5. Aggregate results.
  let opportunitiesFound = 0;
  let queriesCompleted   = 0;
  let queriesFailed      = 0;
  const providerStats    = {};
  const allErrors        = [];

  for (const item of dispatchResults) {
    if (item.error) {
      queriesFailed++;
      allErrors.push({ queryId: item.task?.queryId, error: item.error.message });
    } else {
      const res = item.result;
      queriesCompleted++;
      opportunitiesFound += res.opportunitiesFound || 0;
      allErrors.push(...(res.errors || []));
    }
  }

  // Persist worker-level errors to execution_run.
  for (const err of allErrors) {
    await repos.executionRun.appendExecutionError(runId, {
      ...err,
      timestamp: new Date().toISOString(),
    });
  }

  // Compute per-provider stats from circuit breaker state.
  const cbState = circuitBreakers.getAll();
  for (const [name, state] of Object.entries(cbState)) {
    providerStats[name] = { circuitBreakerState: state.state };
  }

  // 6. Finalize execution_run.
  const durationMs  = Date.now() - startedAt;
  let finalStatus;
  if (queriesCompleted === 0)             finalStatus = 'failed';
  else if (queriesFailed > 0)             finalStatus = 'partial';
  else                                    finalStatus = 'completed';

  await repos.executionRun.finalizeExecutionRun(runId, {
    status: finalStatus,
    opportunitiesFound,
    queriesCompleted,
    queriesFailed,
    providerStats,
    durationMs,
  });

  // 7. Log completion event.
  await eventLogger.log('execution.completed', {
    runId,
    status:             finalStatus,
    opportunitiesFound,
    queriesCompleted,
    queriesFailed,
    durationMs,
  });

  return {
    runId,
    candidateId,
    planId,
    status:             finalStatus,
    opportunitiesFound,
    queriesTotal:       queries.length,
    queriesCompleted,
    queriesFailed,
    durationMs,
    providerStats,
  };
}

module.exports = { executeSearchPlan };
