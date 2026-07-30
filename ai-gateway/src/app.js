const crypto = require("node:crypto");
const express = require("express");
const { GatewayError } = require("./errors");
const { validateApiRequest } = require("./validation");

function publicError(error) {
  if (error?.type === "entity.parse.failed") {
    error = new GatewayError("INVALID_REQUEST", "Request body must contain valid JSON", { status: 400 });
  }
  if (error?.type === "entity.too.large") {
    error = new GatewayError("INVALID_REQUEST", "Request body is too large", { status: 413 });
  }
  const known = error instanceof GatewayError ? error : new GatewayError("INTERNAL_ERROR", "Internal server error");
  const messages = {
    INVALID_REQUEST: known.message,
    UNAUTHORIZED: "Unauthorized",
    GLOBAL_TIMEOUT: "AI request timed out",
    PROVIDERS_UNAVAILABLE: "AI service is temporarily unavailable",
    TASK_OUTPUT_INVALID: "AI service returned an invalid structured result",
    INTERNAL_ERROR: "Internal server error"
  };
  return {
    status: known.status >= 400 && known.status < 600 ? known.status : 500,
    body: { success: false, requestId: undefined, error: { code: known.code, message: messages[known.code] || "AI service request failed" } }
  };
}

function credentialsMatch(provided, expected) {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

function createApp({ gateway, taskService, logger }) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      logger.info("request_completed", {
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000
      });
    });
    next();
  });

  app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
  app.get("/ready", (req, res) => res.status(200).json({ status: "ready" }));
  app.use((req, res, next) => {
    if (credentialsMatch(req.get("x-api-key"), gateway.config.gatewayApiKey)) return next();
    return next(new GatewayError("UNAUTHORIZED", "Unauthorized", { status: 401 }));
  });
  app.use(express.json({ limit: "64kb" }));

  app.post("/api/ai/chat", async (req, res, next) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), gateway.config.globalTimeoutMs);
    try {
      const request = validateApiRequest(req.body, taskService.registry);
      const context = { requestId: req.requestId, signal: controller.signal };
      if (request.type === "task") {
        const data = await taskService.execute(request.task, request.input, context);
        return res.status(200).json({ success: true, requestId: req.requestId, data });
      }
      const result = await gateway.chat(request.input, context);
      return res.status(200).json({ success: true, requestId: req.requestId, text: result.text });
    } catch (error) {
      return next(error);
    } finally {
      clearTimeout(timer);
    }
  });

  app.use((req, res, next) => next(new GatewayError("NOT_FOUND", "Route not found", { status: 404 })));

  app.use((error, req, res, next) => {
    const result = publicError(error);
    result.body.requestId = req.requestId || crypto.randomUUID();
    if (!(error instanceof GatewayError)) {
      logger.error("unhandled_error", { requestId: result.body.requestId, type: error.name });
    }
    res.status(result.status).json(result.body);
  });

  return app;
}

module.exports = { createApp, publicError };
