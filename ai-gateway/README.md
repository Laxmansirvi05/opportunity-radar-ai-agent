# Opportunity Radar AI Gateway

This service is the only LLM integration point for Opportunity Radar. n8n workflows call the gateway; they must not be configured with Gemini, OpenRouter, or Groq credentials or URLs.

## Run

Use Node.js 18 or later.

~~~sh
npm install
cp .env.example .env
npm start
~~~

The process validates all required provider keys and numeric limits before it starts. Keep .env outside source control and provide secrets through the deployment environment in production.

## n8n contract

The workflow invokes only POST /api/ai/chat with Content-Type: application/json and an X-API-Key header containing GATEWAY_API_KEY. This is the only secret n8n needs for LLM access.

Request:

~~~json
{
  "prompt": "Summarize the opportunity",
  "systemPrompt": "You are a concise market analyst.",
  "temperature": 0.2,
  "maxTokens": 500
}
~~~

Only prompt is required. The optional fields are validated. Unknown fields are rejected to keep the contract predictable. Health endpoints do not require the gateway key so orchestrators can probe the service.

## Structured task contract

The same endpoint also accepts registered tasks. The first task is extract_opportunity:

~~~json
{
  "task": "extract_opportunity",
  "input": "Cleaned internship or job page text"
}
~~~

The task uses provider JSON mode, validates an exact Opportunity schema, and makes one internal repair attempt when the model returns invalid JSON or a schema-invalid object. n8n never receives model Markdown or natural-language output for this task.

Successful extraction response:

~~~json
{
  "success": true,
  "requestId": "c319e1f7-0d35-4c30-a134-8a27476ecdc7",
  "data": {
    "title": "Software Engineering Intern",
    "company": "Example Co",
    "location": null,
    "workplaceType": "remote",
    "employmentType": "internship",
    "description": null,
    "requirements": [],
    "skills": ["JavaScript"],
    "applicationUrl": null,
    "deadline": null
  }
}
~~~

Tasks are registered in src/tasks. Future task modules such as score_resume, ats_match, and summarize_company can use the same registry and endpoint without adding task-specific route logic.

Success response:

~~~json
{
  "success": true,
  "requestId": "c319e1f7-0d35-4c30-a134-8a27476ecdc7",
  "text": "..."
}
~~~

Failure response:

~~~json
{
  "success": false,
  "requestId": "c319e1f7-0d35-4c30-a134-8a27476ecdc7",
  "error": {
    "code": "PROVIDERS_UNAVAILABLE",
    "message": "AI service is temporarily unavailable"
  }
}
~~~

Provider names, models, status codes, and provider error bodies are deliberately never returned to n8n.

## Operations

- GET /health is a liveness check.
- GET /ready confirms the validated process is ready to serve traffic.
- Every request receives an X-Request-Id header and structured completion log.
- Gemini, OpenRouter, and Groq are tried in that order.
- A transient provider failure (429, 500, 502, 503, 504, timeout, network failure, or invalid provider response) is retried once by default before failover.
- A model-unavailable response (400 or 404) is not retried and immediately fails over.
- GLOBAL_TIMEOUT_MS bounds the complete request; PROVIDER_TIMEOUT_MS bounds each provider attempt.

## Development

~~~sh
npm run check
npm test
~~~

Providers are adapters in src/providers. Add a provider by implementing the adapter contract (name and generate(input, signal)) and registering it in src/providers/index.js; the HTTP route and n8n contract remain unchanged.
