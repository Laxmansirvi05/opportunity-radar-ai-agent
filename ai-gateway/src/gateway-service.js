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
    // Providers that rate-limited us on this request. They are skipped on the
    // first pass and retried once at the end, after a longer wait — retrying
    // them immediately would consume the token budget we are waiting to refill.
    const rateLimited = [];

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
          // Move on immediately: another provider may be healthy, and every
          // retry here spends budget from the window we would be waiting on.
          if (failure.rateLimited) {
            if (!rateLimited.includes(provider)) rateLimited.push(provider);
            break;
          }
          if (!failure.retryable || attempt === this.config.maxRetries) break;
          // Backoff must outlast a per-minute token budget, not just a blip.
          // Groq allows 12k tokens/min and reports ~13s to reset; the previous
          // 300ms base gave up after ~2s total, so a whole pipeline run could
          // fail on a budget that would have cleared shortly after.
          // 2.5s -> 5s -> 10s covers that window.
          await wait(2_500 * 2 ** attempt, signal);
        }
      }
    }
    // Every provider refused. If any of them were merely rate limited, wait out
    // a token window ONCE and make a single final attempt each — this is what
    // turns "all providers busy for 10 seconds" into a success instead of a
    // failed run.
    if (rateLimited.length > 0 && !signal?.aborted) {
      this.logger.warn("all_providers_rate_limited_waiting", {
        requestId, providers: rateLimited.map((p) => p.name), waitMs: this.config.rateLimitWaitMs
      });
      await wait(this.config.rateLimitWaitMs, signal);

      for (const provider of rateLimited) {
        if (signal?.aborted) break;
        try {
          this.logger.info("provider_attempt", { requestId, provider: provider.name, attempt: "post-ratelimit" });
          const text = await provider.generate(input, signal);
          if (typeof text === "string" && text.trim() !== "") {
            this.logger.info("provider_succeeded", { requestId, provider: provider.name, attempt: "post-ratelimit" });
            return { text };
          }
        } catch (error) {
          const failure = toGatewayError(error);
          if (failure.code === "GLOBAL_TIMEOUT") throw failure;
          this.logger.warn("provider_failed", {
            requestId, provider: provider.name, attempt: "post-ratelimit", code: failure.code
          });
        }
      }
    }

    throw new GatewayError("PROVIDERS_UNAVAILABLE", "No AI provider is currently available", { status: 503 });
  }
}

module.exports = { GatewayService };
