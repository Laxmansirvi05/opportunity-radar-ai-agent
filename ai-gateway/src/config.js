const { GatewayError } = require("./errors");

function integer(name, value, { min, max, fallback }) {
  const source = value ?? fallback;
  const parsed = Number(source);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new GatewayError("INVALID_CONFIGURATION", `${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function required(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new GatewayError("INVALID_CONFIGURATION", `${name} is required`);
  }
  return value;
}

function loadConfig(env) {
  const providerTimeoutMs = integer("PROVIDER_TIMEOUT_MS", env.PROVIDER_TIMEOUT_MS, {
    min: 1_000, max: 120_000, fallback: 25_000
  });
  const globalTimeoutMs = integer("GLOBAL_TIMEOUT_MS", env.GLOBAL_TIMEOUT_MS, {
    min: providerTimeoutMs, max: 180_000, fallback: 75_000
  });

  return Object.freeze({
    port: integer("PORT", env.PORT, { min: 1, max: 65_535, fallback: 4000 }),
    gatewayApiKey: required("GATEWAY_API_KEY", env.GATEWAY_API_KEY),
    globalTimeoutMs,
    providerTimeoutMs,
    maxRetries: integer("MAX_PROVIDER_RETRIES", env.MAX_PROVIDER_RETRIES, { min: 0, max: 3, fallback: 1 }),
    providers: Object.freeze({
      gemini: Object.freeze({
        apiKey: required("GEMINI_API_KEY", env.GEMINI_API_KEY),
        model: env.GEMINI_MODEL || "gemini-2.5-flash"
      }),
      openrouter: Object.freeze({
        apiKey: required("OPENROUTER_API_KEY", env.OPENROUTER_API_KEY),
        model: env.OPENROUTER_MODEL || "google/gemini-2.5-flash"
      }),
      groq: Object.freeze({
        apiKey: required("GROQ_API_KEY", env.GROQ_API_KEY),
        model: env.GROQ_MODEL || "llama-3.3-70b-versatile"
      })
    })
  });
}

module.exports = { loadConfig };
