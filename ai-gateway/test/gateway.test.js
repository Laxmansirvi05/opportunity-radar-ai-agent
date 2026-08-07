const assert = require("node:assert/strict");
const test = require("node:test");
const { publicError } = require("../src/app");
const { GatewayError } = require("../src/errors");
const { GatewayService } = require("../src/gateway-service");
const { TaskService } = require("../src/task-service");
const { createTaskRegistry } = require("../src/tasks");
const extractOpportunity = require("../src/tasks/extract-opportunity");
const { validateApiRequest, validateChatRequest } = require("../src/validation");
const { GeminiProvider } = require("../src/providers/gemini");
const { OpenAiCompatibleProvider } = require("../src/providers/openai-compatible");
const { loadConfig } = require("../src/config");

const silentLogger = Object.freeze({ info() {}, warn() {}, error() {} });

function gatewayWith(providers, maxRetries = 1) {
  return new GatewayService({
    providers,
    config: { maxRetries, globalTimeoutMs: 1_000 },
    logger: silentLogger
  });
}

test("fails over to the next provider without exposing provider details", async () => {
  let firstCalls = 0;
  const gateway = gatewayWith([
    {
      name: "gemini",
      async generate() {
        firstCalls += 1;
        throw new GatewayError("PROVIDER_MODEL_UNAVAILABLE", "not public", { status: 404 });
      }
    },
    { name: "openrouter", async generate() { return "provider-neutral result"; } }
  ], 0);
  const result = await gateway.chat({ prompt: "Find opportunities" }, {
    requestId: "request-1",
    signal: new AbortController().signal
  });

  assert.equal(firstCalls, 1);
  assert.deepEqual(result, { text: "provider-neutral result" });
});

test("retries transient failures only", async () => {
  let transientCalls = 0;
  let permanentCalls = 0;
  const gateway = gatewayWith([
    {
      name: "gemini",
      async generate() {
        transientCalls += 1;
        throw new GatewayError("PROVIDER_TRANSIENT_FAILURE", "temporary", { retryable: true });
      }
    },
    {
      name: "openrouter",
      async generate() {
        permanentCalls += 1;
        throw new GatewayError("PROVIDER_FAILURE", "permanent", { retryable: false });
      }
    },
    { name: "groq", async generate() { return "fallback"; } }
  ]);
  const result = await gateway.chat({ prompt: "x" }, { requestId: "request-1", signal: new AbortController().signal });

  assert.equal(result.text, "fallback");
  assert.equal(transientCalls, 2);
  assert.equal(permanentCalls, 1);
});

test("returns the consistent failure schema for invalid and malformed requests", async () => {
  for (const body of [{}, null, { prompt: "x", provider: "gemini" }]) {
    assert.throws(() => validateChatRequest(body), (error) => {
      const result = publicError(error);
      assert.equal(result.status, 400);
      assert.deepEqual(result.body.error.code, "INVALID_REQUEST");
      return true;
    });
  }
  const malformed = publicError({ type: "entity.parse.failed" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "INVALID_REQUEST");
  const tooLarge = publicError({ type: "entity.too.large" });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, "INVALID_REQUEST");
});

test("returns one stable unavailable response after all providers fail", async () => {
  const gateway = gatewayWith([
    { name: "gemini", async generate() { throw new GatewayError("PROVIDER_FAILURE", "secret", { status: 401 }); } }
  ], 0);
  await assert.rejects(() => gateway.chat({ prompt: "x" }, {
    requestId: "request-2",
    signal: new AbortController().signal
  }), (error) => {
    const result = publicError(error);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body.error, { code: "PROVIDERS_UNAVAILABLE", message: "AI service is temporarily unavailable" });
    return true;
  });
});

test("rejects incomplete configuration before startup", () => {
  assert.throws(() => loadConfig({
    GATEWAY_API_KEY: "gateway",
    GEMINI_API_KEY: "gemini"
  }), (error) => error.code === "INVALID_CONFIGURATION");
});

