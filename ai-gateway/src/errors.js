class GatewayError extends Error {
  constructor(code, message, { status = 500, retryable = false, rateLimited = false, cause } = {}) {
    super(message, { cause });
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    // Rate limiting is retryable but must NOT be retried against the same
    // provider immediately — see http-client.providerErrorForStatus.
    this.rateLimited = rateLimited;
  }
}

function toGatewayError(error) {
  if (error instanceof GatewayError) return error;
  return new GatewayError("PROVIDER_FAILURE", "Provider request failed", {
    status: 502,
    retryable: true,
    cause: error
  });
}

module.exports = { GatewayError, toGatewayError };
