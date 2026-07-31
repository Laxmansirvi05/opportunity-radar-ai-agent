'use strict';

/**
 * Profile Builder — Core Orchestration
 *
 * Implements the full pipeline:
 *   Input Validation → SHA-256 Resume Hash → AI Gateway → Schema Validation
 *   → Confidence Validation → CandidateRepository.upsert() → PostgreSQL → Response
 *
 * Design:
 *   - Stateless: no module-level mutable state.
 *   - Dependencies are injected via the options argument so unit tests can
 *     supply mocks without monkey-patching module resolution.
 *   - Every build emits structured log lines (AC-09):
 *       candidateId, profileVersion, processingTimeMs, aiProvider,
 *       retryCount, validationResult, failureReason.
 *   - ProfileBuildError carries a structured `context` object so callers
 *     can inspect failure details without parsing message strings.
 */

const { createHash }            = require('node:crypto');
const { callBuildProfile, GatewayClientError }  = require('./gateway-client');
const { validateCandidateProfile, ProfileValidationError, SCHEMA_VERSION } =
  require('../../data/src/schemas/candidate-profile-schema');
const { upsertCandidate }       = require('../../data/src/repositories/candidate-repository');

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

class ProfileBuildError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: Error, context?: Object }} [options]
   */
  constructor(code, message, { cause, context } = {}) {
    super(message, { cause });
    this.name    = 'ProfileBuildError';
    this.code    = code;
    this.context = context ?? {};
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const MAX_INPUT_BYTES = 200_000; // 200 KB — guard against enormous resumes

/**
 * Normalises raw input into a plain object.  Accepts:
 *   - A plain object  (preferred)
 *   - A JSON string   (accepted for convenience)
 *
 * @param {unknown} rawResume
 * @returns {Object} Plain parsed-resume object.
 * @throws {ProfileBuildError} On invalid input.
 */
function normaliseInput(rawResume) {
  let obj;

  if (rawResume !== null && typeof rawResume === 'object' && !Array.isArray(rawResume)) {
    obj = rawResume;
  } else if (typeof rawResume === 'string') {
    if (rawResume.trim() === '') {
      throw new ProfileBuildError('INVALID_INPUT', 'Parsed resume must not be empty');
    }
    try {
      obj = JSON.parse(rawResume);
    } catch (cause) {
      throw new ProfileBuildError('INVALID_INPUT', 'Parsed resume string is not valid JSON', { cause });
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new ProfileBuildError('INVALID_INPUT', 'Parsed resume JSON must be an object, not an array or primitive');
    }
  } else {
    throw new ProfileBuildError(
      'INVALID_INPUT',
      'Parsed resume must be a plain object or a JSON string'
    );
  }

  const serialized = JSON.stringify(obj);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) {
    throw new ProfileBuildError(
      'INVALID_INPUT',
      `Parsed resume exceeds maximum size of ${MAX_INPUT_BYTES} bytes`
    );
  }

  return obj;
}

// ---------------------------------------------------------------------------
// Resume hash
// ---------------------------------------------------------------------------

/**
 * Computes the canonical SHA-256 dedup key for a parsed resume.
 * The resume object is JSON-stringified with sorted keys so that
 * equivalent objects that differ only in key order produce the same hash.
 *
 * @param {Object} resumeObj
 * @returns {string} 64-character hex string.
 */
