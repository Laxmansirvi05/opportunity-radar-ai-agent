'use strict';

/**
 * adapters/web-render.js
 *
 * General-purpose web rendering adapter.
 *
 * Execution path:
 *   1. Call render-service POST /fetch with the target URL
 *   2. Truncate HTML to maxHtmlLength chars (guard against huge pages)
 *   3. Call AI Gateway POST /api/ai/chat with task=extract_opportunity
 *   4. Return the extracted, AI-gateway-validated opportunity
 *
 * This adapter is the FALLBACK for queries that do not match any structured
 * API adapter. It supports ALL query tiers (1, 2, 3, 4) but requires a
 * URL to be present in the query's `targetUrls` field, which the orchestrator
 * must populate from prior URL discovery (future sprint) or from a static
 * test URL list.
 *
 * For Sprint 3 testing, `targetUrls` is populated by the orchestrator from
 * a configurable test URL list when no structured API adapters match.
 *
 * Existing services (render-service and ai-gateway) are called exactly
 * as implemented — zero modifications to those services.
 */

const { ProviderHttpError } = require('../provider-interface');

/**
 * @param {string} url
 * @param {object} config
 * @param {number} timeoutMs
 */
async function renderUrl(url, config, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.renderServiceUrl}/fetch`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    config.renderServiceApiKey,
      },
      body:   JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new ProviderHttpError(res.status, `Render service returned ${res.status} for ${url}`, url);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof ProviderHttpError) throw err;
    if (err.name === 'AbortError') {
      const e = new Error(`Render service timed out for ${url}`);
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} html
 * @param {object} config
 * @param {number} timeoutMs
 */
async function extractOpportunity(html, config, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const truncatedHtml = html.slice(0, config.maxHtmlLength || 50_000);

  try {
    const res = await fetch(`${config.gatewayUrl}/api/ai/chat`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    config.gatewayApiKey,
      },
      body:   JSON.stringify({ task: 'extract_opportunity', input: truncatedHtml }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new ProviderHttpError(res.status, `AI Gateway returned ${res.status}`, config.gatewayUrl);
    }

    const body = await res.json();
    // AI Gateway returns { result: { ...opportunityFields } } or { result: opportunityJson }
    return body.result || body;
  } catch (err) {
    if (err instanceof ProviderHttpError) throw err;
    if (err.name === 'AbortError') {
      const e = new Error('AI Gateway timed out');
      e.code = 'ETIMEDOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const webRenderAdapter = {
  name: 'web-render',

  /**
   * Supports any query that has targetUrls populated.
   * targetUrls is set by the orchestrator (static test URLs or future URL discovery).
   */
  supports(query) {
    return Array.isArray(query.targetUrls) && query.targetUrls.length > 0;
  },

  async execute(query, { config, timeoutMs = 60_000 } = {}) {
    const urls    = query.targetUrls || [];
    const results = [];

    for (const url of urls) {
      // Render the page.
      const rendered = await renderUrl(url, config, timeoutMs);
      if (!rendered.success || !rendered.html) {
        // Non-fatal: skip URLs that didn't render successfully.
        continue;
      }

      // Extract structured opportunity from rendered HTML.
      const extracted = await extractOpportunity(rendered.html, config, timeoutMs);

      results.push({
        ...extracted,
        sourceUrl: url,
        rawJson:   extracted,
      });
    }

    return results;
  },
};

module.exports = webRenderAdapter;
