'use strict';

const { chromium } = require('playwright');
const config = require('./config');
const logger = require('./logger');
const { BrowserUnavailableError } = require('./errors');

/**
 * Owns the single Chromium browser process for the whole service.
 *
 * Design notes:
 * - The browser itself is launched exactly once and reused across every
 *   request (launching Chromium per-request would be far too slow/expensive
 *   at production volume).
 * - Every individual REQUEST gets its own isolated BrowserContext (like an
 *   incognito window), so cookies/localStorage/auth state from one request
 *   can never bleed into another. Contexts are always closed by the caller.
 * - If the browser process crashes or is killed, Playwright emits a
 *   'disconnected' event. We clear our reference so the NEXT request
 *   transparently relaunches a fresh browser instead of the service staying
 *   permanently broken.
 * - This class is the one intentional piece of global mutable state in the
 *   service, exported as a singleton.
 */
class BrowserManager {
  constructor() {
    this.browser = null;
    this.launchPromise = null; // guards against concurrent double-launch
    this.activePages = 0;
    this.isShuttingDown = false;

    // Recycling / observability state.
    this.launchedAt = null;
    this.pagesServedByCurrentBrowser = 0;
    this.restartCount = 0;
  }

  /** Returns a connected browser instance, launching or relaunching as needed. */
  async getBrowser() {
    if (this.isShuttingDown) {
      throw new BrowserUnavailableError('Service is shutting down, no new browser sessions accepted');
    }

    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    // If a launch is already in flight (e.g. two concurrent requests both
    // found no browser), piggyback on it instead of racing two launches.
    if (this.launchPromise) {
      return this.launchPromise;
    }

    this.launchPromise = this._launch();
    try {
      return await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  async _launch() {
    logger.info('Launching Chromium browser instance');
    const browser = await chromium.launch({
      headless: config.headless,
      args: config.browserLaunchArgs,
    });

    browser.on('disconnected', () => {
      logger.warn('Browser process disconnected, will relaunch on next request');
      if (this.browser === browser) {
        this.browser = null;
        this.restartCount += 1;
      }
    });

    this.browser = browser;
    this.launchedAt = Date.now();
    this.pagesServedByCurrentBrowser = 0;
    logger.info('Chromium browser launched successfully');
    return browser;
  }

  /**
   * Creates a fresh, isolated context for a single request. Callers are
   * responsible for closing it (always in a finally block).
   */
  async createContext() {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: config.userAgent,
      viewport: config.viewport,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
    });
    context.setDefaultNavigationTimeout(config.navigationTimeoutMs);
    context.setDefaultTimeout(config.navigationTimeoutMs);
    return context;
  }

  trackPageOpen() {
    this.activePages += 1;
    this.pagesServedByCurrentBrowser += 1;
  }

  trackPageClose() {
    this.activePages = Math.max(0, this.activePages - 1);
    if (this.activePages === 0) {
      this._recycleIfDue().catch((err) => {
        logger.error('Error while recycling browser', { error: err.message });
      });
    }
  }

  /** Whether the current browser has exceeded its configured page/age limit. */
  _isRecycleDue() {
    if (!this.browser) return false;
    if (config.browserMaxPages > 0 && this.pagesServedByCurrentBrowser >= config.browserMaxPages) {
      return true;
    }
    if (config.browserMaxAgeMs > 0 && this.launchedAt && Date.now() - this.launchedAt >= config.browserMaxAgeMs) {
      return true;
    }
    return false;
  }

  /**
   * Closes and clears the current browser IF it's due for recycling AND no
   * pages are active. Never called while activePages > 0, so an in-flight
   * request is never interrupted - the next getBrowser() call transparently
   * launches a fresh instance, exactly like the crash-recovery path.
   */
  async _recycleIfDue() {
    if (this.isShuttingDown || this.activePages > 0 || !this._isRecycleDue()) return;
    const browser = this.browser;
    if (!browser) return;

    logger.info('Recycling browser after reaching configured limit', {
      pagesServed: this.pagesServedByCurrentBrowser,
      ageMs: this.launchedAt ? Date.now() - this.launchedAt : null,
    });

    this.browser = null; // so any concurrent getBrowser() launches fresh rather than reusing a closing browser
    this.restartCount += 1;
    try {
      await browser.close();
    } catch (err) {
      logger.warn('Error while closing recycled browser', { error: err.message });
    }
  }

  isRunning() {
    return Boolean(this.browser && this.browser.isConnected());
  }

  /** Snapshot of operational metrics for the /health endpoint. */
  getMetrics() {
    return {
      running: this.isRunning(),
      activePages: this.activePages,
      pagesServedByCurrentBrowser: this.pagesServedByCurrentBrowser,
      restartCount: this.restartCount,
      launchedAt: this.launchedAt ? new Date(this.launchedAt).toISOString() : null,
    };
  }

  /** Closes the browser. Called once during graceful shutdown. */
  async shutdown() {
    this.isShuttingDown = true;
    if (this.browser) {
      logger.info('Closing browser instance');
      try {
        await this.browser.close();
      } catch (err) {
        logger.error('Error while closing browser', { error: err.message });
      }
      this.browser = null;
    }
  }
}

module.exports = new BrowserManager();
