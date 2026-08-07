'use strict';

/**
 * app.js — HTTP surface for the job server.
 *
 *   POST /api/jobs         multipart PDF -> { job_id, status: "processing" }
 *   GET  /api/jobs/:job_id -> processing | complete (+result) | failed (+error)
 *
 * Multipart parsing is done by hand rather than pulling in a dependency: we
 * accept exactly one field, and the parser must enforce the size cap while
 * streaming rather than after buffering.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const PDF_MAGIC = Buffer.from('%PDF-');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorBody(code, message) {
  return { error: { code, message } };
}

/** Collect a request body, aborting as soon as the cap is exceeded. */
function readBodyCapped(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        const err = new Error('FILE_TOO_LARGE');
        err.code = 'FILE_TOO_LARGE';
        // Stop accumulating (so an oversized upload cannot exhaust memory) but
        // do NOT destroy the socket here — the 413 still has to reach the
        // client, and tearing the connection down first surfaces as a network
        // error instead of a status code.
        chunks.length = 0;
        req.on('data', () => {});
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

/**
 * Extract the first file part from a multipart body.
 * @returns {{ filename: string|null, content: Buffer, fieldName: string|null }|null}
 */
function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = `--${(m[1] || m[2]).trim()}`;
  const parts = [];
  let start = buffer.indexOf(boundary);
  if (start === -1) return null;
  start += boundary.length;

  while (start < buffer.length) {
    if (buffer.slice(start, start + 2).toString() === '--') break; // closing boundary
    const next = buffer.indexOf(boundary, start);
    if (next === -1) break;
    // Skip the CRLF after the boundary line.
    const chunk = buffer.slice(start, next);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = chunk.slice(0, headerEnd).toString();
      // Body ends with a trailing CRLF before the next boundary.
      let body = chunk.slice(headerEnd + 4);
      if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
      const nameMatch = /name="([^"]*)"/i.exec(headers);
      const fileMatch = /filename="([^"]*)"/i.exec(headers);
      parts.push({
        fieldName: nameMatch ? nameMatch[1] : null,
        filename: fileMatch ? fileMatch[1] : null,
        content: body,
      });
    }
    start = next + boundary.length;
  }
  return parts.find((p) => p.filename !== null) || null;
}

function createApp({ repository, config, logger = console, onSubmit }) {
  const app = express();
  app.disable('x-powered-by');

  fs.mkdirSync(config.uploadDir, { recursive: true });

  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });

  // CORS is OFF unless explicitly enabled. Opportunity Radar's backend proxies
  // this service; the browser must never call it directly.
  if (config.enableCors) {
    if (!config.corsOrigin) throw new Error('CORS_ORIGIN is required when ENABLE_CORS=true');
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  app.post('/api/jobs', async (req, res) => {
    const contentType = req.get('content-type') || '';
    if (!/multipart\/form-data/i.test(contentType)) {
      return res.status(400).json(errorBody('MISSING_FILE', 'Expected multipart/form-data with a "resume" file'));
    }

    let raw;
    try {
      raw = await readBodyCapped(req, config.maxUploadBytes);
    } catch (error) {
      if (error.code === 'FILE_TOO_LARGE') {
        // Close the connection once the response is on the wire, so the rest of
        // an oversized upload is not read.
        res.on('finish', () => { if (!req.destroyed) req.destroy(); });
        return res.status(413).json(errorBody(
          'FILE_TOO_LARGE',
          `Resume exceeds the ${config.maxUploadBytes} byte limit`
        ));
      }
      return res.status(500).json(errorBody('INTERNAL_ERROR', 'Could not read the upload'));
    }

    const part = parseMultipart(raw, contentType);
    if (!part || !part.content || part.content.length === 0) {
      return res.status(400).json(errorBody('MISSING_FILE', 'No resume file was provided'));
    }

    // Validate by magic bytes, not by the client-supplied filename — a .pdf
    // extension proves nothing.
    const isPdf = part.content.slice(0, PDF_MAGIC.length).equals(PDF_MAGIC);
    if (!isPdf) {
      return res.status(415).json(errorBody('INVALID_FILE_TYPE', 'Resume must be a PDF'));
    }

    let job;
    try {
      const safeName = path.basename(part.filename || 'resume.pdf').replace(/[^\w.\-]/g, '_');
      const target = path.join(config.uploadDir, `${crypto.randomUUID()}-${safeName}`);
      fs.writeFileSync(target, part.content);
      job = await repository.create({
        filename: safeName,
        bytes: part.content.length,
        path: target,
      });
    } catch (error) {
      logger.error?.('job_create_failed', { message: error.message });
      return res.status(500).json(errorBody('INTERNAL_ERROR', 'Could not accept the job'));
    }

    if (onSubmit) { try { onSubmit(job); } catch { /* worker poll will pick it up */ } }

    return res.status(202).json({ job_id: job.id, status: 'processing' });
  });

  app.get('/api/jobs/:job_id', async (req, res) => {
    const { job_id: jobId } = req.params;
    if (!UUID_RE.test(jobId)) {
      return res.status(404).json(errorBody('JOB_NOT_FOUND', 'No job with that id'));
    }
    let job;
    try {
      job = await repository.get(jobId);
    } catch (error) {
      return res.status(500).json(errorBody('INTERNAL_ERROR', 'Could not read the job'));
    }
    if (!job) return res.status(404).json(errorBody('JOB_NOT_FOUND', 'No job with that id'));

    // queued and running are both "processing" to the caller.
    const status = job.status === 'complete' || job.status === 'failed' ? job.status : 'processing';
    const body = {
      job_id: job.id,
      status,
      created_at: job.created_at,
      completed_at: job.completed_at || null,
    };
    if (status === 'complete') body.result = job.result;
    if (status === 'failed') body.error = job.error;
    return res.status(200).json(body);
  });

  app.use((req, res) => res.status(404).json(errorBody('JOB_NOT_FOUND', 'Route not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error?.('unhandled_error', { requestId: req.requestId, message: error.message });
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  return app;
}

module.exports = { createApp, parseMultipart };
