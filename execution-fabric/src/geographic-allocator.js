'use strict';

const { resolveCountry } = require('./geo-resolver');

/**
 * Enforces PDF §6 Geographic Allocator Rules:
 * - Minimum 75% of the final array must be in the `candidateCountry` or explicitly `remote`.
 * - "Yields down the list" to enforce this, meaning if we reach the quota of international roles,
 *   we drop subsequent international roles in favor of lower-ranked local ones.
 * 
 * @param {string} candidateCountry - e.g. "India", "US"
 * @param {Array<Object>} rankedOpportunities - Sorted array of opportunities from highest to lowest rank.
 * @param {number} limit - Maximum number of opportunities to return in the final slice (e.g. 20)
 * @returns {Array<Object>} The allocated slice of opportunities respecting the geographic quota.
 */
function allocateGeography(candidateCountry, rankedOpportunities, limit = 20) {
  if (!rankedOpportunities || rankedOpportunities.length === 0) return [];
  
  const finalSet = [];
  const MAX_INTERNATIONAL = Math.floor(limit * 0.25); // At most 25% international
  
  let internationalCount = 0;

  for (const opp of rankedOpportunities) {
    if (finalSet.length >= limit) break;

    // Use our resolver if location country isn't already extracted
    const oppCountry = opp.country || resolveCountry(opp.location);

    const isLocal = (oppCountry === candidateCountry);
    const isRemote = (oppCountry === 'remote');

    if (isLocal || isRemote) {
      finalSet.push(opp);
    } else {
      if (internationalCount < MAX_INTERNATIONAL) {
        finalSet.push(opp);
        internationalCount++;
      } else {
        // Skip this opportunity to preserve the 75% local/remote quota
        continue;
      }
    }
  }

  return finalSet;
}

module.exports = { allocateGeography };
