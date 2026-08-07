const { GatewayError } = require("../errors");

const SYSTEM_PROMPT = `You are an expert technical recruiter evaluating an opportunity against a candidate profile.
Return exactly one JSON object and nothing else. Do not use Markdown, code fences, commentary, or prose.
The object must contain exactly these fields:
- fit_score: an integer from 0 to 100.
- reasoning: a single specific sentence explaining the score.
- missing_requirements: an array of strings (skills/quals the candidate lacks).

Scoring rules:
- Prioritize internships and entry-level roles for students (especially 3rd/4th year).
- Heavily penalize senior roles (requiring 3+ years experience) if the candidate is a student or entry-level.
- Do not reward roles simply for having long or well-written descriptions.
- Base the score on deep semantic match of skills and experience depth.`;

function validateInput(value) {
  if (!value || typeof value !== "object" || !value.candidate || !value.opportunity) {
    throw new GatewayError("INVALID_REQUEST", "input must be an object with 'candidate' and 'opportunity' fields", { status: 400 });
  }
  return value;
}

function parseAndValidate(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(cleaned.substring(start, end + 1));
      } catch (e) {
        throw new GatewayError("TASK_OUTPUT_INVALID", "Task returned invalid JSON", { status: 502, cause });
      }
    } else {
      throw new GatewayError("TASK_OUTPUT_INVALID", "Task returned invalid JSON", { status: 502, cause });
    }
  }

  if (typeof parsed.fit_score !== "number" || typeof parsed.reasoning !== "string" || !Array.isArray(parsed.missing_requirements)) {
    throw new GatewayError("TASK_OUTPUT_INVALID", "Task returned JSON but missing required fields", { status: 502 });
  }

  return parsed;
}

function createModelInput(input) {
  return Object.freeze({
    prompt: `Candidate:\n${JSON.stringify(input.candidate, null, 2)}\n\nOpportunity:\n${JSON.stringify(input.opportunity, null, 2)}`,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 1000,
    responseFormat: "json",
    timeoutMs: 15000
  });
}

function createRepairInput(input, invalidOutput) {
  return Object.freeze({
    prompt: `Candidate:\n${JSON.stringify(input.candidate, null, 2)}\n\nOpportunity:\n${JSON.stringify(input.opportunity, null, 2)}\n\nPrevious invalid output:\n${invalidOutput}\n\nReturn the corrected JSON object only.`,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 1000,
    responseFormat: "json",
    timeoutMs: 15000
  });
}

module.exports = Object.freeze({
  name: "score_fit",
  validateInput,
  parseAndValidate,
  createModelInput,
  createRepairInput
});
