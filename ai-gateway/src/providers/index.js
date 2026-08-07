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
    new GeminiProvider({ name: "gemini", ...config.providers.gemini, httpPost: request })
  ]);
}

module.exports = { createProviders };
