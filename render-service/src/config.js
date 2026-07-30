'use strict';
require('dotenv').config();/**
 * Central configuration. Every tunable lives here, sourced from environment
 * variables with production-sane defaults, so the rest of the codebase never
 * touches process.env directly.
 */

function parseIntEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseBoolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

function parseListEnv(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const config = {
  // HTTP server
  port: parseIntEnv('PORT', 3000),
  host: process.env.HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || null,

  // Browser
  headless: parseBoolEnv('HEADLESS', true),
  browserLaunchArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-accelerated-2d-canvas',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-component-extensions-with-background-pages',
    '--disable-extensions',
    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
    '--disable-ipc-flooding-protection',
    '--disable-renderer-backgrounding',
    '--force-color-profile=srgb',
    '--metrics-recording-only',
    '--mute-audio',
  ],

  // Browser recycling. The browser is never killed mid-request - recycling
  // only happens once activePages drops to 0, so it's invisible to callers.
  // Set either to 0 to disable that particular trigger.
  browserMaxPages: parseIntEnv('BROWSER_MAX_PAGES', 500),
  browserMaxAgeMs: parseIntEnv('BROWSER_MAX_AGE_MS', 4 * 60 * 60 * 1000), // 4h

  // Concurrency / queue
  maxConcurrency: parseIntEnv('MAX_CONCURRENCY', 5),
  maxQueueSize: parseIntEnv('MAX_QUEUE_SIZE', 200),

  // Timeouts (ms)
  navigationTimeoutMs: parseIntEnv('NAVIGATION_TIMEOUT_MS', 30000),
  networkIdleTimeoutMs: parseIntEnv('NETWORK_IDLE_TIMEOUT_MS', 8000),
  renderExtraWaitMs: parseIntEnv('RENDER_EXTRA_WAIT_MS', 500),
  requestTimeoutMs: parseIntEnv('REQUEST_TIMEOUT_MS', 60000),
  queueWaitTimeoutMs: parseIntEnv('QUEUE_WAIT_TIMEOUT_MS', 45000),

  // Retry / backoff
  maxRetries: parseIntEnv('MAX_RETRIES', 3),
  retryBaseDelayMs: parseIntEnv('RETRY_BASE_DELAY_MS', 1000),
  retryMaxDelayMs: parseIntEnv('RETRY_MAX_DELAY_MS', 10000),

  // Cloudflare challenge handling
  cloudflareMaxWaitMs: parseIntEnv('CLOUDFLARE_MAX_WAIT_MS', 15000),
  cloudflarePollIntervalMs: parseIntEnv('CLOUDFLARE_POLL_INTERVAL_MS', 1000),

  // Resource blocking
  blockedResourceTypes: parseListEnv('BLOCKED_RESOURCE_TYPES', [
    'image',
    'font',
    'media',
  ]),
  blockedDomains: parseListEnv('BLOCKED_DOMAINS', [
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'facebook.net',
    'connect.facebook.net',
    'hotjar.com',
    'segment.com',
    'segment.io',
    'mixpanel.com',
    'amplitude.com',
    'fullstory.com',
    'intercom.io',
    'crazyegg.com',
    'optimizely.com',
    'adnxs.com',
    'adsrvr.org',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'quantserve.com',
    'scorecardresearch.com',
    'newrelic.com',
    'nr-data.net',
    'sentry.io',
    'bugsnag.com',
    'googlesyndication.com',
    'adservice.google.com',
  ]),

  // Security
  // Blocks /fetch requests whose URL host is a loopback, private, or
  // link-local address (e.g. 127.0.0.1, 169.254.169.254 cloud metadata,
  // 10/8, 172.16/12, 192.168/16) so a caller can't use this service as an
  // SSRF pivot into the internal network. Only affects literal IP hosts;
  // this does not perform DNS resolution/pinning against rebinding - see
  // README for the residual-risk note.
  blockPrivateNetworkTargets: parseBoolEnv('BLOCK_PRIVATE_NETWORK_TARGETS', true),

  // Misc
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: {
    width: parseIntEnv('VIEWPORT_WIDTH', 1366),
    height: parseIntEnv('VIEWPORT_HEIGHT', 768),
  },
  maxHtmlSizeBytes: parseIntEnv('MAX_HTML_SIZE_BYTES', 15 * 1024 * 1024), // 15MB
  logLevel: process.env.LOG_LEVEL || 'info',
  shutdownTimeoutMs: parseIntEnv('SHUTDOWN_TIMEOUT_MS', 15000),
};

module.exports = config;
