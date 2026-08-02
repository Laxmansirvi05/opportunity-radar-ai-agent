'use strict';

/**
 * search-planner.js
 *
 * Orchestrates the full CIP → SearchPlan pipeline.
 *
 * Pipeline:
 *   1. Validate CIP input
 *   2. Extract and normalize components from the CIP
 *   3. Build tiered, provider-agnostic query list
 *   4. Assemble versioned SearchPlan object
 *   5. Persist to search_plans table (immutable insert)
 *   6. Return { planId, candidateId, queryCount, planVersion }
 *
 * Design decisions:
 *   - NO LLM calls. The CIP already contains the intelligence (built in Sprint 2).
 *     The planner is a pure transformation: CIP → structured query plan.
 *   - DETERMINISTIC: same CIP always produces the same plan structure.
 *     This is what makes plan regression detection possible.
 *   - PROVIDER-AGNOSTIC: no provider names, routing hints, or API keys
 *     appear in the SearchPlan. The Execution Fabric owns provider selection.
 *   - All DB access is via the Data Plane repository (injected for testability).
 */

require('./config'); // dotenv loaded first

const crypto = require('crypto');
const { normalizeTitles, expandTitleForStage } = require('./normalizers/title-normalizer');
const { prioritizedSkillList, categorizeSkills }  = require('./normalizers/skill-normalizer');
const { normalizeLocations, locationStrings }      = require('./normalizers/location-normalizer');
const { buildAllQueries, buildExclusions }         = require('./query-builder');
const config = require('./config');

// Default repository — loaded lazily so unit tests can inject mocks.
let _searchPlanRepository = null;
function getRepository() {
  if (!_searchPlanRepository) {
    _searchPlanRepository = require('../../data/src/repositories/search-plan-repository');
  }
  return _searchPlanRepository;
}

class SearchPlanError extends Error {
  constructor(code, message, context = {}) {
    super(message);
    this.name  = 'SearchPlanError';
    this.code  = code;
    this.context = context;
  }
}

/**
 * Extract and validate the core fields needed from a CIP.
 * Throws SearchPlanError on invalid input.
 *
 * @param {object} cip  — full CIP object (plan_json from candidates table)
 * @returns {object}    — normalized CIP components
 */
function extractCipComponents(cip) {
  if (!cip || typeof cip !== 'object' || Array.isArray(cip)) {
    throw new SearchPlanError('INPUT_INVALID', 'CIP must be a plain object');
  }
  if (!cip.meta || !cip.literal || !cip.inferred) {
    throw new SearchPlanError('INPUT_INVALID', 'CIP must have meta, literal, and inferred sections');
  }

  // Career stage — CIP v2.0.0: cip.inferred.careerStage.value
  const careerStage = (cip.inferred.careerStage && cip.inferred.careerStage.value) || 'early-career';

  // Skills — CIP v2.0.0: cip.literal.rawSkills (array of plain strings)
  const rawSkills = cip.literal.rawSkills || [];
  // Pass as plain strings; categorizeSkills handles both `{ name, category }` objects and plain strings.
  const skillCats = categorizeSkills(rawSkills);
  const skills    = prioritizedSkillList(rawSkills);

  // Domain skills — CIP v2.0.0: cip.inferred.canonicalSkills where category === 'domain'
  // canonicalSkills shape: [{ canonical, raw, category, confidence }]
  const canonicalSkills = cip.inferred.canonicalSkills || [];
  const domainSkills = canonicalSkills
    .filter((s) => s.category === 'domain')
    .map((s) => s.canonical);

  // Roles from work experience — CIP v2.0.0: cip.literal.experience[].title
  const rawRoles = (cip.literal.experience || []).map((w) => w.title || w.role || '').filter(Boolean);

  // Adjacent roles — CIP v2.0.0: cip.inferred.careerDirection.{ primary, adjacent[] }
  const careerDirection = cip.inferred.careerDirection || {};
  const adjacentRoles = [
    careerDirection.primary,
    ...(careerDirection.adjacent || []),
  ].filter(Boolean);

  // Normalize all roles — pass careerStage so senior titles are preserved for senior candidates.
  const allRoles      = normalizeTitles([...rawRoles, ...adjacentRoles], careerStage);
  const titleVariants = allRoles.length > 0
    ? expandTitleForStage(allRoles[0], careerStage)
    : expandTitleForStage('Software Engineer', careerStage); // safe default

  // Locations from literal or inferred.
  const rawLocations   = (cip.literal.preferredLocations || [])
    .map((l) => (typeof l === 'string' ? l : l.location || l.city || ''))
    .filter(Boolean);
  const normalizedLocs = normalizeLocations(rawLocations);
  const locStrings     = locationStrings(normalizedLocs);

  // Exclusion keywords appropriate for this career stage.
  const exclusions = buildExclusions(careerStage);

  return {
    careerStage,
    skills,
    domainSkills,
    titleVariants,
    adjacentRoles: allRoles,
    normalizedLocations: normalizedLocs,
    locations: locStrings,
    exclusions,
    profileVersion: cip.meta.schemaVersion || '2.0.0',
  };
}


