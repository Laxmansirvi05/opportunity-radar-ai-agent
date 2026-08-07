const { GatewayError, toGatewayError } = require("./errors");

function wait(delayMs, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const complete = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new GatewayError("GLOBAL_TIMEOUT", "AI request timed out", { status: 504 }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(complete, delayMs);
  });
}

class GatewayService {
  constructor({ providers, config, logger }) {
    this.providers = providers;
    this.config = config;
    this.logger = logger;
  }

  async chat(input, { requestId, signal }) {
    for (const provider of this.providers) {
      for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
        if (signal?.aborted) {
          throw new GatewayError("GLOBAL_TIMEOUT", "AI request timed out", { status: 504 });
        }
        try {
          this.logger.info("provider_attempt", { requestId, provider: provider.name, attempt: attempt + 1 });
          const text = await provider.generate(input, signal);
          if (typeof text !== "string" || text.trim() === "") {
            throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Provider returned an invalid response", {
              status: 502,
              retryable: true
            });
          }
          this.logger.info("provider_succeeded", { requestId, provider: provider.name, attempt: attempt + 1 });
          return { text };
        } catch (error) {
          const failure = toGatewayError(error);
          if (failure.code === "GLOBAL_TIMEOUT") throw failure;
          this.logger.warn("provider_failed", {
            requestId,
            provider: provider.name,
            attempt: attempt + 1,
            code: failure.code,
            retryable: failure.retryable
          });
          if (!failure.retryable || attempt === this.config.maxRetries) break;
          await wait(300 * 2 ** attempt, signal);
        }
      }
    }
    throw new GatewayError("PROVIDERS_UNAVAILABLE", "No AI provider is currently available", { status: 503 });
  }
}

module.exports = { GatewayService };
