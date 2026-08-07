'use strict';

const path = require('node:path');
const { Pool } = require('pg');
const config = require('./config');
const { createApp } = require('./app');
const { createPgRepository } = require('./job-repository');
const { JobWorker } = require('./worker');
const { createCliRunner, createStubRunner } = require('./pipeline-runner');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const logger = {
  info: (event, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event, ...data })),
  warn: (event, data = {}) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event, ...data })),
  error: (event, data = {}) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event, ...data })),
};

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'opportunity_radar',
  user: process.env.PGUSER || undefined,
  password: process.env.PGPASSWORD || undefined,
});

const repository = createPgRepository(pool);

// STUB_PIPELINE lets the server run end-to-end with a captured response and no
// API calls. Used for the job-server verification suite.
const runPipeline = process.env.STUB_PIPELINE
  ? createStubRunner({ fromFile: process.env.STUB_PIPELINE })
  : createCliRunner({ repoRoot: REPO_ROOT, logger });

const worker = new JobWorker({ repository, runPipeline, config, logger });
const app = createApp({ repository, config, logger, onSubmit: () => worker.tick() });

const server = app.listen(config.port, () => {
  logger.info('job_server_listening', {
    port: config.port,
    cors: config.enableCors,
    stub: Boolean(process.env.STUB_PIPELINE),
  });
  worker.start();
});

function shutdown(signal) {
  logger.info('shutting_down', { signal });
  worker.stop();
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, worker, repository };
