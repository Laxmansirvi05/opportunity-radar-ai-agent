'use strict';

const express = require('express');
const browserManager = require('../browserManager');
const requestQueue = require('../requestQueue');
const config = require('../config');
const { apiKeyFingerprint } = require('../auth');

const router = express.Router();

router.get('/health', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const browserMetrics = browserManager.getMetrics();

  res.status(200).json({
    status: 'ok',
    browserRunning: browserMetrics.running,
    uptime: process.uptime(),
    activePages: browserMetrics.activePages,
    queuedRequests: requestQueue.queuedCount,
    completedRequests: requestQueue.completedCount,
    failedRequests: requestQueue.failedCount,
    browserRestarts: browserMetrics.restartCount,
    pagesServedByCurrentBrowser: browserMetrics.pagesServedByCurrentBrowser,
    browserLaunchedAt: browserMetrics.launchedAt,
    // A SHA-256 fingerprint is safe to expose to the internal caller and lets
    // the job server fail before n8n starts if its key differs from API_KEY.
    // Never return API_KEY itself here.
    auth: {
      enabled: Boolean(config.apiKey),
      apiKeyFingerprint: apiKeyFingerprint(config.apiKey),
    },
    memoryUsage: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
    },
  });
});

module.exports = router;
