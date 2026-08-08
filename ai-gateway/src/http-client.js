const { GatewayError } = require("./errors");

function providerErrorForStatus(status) {
  // 429 is deliberately NOT the same as a 5xx. Retrying a rate-limited provider
  // with the same large payload consumes the very token budget you are waiting
  // for: a ~3k-token call retried 4 times burns Groq's entire 12k/minute
  // allowance and guarantees failure. Rate limits must move to the next
  // provider first, not hammer the one that just refused.
  if (status === 429) {
    return new GatewayError("PROVIDER_RATE_LIMITED", "Provider is rate limited", {
      status, retryable: true, rateLimited: true
    });
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new GatewayError("PROVIDER_TRANSIENT_FAILURE", "Provider request failed", { status, retryable: true });
  }
  if (status === 400 || status === 404) {
    return new GatewayError("PROVIDER_MODEL_UNAVAILABLE", "Provider model is unavailable", { status, retryable: false });
  }
  return new GatewayError("PROVIDER_FAILURE", "Provider request failed", { status, retryable: false });
}

async function postJson(url, body, { headers = {}, timeoutMs, signal, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("provider_timeout"), timeoutMs);
  const onAbort = () => controller.abort("global_timeout");
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw providerErrorForStatus(response.status);
    try {
      return await response.json();
    } catch (cause) {
      throw new GatewayError("PROVIDER_INVALID_RESPONSE", "Provider returned an invalid response", {
        status: 502, retryable: true, cause
      });
    }
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (signal?.aborted) {
      throw new GatewayError("GLOBAL_TIMEOUT", "AI request timed out", { status: 504, cause: error });
    }
    if (controller.signal.aborted) {
      throw new GatewayError("PROVIDER_TIMEOUT", "Provider request timed out", { status: 504, retryable: true, cause: error });
    }
    throw new GatewayError("PROVIDER_NETWORK_FAILURE", "Provider network request failed", {
      status: 502, retryable: true, cause: error
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

module.exports = { postJson };
