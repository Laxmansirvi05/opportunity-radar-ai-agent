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
    min: 1_000, max: 120_000, fallback: 60_000
  });
  const globalTimeoutMs = integer("GLOBAL_TIMEOUT_MS", env.GLOBAL_TIMEOUT_MS, {
    min: providerTimeoutMs, max: 180_000, fallback: 120_000
  });


/**
 * Every key configured for a provider, primary first, blanks dropped.
 * Mirrors the naming Opportunity Radar's own gateway uses (KEY, KEY_2, …) so
 * the same .env values can be shared between the two services.
 */
function keyPool(env, name) {
  return [env[name], env[`${name}_2`], env[`${name}_3`], env[`${name}_4`]]
    .map((v) => (typeof v === "string" ? v.trim() : v))
    .filter(Boolean);
}

  return Object.freeze({
    port: integer("PORT", env.PORT, { min: 1, max: 65_535, fallback: 4000 }),
    gatewayApiKey: required("GATEWAY_API_KEY", env.GATEWAY_API_KEY),
    globalTimeoutMs,
    providerTimeoutMs,
    maxRetries: integer("MAX_PROVIDER_RETRIES", env.MAX_PROVIDER_RETRIES, { min: 0, max: 5, fallback: 3 }),
    // How long to wait when EVERY provider is rate limited, before one final
    // attempt each. Sized to outlast a per-minute token window (Groq reports
    // ~13s to reset); a shorter wait just fails again.
    rateLimitWaitMs: integer("RATE_LIMIT_WAIT_MS", env.RATE_LIMIT_WAIT_MS, { min: 1_000, max: 120_000, fallback: 20_000 }),
    providers: Object.freeze({
      groq: Object.freeze({
        apiKey: required("GROQ_API_KEY", env.GROQ_API_KEY),
        apiKeys: keyPool(env, "GROQ_API_KEY"),
        // llama-3.3-70b-versatile was retired by Groq — the API now answers
        // 404 model_not_found for it, which surfaced as PROVIDER_MODEL_UNAVAILABLE
        // and knocked Groq out of the failover chain entirely. With Gemini's
        // free-tier quota also spent, that left no working provider and every
        // pipeline run died at "Message a model" with a 504.
        //
        // openai/gpt-oss-120b is the strongest chat model this key can reach
        // (verified against /v1/models) and returns clean JSON. qwen/qwen3.6-27b
        // was the other candidate but emits <think> reasoning traces that would
        // break JSON parsing downstream.
        model: env.GROQ_MODEL || "openai/gpt-oss-120b"
      }),
      gemini: Object.freeze({
        apiKey: required("GEMINI_API_KEY", env.GEMINI_API_KEY),
        apiKeys: keyPool(env, "GEMINI_API_KEY"),
        model: env.GEMINI_MODEL || "gemini-flash-latest"
      }),
      openrouter: Object.freeze({
        apiKey: required("OPENROUTER_API_KEY", env.OPENROUTER_API_KEY),
        apiKeys: keyPool(env, "OPENROUTER_API_KEY"),
        model: env.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it:free"
      })
    })
  });
}

module.exports = { loadConfig };
