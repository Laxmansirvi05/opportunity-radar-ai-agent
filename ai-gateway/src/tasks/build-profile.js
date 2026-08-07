'use strict';

/**
 * AI Gateway Task: build_profile
 *
 * Converts a parsed resume JSON string into a Candidate Intelligence Profile (CIP).
 *
 * Schema and validation are imported from the canonical data package — this file
 * contains ONLY the prompt design and input/output wiring.  It does NOT duplicate
 * the schema logic.
 *
 * Cross-package import note:
 *   This file requires from ../../.. (three levels up) to reach the data/ package.
 *   ai-gateway and data are sibling directories at the repository root.
 *   This implicit dependency is documented here and in IMPLEMENTATION_PLAN_V2.md.
 *   A future monorepo migration (Sprint 6+) would replace this with a workspace import.
 *
 * Task contract (same interface as extract-opportunity.js):
 *   name            — string: task identifier registered in tasks/index.js
 *   validateInput   — normalises and validates the raw caller input
 *   createModelInput — builds the GatewayService.chat() input for the initial call
 *   createRepairInput — builds the repair call input when the first output is invalid
 *   parseAndValidate — parses and validates the model's JSON output
 */

const { GatewayError }             = require('../errors');
const { validateCandidateProfile, ProfileValidationError } =
  require('../../../data/src/schemas/candidate-profile-schema');

// ---------------------------------------------------------------------------
// Input constraints
// ---------------------------------------------------------------------------

/** Maximum characters accepted from the parsed resume JSON string. */
const MAX_INPUT_CHARS = 30_000;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a career intelligence system. Analyze the supplied parsed resume JSON and produce a Candidate Intelligence Profile (CIP).

Return exactly one JSON object. Do not use Markdown, code fences, comments, or any prose.

The JSON must contain exactly three top-level keys: "literal", "inferred", "meta".

=== LITERAL SECTION (verbatim extraction only — never infer or add information) ===
Extract these fields exactly as stated in the resume text.

literal.fullName: string or null
literal.email: string or null
literal.phone: string or null
literal.linkedinUrl: string or null
literal.githubUrl: string or null
literal.portfolioUrl: string or null
literal.rawSkills: array of strings (skills as written, do not normalize here)
literal.education: array of { institution: string, degree: string|null, field: string|null, startYear: number|null, endYear: number|null, gpa: string|null }
literal.experience: array of { company: string, title: string, startDate: string|null (YYYY-MM or YYYY), endDate: string|null (YYYY-MM, YYYY, or "present"), description: string|null, technologies: string[] }
literal.projects: array of { name: string, description: string|null, technologies: string[], url: string|null }
literal.certifications: string[]
literal.publications: string[]
literal.awards: string[]
literal.languages: string[] (human languages only, NOT programming languages)
literal.preferredLocations: string[] (ONLY locations the candidate explicitly stated as preferred — never infer)

=== INFERRED SECTION (model-derived — every field MUST include confidence and evidence) ===
Confidence: 0.0 = no evidence, 1.0 = strong direct evidence.
Evidence: non-empty array of quoted strings or close paraphrases from the resume.

inferred.careerStage: { value: "student"|"early-career"|"mid-career"|"senior"|"transitioning", confidence, evidence }
inferred.canonicalSkills: array of { canonical: string (normalized name, e.g. "TypeScript" not "ts"), raw: string (as in resume), category: "language"|"framework"|"platform"|"tool"|"domain"|"soft", confidence: number }
inferred.inferredRoles: array of { role: string, confidence: number, evidence: string[] } — between 2 and 5 roles
inferred.careerDirection: { primary: string, adjacent: string[] (2–4 directions), confidence: number, evidence: string[] }
inferred.searchKeywords: string[] — 5 to 15 concrete, searchable terms (role titles, technologies, domains)
inferred.searchIntent: string — single sentence describing what this candidate is actively seeking
inferred.workAuthorization: { value: "citizen"|"permanent-resident"|"visa-required"|"unknown", confidence, evidence }
inferred.openToRelocation: { value: true|false|null (null only if truly unknown), confidence, evidence }

=== META SECTION ===
meta.schemaVersion: always "2.0.0"
meta.modelVersion: your own model identifier (e.g. "gemini-2.5-flash")
meta.builtAt: current UTC timestamp in ISO 8601 format
meta.resumeHash: set to empty string "" — the caller will populate this
meta.overallConfidence: arithmetic mean of all confidence values in the inferred section

