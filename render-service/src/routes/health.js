'use strict';

const express = require('express');
const browserManager = require('../browserManager');
const requestQueue = require('../requestQueue');

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
    memoryUsage: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
    },
  });
});

module.exports = router;