/**
 * Generate a deterministic plan hash from CIP components.
 * Used to detect if re-planning is necessary for the same CIP.
 *
 * @param {object} components
 * @returns {string} — 16-char hex
 */
function computePlanHash(components) {
  const payload = JSON.stringify({
    skills:       components.skills.slice(0, 10),
    adjacentRoles: components.adjacentRoles.slice(0, 5),
    locations:    components.locations,
    careerStage:  components.careerStage,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Build a candidate's Search Plan from their Candidate Intelligence Profile.
 *
 * @param {object} options
 * @param {string} options.candidateId    — UUID of the candidate
 * @param {object} options.cip            — full CIP object (from candidates.profile_json)
 * @param {object} [options.repository]   — injectable for testing (default: searchPlanRepository)
 * @returns {Promise<{
 *   planId: string,
 *   candidateId: string,
 *   queryCount: number,
 *   planVersion: string,
 *   planHash: string
 * }>}
 */
async function buildSearchPlan({ candidateId, cip, repository }) {
  const startedAt = Date.now();

  if (!candidateId || typeof candidateId !== 'string') {
    throw new SearchPlanError('INPUT_INVALID', 'candidateId must be a non-empty string');
  }

  const repo = repository || getRepository();

  // 1. Extract and normalize CIP components.
  const components = extractCipComponents(cip);

  // 2. Build tiered query list.
  const freshness = {
    t1: config.freshnessT1,
    t2: config.freshnessT2,
    t3: config.freshnessT3,
    t4: config.freshnessT4,
  };

  const queries = buildAllQueries({
    titleVariants:      components.titleVariants,
    skills:             components.skills,
    adjacentRoles:      components.adjacentRoles,
    domainSkills:       components.domainSkills,
    locations:          components.locations,
    normalizedLocations: components.normalizedLocations,
    exclusions:         components.exclusions,
    careerStage:        components.careerStage,
    freshness:          freshness.t1,  // default; tier-specific overrides set in builders
  });

  // 3. Assemble the immutable SearchPlan object.
  const planHash = computePlanHash(components);
  const planJson = {
    planVersion:    config.planVersion,
    planHash,
    candidateId,
    profileVersion: components.profileVersion,
    generatedAt:    new Date().toISOString(),
    queries,
    meta: {
      totalQueries:  queries.length,
      tierCounts: {
        1: queries.filter((q) => q.tier === 1).length,
        2: queries.filter((q) => q.tier === 2).length,
        3: queries.filter((q) => q.tier === 3).length,
        4: queries.filter((q) => q.tier === 4).length,
      },
      careerStage:           components.careerStage,
      generationDurationMs:  Date.now() - startedAt,
    },
  };

  // 4. Persist immutably.
  const row = await repo.createSearchPlan({
    candidateId,
    profileVersion: components.profileVersion,
    planVersion:    config.planVersion,
    planJson,
    queryCount:     queries.length,
  });

  return {
    planId:      row.id,
    candidateId,
    queryCount:  queries.length,
    planVersion: config.planVersion,
    planHash,
  };
}

module.exports = { buildSearchPlan, extractCipComponents, computePlanHash, SearchPlanError };
