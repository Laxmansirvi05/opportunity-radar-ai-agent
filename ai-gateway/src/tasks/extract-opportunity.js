const { GatewayError } = require("../errors");
const { FIELDS, validateOpportunity } = require("./opportunity-schema");

const SYSTEM_PROMPT = `You extract one internship or job opportunity from supplied page text.
Return exactly one JSON object and nothing else. Do not use Markdown, code fences, commentary, or prose.
The object must contain exactly these fields: ${FIELDS.join(", ")}.
Use null when a scalar value is unavailable. Use [] when requirements or skills are unavailable.
workplaceType must be one of: remote, hybrid, onsite, unknown.
employmentType must be one of: internship, full-time, part-time, contract, temporary, unknown.
deadline must be YYYY-MM-DD or null. applicationUrl must be an http(s) URL or null.`;

function validateInput(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 50_000) {
    throw new GatewayError("INVALID_REQUEST", "input must be a non-empty string of at most 50000 characters", { status: 400 });
  }
  return value.trim();
}

function parseAndValidate(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new GatewayError("TASK_OUTPUT_INVALID", "Task returned invalid JSON", { status: 502, cause });
  }
  return validateOpportunity(parsed);
}

function createModelInput(input) {
  return Object.freeze({
    prompt: input,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 2_000,
    responseFormat: "json"
  });
}

function createRepairInput(input, invalidOutput) {
  return Object.freeze({
    prompt: `Source page text:\n${input}\n\nPrevious invalid output:\n${invalidOutput}\n\nReturn the corrected JSON object only.`,
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 2_000,
    responseFormat: "json"
  });
}

module.exports = Object.freeze({
  name: "extract_opportunity",
  validateInput,
  parseAndValidate,
  createModelInput,
  createRepairInput
});
