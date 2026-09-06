'use strict';

const config = require('./config');
const logger = require('./logger');
const browserManager = require('./browserManager');
const { applyResourceBlocking } = require('./resourceBlocking');
const { waitForCloudflareClearance, isCloudflareChallenge } = require('./cloudflare');
const { extractMainContent } = require('./content-extractor');
const { AppError, NavigationError, RenderTimeoutError, CloudflareChallengeError, BrowserCrashError } = require('./errors');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, capped at retryMaxDelayMs. */
function computeBackoffDelay(attempt) {
  const exponential = config.retryBaseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(exponential, config.retryMaxDelayMs);
  return Math.floor(Math.random() * capped);
}

/**
 * Performs a single render attempt: opens an isolated context + page,
 * navigates, waits for the page to settle, extracts the result, and always
 * cleans up its own context/page - even on failure or external cancellation.
 *
 * @param {string} url
 * @param {object} options
 * @param {(context: import('playwright').BrowserContext) => void} [options.onContextCreated]
 *   Lets the caller register the context so it can force-close it (aborting
 *   in-flight navigation) if an outer request timeout fires.
 */
async function renderOnce(url, { onContextCreated } = {}) {
  const context = await browserManager.createContext();
  if (onContextCreated) onContextCreated(context);

  const page = await context.newPage();
  browserManager.trackPageOpen();

  // Playwright emits 'crash' when the renderer process backing this page
  // dies (OOM, sandboxed crash, etc). Track it so a goto() failure caused by
  // a crash is classified as BROWSER_CRASH instead of a generic navigation
  // error - the two need different operational responses (crash -> watch
  // for a restart storm; navigation error -> usually just a bad target URL).
  let pageCrashed = false;
  page.on('crash', () => {
    pageCrashed = true;
  });

  try {
    await applyResourceBlocking(page);

    let response;
    try {
      response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.navigationTimeoutMs,
      });
    } catch (err) {
      if (pageCrashed || /crash/i.test(err.message)) {
        throw new BrowserCrashError(`Browser page crashed while navigating to ${url}: ${err.message}`, { url });
      }
      throw new NavigationError(`Failed to navigate to ${url}: ${err.message}`, { url });
    }

    if (pageCrashed) {
      throw new BrowserCrashError(`Browser page crashed while navigating to ${url}`, { url });
    }

    if (!response) {
      throw new NavigationError(`No response received for ${url}`, { url });
    }

    // Let async network activity settle (XHR, lazy-loaded widgets, hydration).
    // Some pages never truly go idle (websockets, polling beacons), so this
    // is best-effort and never treated as fatal.
    try {
      await page.waitForLoadState('networkidle', {
        timeout: config.networkIdleTimeoutMs,
      });
    } catch (err) {
      logger.debug('Network idle wait timed out, continuing anyway', {
        url,
        timeoutMs: config.networkIdleTimeoutMs,
      });
    }

    // Detect and intelligently wait out Cloudflare's JS challenge/interstitial.
    const challenged = await isCloudflareChallenge(page, response);
    const cloudflareDetected = challenged;
    if (challenged) {
      const cleared = await waitForCloudflareClearance(page, response);
      if (!cleared) {
        throw new CloudflareChallengeError(
          `Cloudflare challenge did not clear for ${url} within ${config.cloudflareMaxWaitMs}ms`,
          { url }
        );
      }
      // Give the now-cleared page a brief moment to finish rendering.
      try {
        await page.waitForLoadState('networkidle', {
          timeout: config.networkIdleTimeoutMs,
        });
      } catch (err) {
        // best effort, ignore
      }
    }

    // Small settle window for client-side rendering frameworks that finish
    // paint slightly after networkidle fires.
    if (config.renderExtraWaitMs > 0) {
      await page.waitForTimeout(config.renderExtraWaitMs);
    }

    const html = await page.content();
    const mainContent = extractMainContent(html, page.url());
    const title = await page.title();
    const finalUrl = page.url();
    const status = response.status();
    // True if the main-frame request was reached via one or more HTTP
    // redirects (more reliable than comparing url !== finalUrl, which
    // would miss redirect chains that loop back to the same URL string).
    const redirected = Boolean(response.request().redirectedFrom());

    const htmlSizeBytes = Buffer.byteLength(html, 'utf8');
    if (htmlSizeBytes > config.maxHtmlSizeBytes) {
      logger.warn('Rendered HTML exceeded configured max size', {
        url,
        sizeBytes: htmlSizeBytes,
        maxHtmlSizeBytes: config.maxHtmlSizeBytes,
      });
    }

    return {
      html,
      mainContent,
      title,
      finalUrl,
      status,
      redirected,
      cloudflareDetected,
      contentLength: htmlSizeBytes,
      // This service always renders via a real, JS-enabled headless
      // browser (see createContext), so this is always true - included so
      // callers switching between this service and a plain-HTTP fetch path
      // upstream can tell which one produced a given response.
      jsRendered: true,
      browserEngine: 'chromium',
    };
  } catch (err) {
    // A crash can also surface later than goto() - e.g. during content
    // extraction on a huge/hydration-heavy page after the renderer process
    // has already died. Reclassify any such error as BROWSER_CRASH rather
    // than letting it fall through as a generic unexpected exception.
    // Errors that are already one of our typed AppErrors (including a
    // BrowserCrashError already thrown above) pass through unchanged.
    if (pageCrashed && !(err instanceof AppError)) {
      throw new BrowserCrashError(`Browser page crashed while processing ${url}: ${err.message}`, { url });
    }
    throw err;
  } finally {
    // Always tear down, regardless of success, failure, or external
    // cancellation - this is what prevents page/context memory leaks.
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    browserManager.trackPageClose();
  }
}

/**
 * Renders a URL with retry + exponential backoff on transient failures.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {(context: import('playwright').BrowserContext) => void} [options.onContextCreated]
 * @param {{ cancelled: boolean }} [options.cancellationToken]
 *   If set and `cancelled` becomes true (e.g. the caller's overall request
 *   timeout fired), no further retry attempts are started.
 */
async function renderWithRetries(url, options = {}) {
  const { cancellationToken } = options;
  let lastError;

  for (let attempt = 1; attempt <= config.maxRetries; attempt += 1) {
    if (cancellationToken && cancellationToken.cancelled) {
      throw new RenderTimeoutError('Request was cancelled before this attempt started', { url });
    }

    try {
      logger.info('Render attempt starting', { url, attempt, maxRetries: config.maxRetries });
      const result = await renderOnce(url, options);
      logger.info('Render attempt succeeded', { url, attempt, status: result.status });
      return result;
    } catch (err) {
      lastError = err;
      logger.warn('Render attempt failed', {
        url,
        attempt,
        error: err.message,
        code: err.code || 'UNKNOWN',
      });

      const isLastAttempt = attempt === config.maxRetries;
      if (isLastAttempt) break;

      const delay = computeBackoffDelay(attempt);
      logger.info('Retrying after backoff', { url, attempt, delayMs: delay });
      await sleep(delay);
    }
  }

  throw lastError || new RenderTimeoutError(`Failed to render ${url} after ${config.maxRetries} attempts`, { url });
}

module.exports = { renderWithRetries };
