'use strict';

const express = require('express');
const config = require('../config');
const logger = require('../logger');
const requestQueue = require('../requestQueue');
const { renderWithRetries } = require('../renderer');
const { ValidationError, RenderTimeoutError } = require('../errors');

const router = express.Router();

/**
 * Checks whether a hostname is a literal loopback/private/link-local
 * address (IPv4 or IPv6), which would let this service be used as an SSRF
 * pivot into the internal network/cloud metadata endpoint if reachable.
 * Only catches IP literals, not private hosts hidden behind a public DNS
 * name (DNS-rebinding) - see README for that residual-risk note.
 */
function isPrivateOrReservedHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0') return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (a === 0 || a === 127) return true; // 0.0.0.0/8, loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
    return false;
  }

  const v6 = host.replace(/^\[|\]$/g, '');
  if (v6 === '::1') return true;
  if (/^fe80:/i.test(v6)) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(v6)) return true; // unique local, fc00::/7

  return false;
}

/** Validates and normalizes the incoming URL. Throws ValidationError on any problem. */
function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new ValidationError('"url" is required and must be a string');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new ValidationError(`"url" is not a valid URL: ${rawUrl}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  if (config.blockPrivateNetworkTargets && isPrivateOrReservedHost(parsed.hostname)) {
    throw new ValidationError(`URL host is not allowed: ${parsed.hostname}`);
  }

  return parsed.toString();
}

/**
 * Wraps queued rendering with an overall wall-clock budget. If it fires:
 *   - any in-flight browser context is force-closed (aborting navigation)
 *   - a cancellation token stops any further retry attempts from starting
 * A request that is still sitting in the queue (not yet started) when this
 * fires will still be skipped on its next attempt via the cancellation
 * token, though the queue slot itself is only freed once that task exits.
 */
function renderWithOverallTimeout(url) {
  const cancellationToken = { cancelled: false };
  let activeContext = null;
  let timer;

  const renderPromise = requestQueue.enqueue(() =>
    renderWithRetries(url, {
      cancellationToken,
      onContextCreated: (context) => {
        activeContext = context;
      },
    })
  );

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      cancellationToken.cancelled = true;
      if (activeContext) {
        activeContext.close().catch(() => {});
      }
      reject(
        new RenderTimeoutError(`Request exceeded overall timeout of ${config.requestTimeoutMs}ms`, {
          url,
          timeoutMs: config.requestTimeoutMs,
        })
      );
    }, config.requestTimeoutMs);
  });

  return Promise.race([renderPromise, timeoutPromise]).finally(() => clearTimeout(timer));
}

router.post('/fetch', async (req, res, next) => {
  const startedAt = Date.now();

  try {
    const url = validateUrl(req.body && req.body.url);
    logger.info('Fetch request received', { url });

    const result = await renderWithOverallTimeout(url);
    const renderTimeMs = Date.now() - startedAt;

    logger.info('Fetch request completed', { url, status: result.status, renderTimeMs });

    res.status(200).json({
      success: true,
      url,
      finalUrl: result.finalUrl,
      title: result.title,
      status: result.status,
      html: result.html,
      renderedAt: new Date().toISOString(),
      renderTimeMs,
      redirected: result.redirected,
      jsRendered: result.jsRendered,
      cloudflareDetected: result.cloudflareDetected,
      contentLength: result.contentLength,
      browserEngine: result.browserEngine,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
