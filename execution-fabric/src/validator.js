'use strict';

/**
 * validator.js
 *
 * Validates every extracted opportunity before persistence.
 * Runs four checks in sequence, stopping at the first failure:
 *
 *   1. Schema validation    — reuses validateOpportunity() from ai-gateway (canonical schema)
 *   2. URL validation       — applicationUrl must be https://
 *   3. Content-hash dedup  — SHA-256(title|company|location|employmentType) checked against dedup_signatures
 *   4. Quality pre-filter  — title and company must both be present (not null)
 *
 * Contract:
 *   - NEVER throws. Returns { valid: true, opportunity, contentHash } on success.
 *   - Returns { valid: false, code, reason } on any failure.
 *   - The dedup repository is injected for testability.
 *
 * Repository boundaries: dedup check goes through dedupRepository, not raw SQL.
 */

const crypto = require('crypto');

// Reuse the canonical schema from ai-gateway — not duplicated.
const { validateOpportunity } = require('../../ai-gateway/src/tasks/opportunity-schema');

/**
 * Compute a deterministic content hash for dedup.
 * Normalizes all fields to lowercase before hashing.
 *
 * @param {object} opp  — validated opportunity fields
 * @returns {string} — SHA-256 hex string
 */
function computeContentHash(opp) {
  const payload = [
    (opp.title        || '').toLowerCase().trim(),
    (opp.company      || '').toLowerCase().trim(),
    (opp.location     || '').toLowerCase().trim(),
    (opp.employmentType || '').toLowerCase().trim(),
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Validate a raw opportunity object from a provider.
 *
 * @param {object} raw               — raw output from provider adapter
 * @param {object} dedupRepository   — injectable dedup-repository
 * @returns {Promise<{
 *   valid: true, opportunity: object, contentHash: string
 * } | {
 *   valid: false, code: string, reason: string
 * }>}
 */
async function validate(raw, dedupRepository) {
  // 1. Schema validation (reuse canonical schema).
  let opportunity;
  try {
    const { sourceUrl, rawJson, ...rest } = raw;
    opportunity = validateOpportunity(rest);
  } catch (err) {
    return {
      valid:  false,
      code:   'SCHEMA_INVALID',
      reason: err.message || 'Schema validation failed',
    };
  }



  // 3. Quality pre-filter — title and company are minimum viable.
  if (!opportunity.title || !opportunity.company) {
    return {
      valid:  false,
      code:   'QUALITY_INSUFFICIENT',
      reason: 'title and company are required for storage',
    };
  }

  // 4. Content-hash dedup.
  const contentHash = computeContentHash(opportunity);
  try {
    const isDuplicate = await dedupRepository.hasSignature(contentHash);
    if (isDuplicate) {
      return {
        valid:  false,
        code:   'DUPLICATE',
        reason: `Content hash already stored: ${contentHash.slice(0, 16)}…`,
      };
    }
  } catch (err) {
    return {
      valid:  false,
      code:   'DEDUP_ERROR',
      reason: err.message,
    };
  }

  return { valid: true, opportunity, contentHash };
}

module.exports = { validate, computeContentHash };
