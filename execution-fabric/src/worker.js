'use strict';

/**
 * worker.js
 *
 * Executes a single search query through the Provider Abstraction Layer.
 *
 * Flow per query:
 *   1. Select providers via registry (never directly imports adapters)
 *   2. For each provider:
 *      a. Check circuit breaker — skip OPEN providers
 *      b. Check rate limit — skip if exhausted
 *      c. Execute with retry policy
 *      d. For each result: validate → persist opportunity + dedup signature
 *      e. Update circuit breaker state
 *      f. Emit lifecycle events
 *   3. Return WorkerResult { queryId, opportunitiesFound, providersAttempted, errors }
 *
 * All SQL access goes through injected repositories (no SQL in this file).
 * Providers are injected via the registry parameter for testability.
 * The event logger is injected for testability.
 */

const retryPolicy = require('./retry-policy');
const { validate } = require('./validator');

/**
 * Execute a single search query.
 *
 * @param {object} query              — from SearchPlan.queries[]
 * @param {object} deps               — all injectable dependencies
 * @param {object} deps.config
 * @param {object} deps.circuitBreakers   — circuit breaker registry (createRegistry())
 * @param {object} deps.rateLimiter       — { check(domain): Promise<{allowed, remaining}> }
 * @param {object} deps.providerRegistry  — { select(query, config): adapter[] }
 * @param {object} deps.opportunityRepo   — opportunity-repository
 * @param {object} deps.dedupRepo         — dedup-repository
 * @param {object} deps.eventLogger       — { log, logAsync }
 * @param {string} deps.runId
 * @returns {Promise<{
 *   queryId: string,
 *   opportunitiesFound: number,
 *   providersAttempted: number,
 *   errors: object[]
 * }>}
 */
async function executeQuery(query, deps) {
  const { config, circuitBreakers, rateLimiter, providerRegistry,
          opportunityRepo, dedupRepo, eventLogger, runId } = deps;

  let opportunitiesFound = 0;
  let providersAttempted = 0;
  const errors = [];

  eventLogger.logAsync('execution.worker.started', { queryId: query.queryId, tier: query.tier });

  // Select providers that support this query.
  const providers = providerRegistry.select(query, config);

  if (providers.length === 0) {
    eventLogger.logAsync('execution.worker.completed', {
      queryId: query.queryId,
      reason:  'no_providers',
      opportunitiesFound: 0,
    });
    return { queryId: query.queryId, opportunitiesFound: 0, providersAttempted: 0, errors: [] };
  }

  for (const provider of providers) {
    const cb = circuitBreakers.get(provider.name);

    // Circuit breaker check.
    if (!cb.allowRequest()) {
      eventLogger.logAsync('execution.circuit_breaker.opened', {
        queryId:  query.queryId,
        provider: provider.name,
        state:    cb.state,
      });
      continue;
    }

    // Rate limit check (per provider name as domain key).
    const rateResult = await rateLimiter.check(provider.name);
    if (!rateResult.allowed) {
      eventLogger.logAsync('execution.provider.failure', {
        queryId:  query.queryId,
        provider: provider.name,
        reason:   'rate_limited',
      });
      errors.push({ queryId: query.queryId, provider: provider.name, reason: 'rate_limited' });
      continue;
    }

    providersAttempted++;
    eventLogger.logAsync('execution.provider.selected', {
      queryId:  query.queryId,
      provider: provider.name,
    });

    // Execute with retry.
    let rawResults = [];
    try {
      eventLogger.logAsync('execution.provider.request', {
        queryId:  query.queryId,
        provider: provider.name,
      });

      rawResults = await retryPolicy.execute(
        () => provider.execute(query, { config }),
        {
          maxAttempts:  config.maxRetryAttempts,
          baseDelayMs:  config.retryBaseDelayMs,
          onRetry:      (attempt, err, delayMs) => {
            eventLogger.logAsync('execution.retry.triggered', {
              queryId:  query.queryId,
              provider: provider.name,
              attempt,
              error:    err.message,
              delayMs,
            });
          },
        }
      );

      const transition = cb.recordSuccess();
      if (transition) {
        eventLogger.logAsync('execution.circuit_breaker.closed', {
          provider: provider.name,
          from:     transition.from,
          to:       transition.to,
        });
      }

      eventLogger.logAsync('execution.provider.success', {
        queryId:       query.queryId,
        provider:      provider.name,
        rawResultCount: rawResults.length,
      });

    } catch (err) {
      const transition = cb.recordFailure();
      if (transition) {
        eventLogger.logAsync('execution.circuit_breaker.opened', {
          provider: provider.name,
          from:     transition.from,
          to:       transition.to,
        });
      }

      eventLogger.logAsync('execution.provider.failure', {
        queryId:  query.queryId,
        provider: provider.name,
        error:    err.message,
        code:     err.code || err.statusCode,
      });

      errors.push({
        queryId:  query.queryId,
        provider: provider.name,
        error:    err.message,
        code:     err.code || err.statusCode,
        timestamp: new Date().toISOString(),
      });
      continue; // One provider failure does not fail the worker.
    }

    // Validate and persist each result.
    for (const raw of rawResults) {
      const validation = await validate(raw, dedupRepo);

      if (!validation.valid) {
        if (validation.code !== 'DUPLICATE') {
          // Log non-duplicate validation failures (duplicates are expected and not noteworthy).
          eventLogger.logAsync('execution.validation.failed', {
            queryId:  query.queryId,
            provider: provider.name,
            code:     validation.code,
            reason:   validation.reason,
          });
        }
        continue;
      }

      // Persist opportunity and dedup signature.
      try {
        const { id: opportunityId, isNew } = await opportunityRepo.upsertOpportunity({
          sourceUrl:      raw.sourceUrl,
          sourceTier:     ['A', 'B', 'C', 'D'][query.tier - 1] || 'C',
          contentHash:    validation.contentHash,
          title:          validation.opportunity.title,
          company:        validation.opportunity.company,
          location:       validation.opportunity.location,
          workplaceType:  validation.opportunity.workplaceType,
          employmentType: validation.opportunity.employmentType,
          description:    validation.opportunity.description,
          requirements:   validation.opportunity.requirements,
          skills:         validation.opportunity.skills,
          applyUrl:       validation.opportunity.applicationUrl,
          deadline:       validation.opportunity.deadline,
          rawJson:        raw.rawJson || raw,
        });

        if (isNew) {
          await dedupRepo.insertSignature(opportunityId, validation.contentHash);
          opportunitiesFound++;
          eventLogger.logAsync('execution.opportunity.stored', {
            queryId:       query.queryId,
            provider:      provider.name,
            opportunityId,
            title:         validation.opportunity.title,
            company:       validation.opportunity.company,
          });
        }
      } catch (persistErr) {
        // Persistence error: log and continue — don't fail the entire worker.
        errors.push({
          queryId:   query.queryId,
          provider:  provider.name,
          error:     persistErr.message,
          phase:     'persist',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  eventLogger.logAsync('execution.worker.completed', {
    queryId:            query.queryId,
    opportunitiesFound,
    providersAttempted,
    errorCount:         errors.length,
  });

  return { queryId: query.queryId, opportunitiesFound, providersAttempted, errors };
}

module.exports = { executeQuery };
