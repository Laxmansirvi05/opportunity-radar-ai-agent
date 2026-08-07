'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { buildProfile, ProfileBuildError } = require('./index');
const { loadConfig } = require('./config');

const app = express();
const PORT = process.env.PORT || 4100;

// Middleware to parse JSON bodies.
app.use(express.json({ limit: '1mb' }));

// Constant-time key comparison (no timing oracle for brute-forcing the key).
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // equal-length dummy compare, no leak
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Structured (JSON) unhandled-error log, matching the rest of the system.
function logError(err) {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'profile-builder',
      event: 'unhandled_server_error',
      message: err && err.message,
    }) + '\n'
  );
}

// Optional API-key gate for this service's endpoints. Enabled only when
// PROFILE_BUILDER_API_KEY is set; the /health route stays open regardless.
let profileApiKey = null;
try { profileApiKey = loadConfig().profileApiKey; } catch { /* gateway key missing; auth simply disabled */ }
if (profileApiKey) {
  app.use((req, res, next) => {
    const provided = req.get('x-api-key') || '';
    if (!provided || !safeCompare(provided, profileApiKey)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' } });
    }
    next();
  });
}

// Catch JSON parsing errors to prevent stack trace leaks
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' }
    });
  }
  next(err);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
const { getCandidateProfile } = require('../../data/src/repositories/candidate-repository');

app.post('/profile/build', async (req, res) => {
  try {
    // buildProfile accepts the parsed resume object directly
    const result = await buildProfile(req.body);
    const profileRow = await getCandidateProfile(result.candidateId);
    res.status(200).json({ ...result, cip: profileRow.profile_json });
  } catch (error) {
    if (error instanceof ProfileBuildError) {
      // Distinguish between bad input (400) and internal failures (500)
      const isClientError = ['INVALID_INPUT', 'CIP_VALIDATION_FAILED'].includes(error.code);
      const statusCode = isClientError ? 400 : 500;
      
      res.status(statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          context: error.context || {}
        }
      });
    } else {
      logError(error);
      res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred'
        }
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Profile Builder API listening on port ${PORT}`);
});
