'use strict';

const http = require('http');
const config = require('./config');
const logger = require('./logger');
const createApp = require('./app');
const browserManager = require('./browserManager');

async function main() {
  const app = createApp();
  const server = http.createServer(app);

  // Pre-warm the browser at startup so the first real request isn't slowed
  // down by a cold Chromium launch. Non-fatal if it fails here - getBrowser()
  // will simply try again on the first incoming request.
  try {
    await browserManager.getBrowser();
  } catch (err) {
    logger.error('Failed to pre-warm browser on startup', { error: err.message });
  }

  server.listen(config.port, config.host, () => {
    logger.info('Playwright rendering service started', {
      port: config.port,
      host: config.host,
      maxConcurrency: config.maxConcurrency,
    });
  });

  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, starting graceful shutdown', { signal });

    // Hard safety net: never hang forever during shutdown.
    const forceExitTimer = setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExitTimer.unref();

    server.close(async (err) => {
      if (err) {
        logger.error('Error while closing HTTP server', { error: err.message });
      } else {
        logger.info('HTTP server closed, no longer accepting new connections');
      }

      await browserManager.shutdown();
      clearTimeout(forceExitTimer);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    // The process is in an undefined state after an uncaught exception -
    // shut down as cleanly as possible rather than limping along.
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.error('Fatal error during startup', { error: err.message, stack: err.stack });
  process.exit(1);
});
