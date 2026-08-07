'use strict';

/**
 * query-builder.js
 *
 * Assembles tiered, provider-agnostic search query objects from normalized
 * CIP components.
 *
 * Tier taxonomy (FINAL_ARCHITECTURE.md § 16):
 *   Tier 1 — Core canonical skills (high-precision, high-priority)
 *   Tier 2 — Inferred adjacent roles from Career Intelligence Engine
 *   Tier 3 — Career-stage × domain combinations
 *   Tier 4 — Tier-1 queries × geographic scope variations
 *
 * Each query object is provider-agnostic — it contains intelligence signals
 * (roles, skills, keywords, locations, exclusions) but NO provider names,
 * API keys, or routing hints.  The Execution Fabric decides which providers
 * execute each query.
 *
 * DETERMINISTIC — same normalized inputs always produce the same query list.
 */

const crypto = require('crypto');
const config  = require('./config');

/** Generate a deterministic queryId from the query's content. */
function queryId(tier, type, roles, skills) {
  const payload = `${tier}|${type}|${roles.join(',')}|${skills.join(',')}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Build the exclusion keyword list appropriate for a career stage.
 *
 * @param {string} careerStage
 * @returns {string[]}
 */
function buildExclusions(careerStage) {
  const base = ['senior', 'sr.', 'staff', 'principal', 'lead', 'director',
                 'vp', 'head of', 'manager', 'architect', '5+ years', '7+ years',
                 '10+ years', '15+ years'];

  if (careerStage === 'student' || careerStage === 'early-career') {
    return base;
  }
  // Mid-career candidates don't exclude "senior" but still exclude executive tiers.
  return ['director', 'vp', 'head of', 'c-suite', 'cto', 'ceo', '15+ years'];
}

/**
 * Build Tier 1 queries — one per top canonical skill, paired with the
 * candidate's career-stage-expanded title variants.
 *
 * @param {object} params
 * @param {string[]} params.titleVariants   — expanded for career stage
 * @param {string[]} params.skills          — prioritized canonical skills
 * @param {string[]} params.locations       — plain location strings
 * @param {string[]} params.exclusions
 * @param {string}   params.careerStage
 * @param {string}   params.freshness
 * @returns {object[]}
 */
function buildTier1Queries({ titleVariants, skills, locations, exclusions, careerStage, opportunityTarget, freshness }) {
  const queries = [];
  const topSkills = skills.slice(0, config.maxQueriesPerTier);

  // Internships only. careerStage is still accepted so non-student values do not
  // break anything, but it no longer selects a full-time keyword.
  const stageKeyword = 'internship';

  for (const skill of topSkills) {
    const roles    = titleVariants.slice(0, 2); // top 2 title variants per skill
    const keywords = stageKeyword
      ? [skill, ...roles.slice(0, 1), stageKeyword]
      : [skill, ...roles.slice(0, 1)];
    queries.push({
      queryId:    queryId(1, 'core_skill', roles, [skill]),
      tier:       1,
      type:       'core_skill',
      roles,
      skills:     [skill],
      locations,
      keywords:   [...new Set(keywords)],
      exclusions,
      priority:   'high',
      freshness,
    });
  }

  return queries;
}

/**
 * Build Tier 2 queries — one per inferred adjacent role.
 *
 * @param {object} params
 * @param {string[]} params.adjacentRoles   — from CIP inferred.careerTrajectory
 * @param {string[]} params.skills          — top technical skills
 * @param {string[]} params.locations
 * @param {string[]} params.exclusions
 * @param {string}   params.careerStage
 * @param {string}   params.freshness
 * @returns {object[]}
 */
function buildTier2Queries({ adjacentRoles, skills, locations, exclusions, opportunityTarget, freshness }) {
  const queries  = [];
  const topRoles = adjacentRoles.slice(0, config.maxQueriesPerTier);
  const topSkills = skills.slice(0, 3);
  const suffix    = 'Intern'; // internships only

  for (const role of topRoles) {
    const displayRole = suffix ? `${role} ${suffix}` : role;
    const keywords = [role, ...topSkills.slice(0, 2)];
    queries.push({
      queryId:    queryId(2, 'adjacent_role', [role], topSkills),
      tier:       2,
      type:       'adjacent_role',
      roles:      [displayRole],
      skills:     topSkills,
      locations,
      keywords:   [...new Set(keywords)],
      exclusions,
      priority:   'medium',
      freshness,
    });
  }

  return queries;
}

/**
 * Build Tier 3 queries — career-stage × domain combinations.
 * These are broader discovery queries that surface opportunities the
 * candidate may not have explicitly thought of.
 *
 * @param {object} params
 * @param {string[]} params.domainSkills    — from CIP literal.skills where category='domain'
 * @param {string[]} params.titleVariants
 * @param {string[]} params.locations
 * @param {string[]} params.exclusions
 * @param {string}   params.careerStage
 * @param {string}   params.freshness
 * @returns {object[]}
 */
function buildTier3Queries({ domainSkills, titleVariants, locations, exclusions, careerStage, opportunityTarget, freshness }) {
  const queries = [];

  // Internships only — no 'new grad' / full-time discovery words.
  const stageWord = 'internship';

  const domains = domainSkills.slice(0, config.maxQueriesPerTier);

  for (const domain of domains) {
    const keywords = stageWord
      ? [domain, stageWord, ...titleVariants.slice(0, 1)]
      : [domain, ...titleVariants.slice(0, 1)];
    queries.push({
      queryId:    queryId(3, 'domain_stage', titleVariants.slice(0, 1), [domain]),
      tier:       3,
      type:       'domain_stage',
      roles:      titleVariants.slice(0, 2),
      skills:     [domain],
      locations,
      keywords:   [...new Set(keywords)],
      exclusions,
      priority:   'medium',
      freshness,
    });
  }

  return queries;
}

/**
 * Build Tier 4 queries — geographic scope variations of the top Tier 1 queries.
 * Ensures discovery breadth across local/national/remote tiers.
 *
 * @param {object} params
 * @param {object[]} params.tier1Queries      — already-built Tier 1 queries
 * @param {Array<{location:string,tier:string}>} params.normalizedLocations
 * @param {string}   params.freshness
 * @returns {object[]}
 */
function buildTier4Queries({ tier1Queries, normalizedLocations, freshness }) {
  const queries = [];
  // Take only the top 2 Tier 1 queries for geographic expansion (avoid combinatorial explosion).
  const seedQueries = tier1Queries.slice(0, 2);

  for (const seed of seedQueries) {
    for (const loc of normalizedLocations) {
      // Skip if this location is already in the seed query.
      if (seed.locations.some((l) => l.toLowerCase() === loc.location.toLowerCase())) continue;

      queries.push({
        queryId:    queryId(4, `geo_${loc.tier}`, seed.roles, seed.skills),
        tier:       4,
        type:       `geo_${loc.tier}`,
        roles:      seed.roles,
        skills:     seed.skills,
        locations:  [loc.location],
        keywords:   [...seed.keywords, loc.location],
        exclusions: seed.exclusions,
        priority:   'low',
        freshness,
      });
    }
  }

  return queries;
}

/**
 * Assemble the complete, deduplicated query list from all four tiers.
 * Enforces maxTotalQueries cap.
 *
 * @param {object} params
 * @returns {object[]}
 */
function buildAllQueries(params) {
  const t1 = buildTier1Queries(params);
  const t2 = buildTier2Queries(params);
  const t3 = buildTier3Queries(params);
  const t4 = buildTier4Queries({ tier1Queries: t1, ...params });

  // Deduplicate by queryId across tiers.
  const seen = new Set();
  const all  = [];

  for (const q of [...t1, ...t2, ...t3, ...t4]) {
    if (!seen.has(q.queryId)) {
      seen.add(q.queryId);
      all.push(q);
      if (all.length >= config.maxTotalQueries) break;
    }
  }

  return all;
}

module.exports = { buildAllQueries, buildTier1Queries, buildTier2Queries, buildTier3Queries, buildTier4Queries, buildExclusions };