test("loads a complete production configuration", () => {
  const config = loadConfig({
    GATEWAY_API_KEY: "gateway-secret",
    GEMINI_API_KEY: "gemini-secret",
    GROQ_API_KEY: "groq-secret"
  });
  assert.equal(config.globalTimeoutMs, 75_000);
  assert.equal(config.providerTimeoutMs, 25_000);
  assert.equal(config.maxRetries, 2);
});

test("extract_opportunity rejects Markdown and validates only the predefined schema", () => {
  const opportunity = {
    title: "Software Engineering Intern",
    company: "Example Co",
    location: "Bengaluru, India",
    workplaceType: "hybrid",
    employmentType: "internship",
    description: "Build product features.",
    requirements: ["JavaScript"],
    skills: ["Node.js"],
    applicationUrl: "https://example.com/jobs/1",
    deadline: "2026-08-31"
  };
  assert.deepEqual(extractOpportunity.parseAndValidate(JSON.stringify(opportunity)), opportunity);
  assert.throws(() => extractOpportunity.parseAndValidate("~~~json\n{}\n~~~"), (error) => error.code === "TASK_OUTPUT_INVALID");
  assert.throws(
    () => extractOpportunity.parseAndValidate(JSON.stringify({ ...opportunity, unexpected: true })),
    (error) => error.code === "TASK_OUTPUT_INVALID"
  );
});

test("extract_opportunity performs exactly one repair attempt for invalid output", async () => {
  const calls = [];
  const validOutput = JSON.stringify({
    title: "Data Intern",
    company: "Example Co",
    location: null,
    workplaceType: "remote",
    employmentType: "internship",
    description: null,
    requirements: [],
    skills: ["Python"],
    applicationUrl: null,
    deadline: null
  });
  const gateway = {
    async chat(input) {
      calls.push(input);
      return { text: calls.length === 1 ? "not json" : validOutput };
    }
  };
  const service = new TaskService({ gateway, registry: createTaskRegistry(), logger: silentLogger });
  const result = await service.execute("extract_opportunity", "Internship page text", {
    requestId: "task-1",
    signal: new AbortController().signal
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].responseFormat, "json");
  assert.equal(calls[0].temperature, 0);
  assert.match(calls[1].prompt, /Previous invalid output/);
  assert.equal(result.title, "Data Intern");
});

test("task requests are validated through the registry and keep chat validation intact", () => {
  const registry = createTaskRegistry();
  const taskRequest = validateApiRequest({ task: "extract_opportunity", input: "Page text" }, registry);
  assert.equal(taskRequest.type, "task");
  assert.equal(taskRequest.task, "extract_opportunity");
  assert.throws(
    () => validateApiRequest({ task: "score_resume", input: "Resume" }, registry),
    (error) => error.code === "INVALID_REQUEST"
  );
  assert.deepEqual(validateApiRequest({ prompt: "Hello" }, registry), {
    type: "chat",
    input: { prompt: "Hello", systemPrompt: undefined, temperature: undefined, maxTokens: undefined }
  });
});

test("provider adapters enable their native JSON mode for structured tasks", async () => {
  const geminiRequests = [];
  const gemini = new GeminiProvider({
    name: "gemini",
    model: "test-model",
    apiKey: "secret",
    async httpPost(url, body, options) {
      geminiRequests.push({ url, body, options });
      return { candidates: [{ content: { parts: [{ text: "{}" }] } }] };
    }
  });
  const openAiRequests = [];
  const openAi = new OpenAiCompatibleProvider({
    name: "openrouter",
    endpoint: "https://example.test/chat",
    model: "test-model",
    apiKey: "secret",
    async httpPost(url, body, options) {
      openAiRequests.push({ url, body, options });
      return { choices: [{ message: { content: "{}" } }] };
    }
  });
  const input = { prompt: "page text", systemPrompt: "JSON only", responseFormat: "json" };
  await gemini.generate(input, new AbortController().signal);
  await openAi.generate(input, new AbortController().signal);

  assert.equal(geminiRequests[0].body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(openAiRequests[0].body.response_format, { type: "json_object" });
});
