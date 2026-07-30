const { GatewayError } = require("./errors");

function invalid(message) {
  throw new GatewayError("INVALID_REQUEST", message, { status: 400 });
}

function optionalString(value, field, maxLength) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    invalid(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function optionalNumber(value, field, min, max, integer = false) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(`${field} must be a number between ${min} and ${max}`);
  }
  return value;
}

function validateChatRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object");
  const unknown = Object.keys(body).filter((key) => !["prompt", "systemPrompt", "temperature", "maxTokens"].includes(key));
  if (unknown.length > 0) invalid("Request contains unsupported fields");
  const prompt = optionalString(body.prompt, "prompt", 20_000);
  if (!prompt) invalid("prompt is required");
  return Object.freeze({
    prompt,
    systemPrompt: optionalString(body.systemPrompt, "systemPrompt", 10_000),
    temperature: optionalNumber(body.temperature, "temperature", 0, 2),
    maxTokens: optionalNumber(body.maxTokens, "maxTokens", 1, 8_192, true)
  });
}

function validateApiRequest(body, taskRegistry) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("Request body must be a JSON object");
  if (body.task === undefined) {
    return Object.freeze({ type: "chat", input: validateChatRequest(body) });
  }
  const unknown = Object.keys(body).filter((key) => !["task", "input"].includes(key));
  if (unknown.length > 0) invalid("Task request contains unsupported fields");
  if (typeof body.task !== "string" || body.task.trim() === "") invalid("task must be a non-empty string");
  const task = taskRegistry.get(body.task);
  if (!task) invalid("Unsupported task");
  return Object.freeze({ type: "task", task: task.name, input: task.validateInput(body.input) });
}

module.exports = { validateApiRequest, validateChatRequest };
