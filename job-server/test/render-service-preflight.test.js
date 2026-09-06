'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { assertRenderServiceAuth } = require('../src/pipeline-runner');

const fingerprint = (key) => crypto.createHash('sha256').update(key).digest('hex');

test('render-service preflight accepts a matching renderer key fingerprint', async () => {
  let requestedUrl;
  await assertRenderServiceAuth({
    renderServiceUrl: 'http://renderer.internal:3100',
    renderServiceApiKey: 'renderer-secret',
    requestHealth: async (url) => {
      requestedUrl = url;
      return {
        status: 200,
        body: { auth: { enabled: true, apiKeyFingerprint: fingerprint('renderer-secret') } },
      };
    },
  });
  assert.equal(requestedUrl, 'http://renderer.internal:3100/health');
});

test('render-service preflight fails loudly for a mismatched key', async () => {
  await assert.rejects(
    assertRenderServiceAuth({
      renderServiceApiKey: 'n8n-key',
      requestHealth: async () => ({
        status: 200,
        body: { auth: { enabled: true, apiKeyFingerprint: fingerprint('renderer-key') } },
      }),
    }),
    /does not match render-service API_KEY.*401\/empty rendered pages/
  );
});

test('render-service preflight rejects an unprotected renderer', async () => {
  await assert.rejects(
    assertRenderServiceAuth({
      renderServiceApiKey: 'n8n-key',
      requestHealth: async () => ({ status: 200, body: { auth: { enabled: false } } }),
    }),
    /no API_KEY-enabled health identity/
  );
});
