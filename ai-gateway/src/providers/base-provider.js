const { GatewayError } = require("../errors");

class BaseProvider {
  constructor({ name, model, apiKey, httpPost }) {
    this.name = name;
    this.model = model;
    this.apiKey = apiKey;
    this.httpPost = httpPost;
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