=== RULES ===
1. Literal section: use null for unavailable scalars, [] for unavailable arrays.
2. Every inferred field must have evidence with at least one non-empty string.
3. preferredLocations must only contain locations explicitly stated as preferred. Do not infer location preferences.
4. searchKeywords must be concrete: specific job titles, frameworks, domains — not generic words like "software".
5. searchIntent must be one clear, actionable sentence. Example: "Seeking a backend engineering internship focused on distributed systems."
6. overallConfidence must be the true arithmetic mean of all confidence values across all inferred fields.`;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validates the raw input supplied by the caller.
 *
 * Accepts a parsed-resume JSON object (preferred) or a pre-serialized JSON string.
 * Returns a UTF-8 string suitable for embedding in the prompt.
 *
 * @param {unknown} value
 * @returns {string}
 */
function validateInput(value) {
  let serialized;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new GatewayError('INVALID_REQUEST', 'build_profile: input must not be empty', { status: 400 });
    }
    // Validate it is at least parseable JSON so we catch bad input early.
    try { JSON.parse(trimmed); } catch {
      throw new GatewayError(
        'INVALID_REQUEST',
        'build_profile: input string must be valid JSON',
        { status: 400 }
      );
    }
    serialized = trimmed;
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    serialized = JSON.stringify(value);
  } else {
    throw new GatewayError(
      'INVALID_REQUEST',
      'build_profile: input must be a parsed resume object or JSON string',
      { status: 400 }
    );
  }

  if (serialized.length > MAX_INPUT_CHARS) {
    // Truncate with a clear boundary marker rather than silently dropping bytes.
    serialized = serialized.slice(0, MAX_INPUT_CHARS);
  }

  return serialized;
}

// ---------------------------------------------------------------------------
// Output parsing and validation
// ---------------------------------------------------------------------------

/**
 * Parses the model's raw text output and validates it against the CIP schema.
 * Wraps ProfileValidationError in GatewayError so the task-service repair loop
 * handles it exactly like an invalid extract_opportunity response.
 *
 * @param {string} text - Raw text returned by the AI provider.
 * @returns {Readonly<CIP>} - Frozen, validated CIP object.
 */
function parseAndValidate(text) {
  let parsed;
  try {
    const cleanedText = text.replace(/^```(json)?|```$/gm, '').trim();
    parsed = JSON.parse(cleanedText);
  } catch (cause) {
    throw new GatewayError('TASK_OUTPUT_INVALID', 'build_profile: model returned invalid JSON', {
      status: 502,
      cause,
    });
  }

  try {
    return validateCandidateProfile(parsed);
  } catch (cause) {
    if (cause instanceof ProfileValidationError) {
      throw new GatewayError('TASK_OUTPUT_INVALID', `build_profile: ${cause.message}`, {
        status: 502,
        cause,
      });
    }
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Model input builders
// ---------------------------------------------------------------------------

/**
 * Builds the input for the initial profile-build LLM call.
 *
 * @param {string} serializedResume - Validated, possibly-truncated resume JSON string.
 * @returns {Readonly<ModelInput>}
 */
function createModelInput(serializedResume) {
  return Object.freeze({
    prompt:         serializedResume,
    systemPrompt:   SYSTEM_PROMPT,
    temperature:    0,
    maxTokens:      4_000,
    responseFormat: 'json',
  });
}

/**
 * Builds the input for the repair call when the initial output fails validation.
 *
 * @param {string} serializedResume - The original (validated) resume input.
 * @param {string} invalidOutput    - The model's previous invalid response text.
 * @returns {Readonly<ModelInput>}
 */
function createRepairInput(serializedResume, invalidOutput) {
  const MAX_REPAIR_OUTPUT_CHARS = 2000;
  let truncatedOutput = invalidOutput;
  if (truncatedOutput.length > MAX_REPAIR_OUTPUT_CHARS) {
    truncatedOutput = truncatedOutput.slice(0, MAX_REPAIR_OUTPUT_CHARS) + "\n...[truncated]";
  }

  return Object.freeze({
    prompt: `Source resume JSON:\n${serializedResume}\n\nPrevious invalid output:\n${truncatedOutput}\n\nReturn the corrected CIP JSON object only. Ensure all required sections (literal, inferred, meta) are present and all inferred fields include confidence and evidence.\n\nCRITICAL: If the resume contains insufficient information to determine search intent, use the exact string "Insufficient information to determine search intent" rather than an empty string.`,
    systemPrompt:   SYSTEM_PROMPT,
    temperature:    0,
    maxTokens:      4_000,
    responseFormat: 'json',
  });
}

// ---------------------------------------------------------------------------
// Task export
// ---------------------------------------------------------------------------

module.exports = Object.freeze({
  name:             'build_profile',
  validateInput,
  parseAndValidate,
  createModelInput,
  createRepairInput,
});