function computeResumeHash(resumeObj) {
  const canonical = JSON.stringify(resumeObj, Object.keys(resumeObj).sort());
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Secondary validation (belt-and-suspenders on AI output)
// ---------------------------------------------------------------------------

/**
 * Re-validates the CIP returned by the Gateway.
 *
 * The Gateway task already validates this on the AI side, but we validate
 * again here because:
 *   1. The Gateway response could (in theory) be tampered or misconfigured.
 *   2. This check runs against the same canonical schema, ensuring any
 *      future schema divergence is caught before writing to the database.
 *
 * @param {Object} cip - CIP object from gateway response.
 * @returns {Readonly<CIP>}
 * @throws {ProfileBuildError} If the CIP fails secondary validation.
 */
function secondaryValidate(cip) {
  try {
    return validateCandidateProfile(cip);
  } catch (cause) {
    if (cause instanceof ProfileValidationError) {
      throw new ProfileBuildError(
        'CIP_VALIDATION_FAILED',
        `Profile returned by Gateway failed secondary validation: ${cause.message}`,
        { cause }
      );
    }
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Builds a Candidate Intelligence Profile from a parsed resume.
 *
 * @param {Object | string} parsedResume
 *   The structured resume data produced by the resume parser.
 *   Accepts a plain object or a JSON string.
 *
 * @param {Object} [options={}]
 *   @param {Object}   [options.config]           - Gateway config. Defaults to module-level config.
 *   @param {Function} [options.gatewayCall]       - Injectable gateway call function (for testing).
 *   @param {Function} [options.repositoryUpsert]  - Injectable upsert function (for testing).
 *   @param {Object}   [options.logger]            - Logger with .info() / .warn() / .error().
 *
 * @returns {Promise<{
 *   candidateId:      string,
 *   resumeHash:       string,
 *   profileVersion:   string,
 *   processingTimeMs: number,
 * }>}
 *
 * @throws {ProfileBuildError} On validation failure, gateway failure, or DB failure.
 */
async function buildProfile(parsedResume, {
  config         = null,
  gatewayCall    = callBuildProfile,
  repositoryUpsert = upsertCandidate,
  logger         = console,
} = {}) {
  const startMs = Date.now();
  let resumeHash = null;

  // Lazily load config (allows tests to skip config loading entirely).
  const resolvedConfig = config ?? (() => {
    const { loadConfig } = require('./config');
    return loadConfig();
  })();

  // ── Step 1: Validate and normalise input ───────────────────────────────────
  let resumeObj;
  try {
    resumeObj = normaliseInput(parsedResume);
  } catch (cause) {
    _log(logger, 'error', 'profile_build_failed', {
      resumeHash:       null,
      profileVersion:   SCHEMA_VERSION,
      processingTimeMs: Date.now() - startMs,
      aiProvider:       null,
      retryCount:       0,
      validationResult: 'INPUT_INVALID',
      failureReason:    cause.message,
    });
    throw cause;
  }

  // ── Step 2: Compute resume hash (dedup key) ────────────────────────────────
  resumeHash = computeResumeHash(resumeObj);

  // ── Step 3: Call AI Gateway ────────────────────────────────────────────────
  let gatewayResult;
  try {
    gatewayResult = await gatewayCall(resumeObj, {
      baseUrl:   resolvedConfig.gatewayBaseUrl,
      apiKey:    resolvedConfig.gatewayApiKey,
      timeoutMs: 90_000,
    });
  } catch (cause) {
    const code = cause instanceof GatewayClientError ? cause.code : 'GATEWAY_ERROR';
    _log(logger, 'error', 'profile_build_failed', {
      resumeHash,
      profileVersion:   SCHEMA_VERSION,
      processingTimeMs: Date.now() - startMs,
      aiProvider:       'ai-gateway',
      retryCount:       0,
      validationResult: 'GATEWAY_FAILED',
      failureReason:    cause.message,
    });
    throw new ProfileBuildError(code, `AI Gateway call failed: ${cause.message}`, { cause });
  }

  // ── Step 4: Secondary schema validation ───────────────────────────────────
  let validatedCip;
  try {
    validatedCip = secondaryValidate(gatewayResult.data);
  } catch (cause) {
    _log(logger, 'error', 'profile_build_failed', {
      resumeHash,
      profileVersion:   SCHEMA_VERSION,
      processingTimeMs: Date.now() - startMs,
      aiProvider:       'ai-gateway',
      retryCount:       0,
      validationResult: 'SCHEMA_INVALID',
      failureReason:    cause.message,
    });
    throw cause;
  }

  // Stamp the resume hash into the meta section (model leaves this as '').
  const cipWithHash = {
    ...validatedCip,
    meta: { ...validatedCip.meta, resumeHash },
  };

  // ── Step 5: Persist to candidates table ───────────────────────────────────
  let row;
  try {
    row = await repositoryUpsert({
      resumeHash,
      profileJson:          cipWithHash,
      careerStage:          validatedCip.inferred.careerStage.value,
      profileSchemaVersion: SCHEMA_VERSION,
      profileModelVersion:  validatedCip.meta.modelVersion,
    });
  } catch (cause) {
    _log(logger, 'error', 'profile_build_failed', {
      resumeHash,
      profileVersion:   SCHEMA_VERSION,
      processingTimeMs: Date.now() - startMs,
      aiProvider:       'ai-gateway',
      retryCount:       0,
      validationResult: 'DB_WRITE_FAILED',
      failureReason:    cause.message,
    });
    throw new ProfileBuildError('DB_WRITE_FAILED', `Failed to persist candidate profile: ${cause.message}`, { cause });
  }

  // ── Step 6: Emit success log (AC-09) ──────────────────────────────────────
  const processingTimeMs = Date.now() - startMs;
  _log(logger, 'info', 'profile_build_succeeded', {
    candidateId:      row.id,
    resumeHash,
    profileVersion:   SCHEMA_VERSION,
    processingTimeMs,
    aiProvider:       'ai-gateway',
    retryCount:       0,
    validationResult: 'OK',
    failureReason:    null,
  });

  return {
    candidateId:      row.id,
    resumeHash,
    profileVersion:   SCHEMA_VERSION,
    processingTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Structured logger helper
// ---------------------------------------------------------------------------

function _log(logger, level, event, fields) {
  const entry = {
    timestamp: new Date().toISOString(),
    service:   'profile-builder',
    event,
    ...fields,
  };
  if (typeof logger[level] === 'function') {
    logger[level](JSON.stringify(entry));
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { buildProfile, ProfileBuildError, computeResumeHash };
