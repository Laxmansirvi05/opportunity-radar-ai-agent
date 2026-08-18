const { GatewayError } = require("../errors");

class BaseProvider {
  /**
   * `apiKeys` is a list, with `apiKey` accepted as the single-key form.
   *
   * A per-key rate limit or daily quota does not clear by waiting and cannot be
   * escaped by failing over to a different PROVIDER — the only thing that helps
   * is a different KEY. Without this the gateway held exactly one key per
   * provider, so one exhausted Gemini key took Gemini out of the chain
   * entirely; with Groq's model retired and OpenRouter limited, every pipeline
   * run then died with a 503 and no provider left to try. Opportunity Radar's
   * own AI gateway has rotated across a key pool for exactly this reason, which
   * is why the same keys kept working there while this service starved.
   */
  constructor({ name, model, apiKey, apiKeys, httpPost }) {
    this.name = name;
    this.model = model;
    const keys = Array.isArray(apiKeys) && apiKeys.length ? apiKeys : [apiKey];
    // Duplicates collapse: two env vars holding the same value must not be
    // tried twice in a row, since the second try fails for the same reason.
    const seen = new Set();
    this.apiKeys = keys.filter((k) => k && !seen.has(k) && seen.add(k) !== undefined);
    this.keyIndex = 0;
    this.httpPost = httpPost;
  }

  /** The key in play. Providers read this, so rotation is invisible to them. */
  get apiKey() {
    return this.apiKeys[this.keyIndex];
  }

  /**
   * Advance to the next configured key. Returns false when the pool is spent,
   * which is the caller's signal to fail over to the next provider instead.
   */
  rotateKey() {
    if (this.keyIndex + 1 >= this.apiKeys.length) return false;
    this.keyIndex += 1;
    return true;
  }

  /** Called when a request succeeds, so a transient blip does not strand us on
   *  the last key for the rest of the process. */
  resetKey() {
    this.keyIndex = 0;
  }

  async generate() {
    throw new GatewayError("PROVIDER_NOT_IMPLEMENTED", "Provider adapter is not implemented");
  }

  extractText(value) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Provider returned an empty response", {
        status: 502,
        retryable: true
      });
    }
    return value;
  }
}

module.exports = { BaseProvider };
