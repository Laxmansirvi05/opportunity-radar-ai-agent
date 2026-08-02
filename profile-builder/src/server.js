'use strict';

const express = require('express');
const { buildProfile, ProfileBuildError } = require('./index');

const app = express();
const PORT = process.env.PORT || 4100;

// Middleware to parse JSON bodies.
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/profile/build', async (req, res) => {
  try {
    // buildProfile accepts the parsed resume object directly
    const result = await buildProfile(req.body);
    res.status(200).json(result);
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
      console.error('Unhandled server error:', error);
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
