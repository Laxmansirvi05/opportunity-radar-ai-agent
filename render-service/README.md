# Opportunity Radar - Playwright Rendering Service

A production-grade Playwright rendering microservice. It exists to be called
by n8n (or anything else) whenever a target website can't be scraped with a
plain HTTP request because it needs a real browser to execute JavaScript.

## Architecture at a glance

```
src/
  config.js          All tunables, sourced from env vars with defaults
  logger.js          Structured JSON logging
  errors.js          Typed errors -> consistent JSON responses + status codes
  browserManager.js  Singleton Chromium instance, auto-relaunch on crash
  resourceBlocking.js Blocks images/fonts/media/ads/analytics, keeps CSS
  cloudflare.js      Detects + waits out Cloudflare JS challenges
  requestQueue.js    Bounded concurrency queue (protects CPU/RAM under load)
  renderer.js        Navigation, wait strategy, retries + exponential backoff
  app.js             Express app, middleware, centralized error handler
  index.js           HTTP server bootstrap + graceful shutdown
  routes/
    health.js        GET /health
    fetch.js         POST /fetch
```

Key design decisions:

- **One browser, many contexts.** Chromium is launched exactly once and
  reused. Every request gets its own isolated `BrowserContext` (like an
  incognito window) so cookies/state never leak between requests, and the
  context is always closed in a `finally` block - even on timeout or crash.
- **Auto-recovery.** If the browser process dies, the next request
  transparently relaunches it.
- **Proactive recycling.** The browser is also recycled after
  `BROWSER_MAX_PAGES` pages or `BROWSER_MAX_AGE_MS`, but only once
  `activePages` reaches 0 - never mid-request.
- **SSRF protection.** `/fetch` rejects URLs whose host is a literal
  loopback/private/link-local address (see `BLOCK_PRIVATE_NETWORK_TARGETS`).
- **Bounded concurrency.** `MAX_CONCURRENCY` caps how many pages render at
  once; anything beyond that queues (bounded by `MAX_QUEUE_SIZE`) rather than
  spawning unbounded Chromium pages and OOM-killing the container.
- **Three timeout layers:** per-navigation (`NAVIGATION_TIMEOUT_MS`), queue
  wait (`QUEUE_WAIT_TIMEOUT_MS`), and an overall request budget
  (`REQUEST_TIMEOUT_MS`) that force-closes any in-flight browser context and
  cancels further retries if exceeded.
- **Cloudflare-aware.** Detects the "Just a moment..." / managed-challenge
  interstitial by title, DOM markers, and response headers, then polls until
  it clears (or times out and retries the whole navigation).

## Running locally

```bash
npm install        # also runs `playwright install --with-deps chromium`
cp .env.example .env
npm start
```

## Running with Docker

```bash
docker build -t opportunity-radar-render-service .
docker run --rm -p 3000:3000 \
  -e MAX_CONCURRENCY=5 \
  opportunity-radar-render-service
```

For docker-compose alongside n8n, put both services on the same network and
point n8n's HTTP Request node at `http://render-service:3000/fetch`.

## API

### `GET /health`

```json
{
  "status": "ok",
  "browserRunning": true,
  "uptime": 1234.56,
  "activePages": 2,
  "queuedRequests": 0,
  "completedRequests": 481,
  "failedRequests": 3,
  "browserRestarts": 1,
  "pagesServedByCurrentBrowser": 214,
  "browserLaunchedAt": "2026-07-29T09:00:00.000Z",
  "memoryUsage": { "rss": 123456789, "heapTotal": 1, "heapUsed": 1, "external": 1 }
}
```

### `POST /fetch`

Request:
```json
{ "url": "https://example.com" }
```

Success response (HTTP 200):
```json
{
  "success": true,
  "url": "https://example.com/",
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "status": 200,
  "html": "<!DOCTYPE html>...",
  "renderedAt": "2026-07-29T12:00:00.000Z",
  "renderTimeMs": 842,
  "redirected": false,
  "jsRendered": true,
  "cloudflareDetected": false,
  "contentLength": 1256,
  "browserEngine": "chromium"
}
```

Error response (structured, non-2xx):
```json
{
  "success": false,
  "error": {
    "code": "CLOUDFLARE_CHALLENGE_UNRESOLVED",
    "message": "Cloudflare challenge did not clear for https://example.com within 15000ms",
    "details": { "url": "https://example.com" }
  }
}
```

| HTTP status | `error.code`                     | Meaning                                            |
|-------------|-----------------------------------|-----------------------------------------------------|
| 400         | `VALIDATION_ERROR` / `INVALID_JSON` | Bad or missing `url` / malformed request body      |
| 401         | `UNAUTHORIZED`                   | Missing/invalid API key (only if `API_KEY` is set)  |
| 502         | `NAVIGATION_ERROR`               | Chromium could not load the page                    |
| 502         | `BROWSER_CRASH`                  | The renderer process/page crashed mid-navigation     |
| 502         | `CLOUDFLARE_CHALLENGE_UNRESOLVED`| Challenge never cleared within the max wait window   |
| 503         | `QUEUE_FULL`                     | Too many requests already queued, retry later        |
| 503         | `BROWSER_UNAVAILABLE`            | Service is shutting down                             |
| 504         | `RENDER_TIMEOUT`                 | Queue wait or overall request budget exceeded         |
| 500         | `INTERNAL_ERROR`                 | Unexpected failure                                    |

### n8n integration

Add an **HTTP Request** node:
- Method: `POST`
- URL: `http://<render-service-host>:3000/fetch`
- Body (JSON): `{ "url": "={{ $json.url }}" }`
- Use this node as the fallback branch of an `IF` node that checks whether a
  plain HTTP-request scrape returned usable content.

## Configuration

See `.env.example` for the full list of environment variables (concurrency,
timeouts, retry/backoff, Cloudflare wait window, resource-blocking lists,
etc). Every value has a production-sane default - the service runs with
zero configuration out of the box.

## Operational notes

- **Graceful shutdown:** `SIGINT`/`SIGTERM` stop the HTTP server from
  accepting new connections, then close the browser, with a hard timeout
  (`SHUTDOWN_TIMEOUT_MS`) as a safety net.
- **Logs** are newline-delimited JSON on stdout/stderr - pipe directly into
  any log aggregator.
- **Scaling:** this service holds no persistent state, so it scales
  horizontally - run N containers behind a load balancer and tune
  `MAX_CONCURRENCY` per container to available CPU/RAM (each concurrent
  Chromium page typically costs 50-150MB RSS).
