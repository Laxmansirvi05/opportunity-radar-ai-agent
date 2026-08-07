const { postJson } = require("../http-client");
const { GeminiProvider } = require("./gemini");
const { OpenAiCompatibleProvider } = require("./openai-compatible");

function createProviders(config, httpPost = postJson) {
  const request = (url, body, options) => httpPost(url, body, {
    ...options,
    timeoutMs: options.timeoutMs || config.providerTimeoutMs
  });

  return Object.freeze([
    new OpenAiCompatibleProvider({
      name: "groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      ...config.providers.groq,
      httpPost: request
    }),
    new GeminiProvider({ name: "gemini", ...config.providers.gemini, httpPost: request }),
    // Last-resort fallback. Dropped in task-1 on a historical 0-for-19 record,
    // restored after it answered 11/11 live checks during verification — and
    // after Groq exhausted its 100k tokens/day budget and Gemini's configured
    // model started returning 404, which left the chain with no live provider.
    new OpenAiCompatibleProvider({
      name: "openrouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      ...config.providers.openrouter,
      httpPost: request
    })
  ]);
}

module.exports = { createProviders };
