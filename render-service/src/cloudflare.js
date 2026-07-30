'use strict';

const config = require('./config');
const logger = require('./logger');

// Titles Cloudflare's interstitial/managed-challenge pages commonly use.
const CHALLENGE_TITLE_PATTERNS = [
  /just a moment/i,
  /checking your browser/i,
  /attention required/i,
  /please wait.*cloudflare/i,
  /ddos protection by cloudflare/i,
];

// DOM markers present on Cloudflare's JS-challenge / Turnstile pages.
const CHALLENGE_BODY_SELECTORS = [
  '#challenge-running',
  '#cf-challenge-running',
  '.cf-browser-verification',
  '#challenge-form',
  'div.cf-turnstile',
];

/**
 * Heuristically determines whether the current page is a Cloudflare
 * challenge/interstitial rather than the real destination content.
 * `response` is optional (only meaningful right after navigation).
 */
async function isCloudflareChallenge(page, response) {
  try {
    const title = await page.title();
    if (title && CHALLENGE_TITLE_PATTERNS.some((re) => re.test(title))) {
      return true;
    }
  } catch (err) {
    // Page may be mid-navigation; treat as inconclusive, not a match.
  }

  for (const selector of CHALLENGE_BODY_SELECTORS) {
    try {
      const found = await page.$(selector);
      if (found) return true;
    } catch (err) {
      // Ignore transient selector errors during navigation churn.
    }
  }

  if (response) {
    try {
      const status = response.status();
      const server = (response.headers()['server'] || '').toLowerCase();
      if ((status === 503 || status === 403) && server.includes('cloudflare')) {
        return true;
      }
    } catch (err) {
      // response may be stale/detached; ignore.
    }
  }

  return false;
}

/**
 * Polls the page until the Cloudflare challenge clears or the configured
 * max wait elapses (challenges typically auto-resolve in 3-6s once the
 * browser's JS environment satisfies them).
 *
 * Returns true if clear (or never challenged to begin with), false on
 * timeout.
 */
async function waitForCloudflareClearance(page, response) {
  const start = Date.now();

  const stillChallenged = await isCloudflareChallenge(page, response);
  if (!stillChallenged) return true;

  logger.info('Cloudflare challenge detected, waiting for clearance', {
    url: page.url(),
  });

  while (Date.now() - start < config.cloudflareMaxWaitMs) {
    await page.waitForTimeout(config.cloudflarePollIntervalMs);

    const challenged = await isCloudflareChallenge(page, null);
    if (!challenged) {
      logger.info('Cloudflare challenge cleared', {
        url: page.url(),
        elapsedMs: Date.now() - start,
      });
      return true;
    }
  }

  logger.warn('Cloudflare challenge did not clear within max wait window', {
    url: page.url(),
    waitedMs: Date.now() - start,
  });
  return false;
}

module.exports = { isCloudflareChallenge, waitForCloudflareClearance };
