'use strict';

const config = require('./config');

/** Checks whether a request URL's hostname matches a known ad/analytics domain. */
function isBlockedDomain(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    // Exact host match or proper subdomain match only - a naive
    // hostname.includes(domain) would also match unrelated hosts that
    // merely contain the string (e.g. "notgoogle-analytics.com" or
    // "my-segment.io.example.com"), blocking legitimate page content.
    return config.blockedDomains.some((domain) => {
      const blocked = domain.toLowerCase();
      return host === blocked || host.endsWith(`.${blocked}`);
    });
  } catch (err) {
    // Malformed URL (e.g. data: URIs) - never block on parse failure.
    return false;
  }
}

/**
 * Registers request interception on a page to abort heavy or non-essential
 * network traffic before it's fetched:
 *   - images / fonts / media (configurable resource types)
 *   - known ad, analytics, and session-replay domains
 *
 * Stylesheets are deliberately NEVER blocked - pages need CSS to render
 * correctly, and layout-dependent JS (e.g. libraries that check computed
 * styles) can misbehave without it.
 */
async function applyResourceBlocking(page) {
  await page.route('**/*', (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url();

    if (config.blockedResourceTypes.includes(resourceType)) {
      return route.abort();
    }

    if (isBlockedDomain(url)) {
      return route.abort();
    }

    return route.continue();
  });
}

module.exports = { applyResourceBlocking, isBlockedDomain };
