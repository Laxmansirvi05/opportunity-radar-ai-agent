'use strict';

const express = require('express');
const { buildSearchPlan, SearchPlanError } = require('./search-planner');

const app = express();
const PORT = process.env.PORT || 4200;

// Middleware to parse JSON bodies.
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/search-plan/build', async (req, res) => {
  try {
    const { candidateId, cip } = req.body;
    if (!candidateId || !cip) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'candidateId and cip are required' } });
    }

    const result = await buildSearchPlan({ candidateId, cip });
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof SearchPlanError) {
      res.status(400).json({
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
  console.log(`Search Planner API listening on port ${PORT}`);
});
