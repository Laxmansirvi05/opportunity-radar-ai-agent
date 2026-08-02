'use strict';

const express = require('express');
const { buildSearchPlan, SearchPlanError } = require('./search-planner');

// Injected lazily to avoid circular-require during unit tests.
let _repo = null;
function getRepo() {
  if (!_repo) _repo = require('../../data/src/repositories/search-plan-repository');
  return _repo;
}

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

    // Fetch the full plan_json so n8n can fan out directly without a second round-trip.
    const row = await getRepo().getSearchPlanById(result.planId);
    const queries = (row && row.plan_json && row.plan_json.queries) || [];

    res.status(200).json({
      planId:      result.planId,
      candidateId: result.candidateId,
      queryCount:  result.queryCount,
      planVersion: result.planVersion,
      planHash:    result.planHash,
      queries,
    });
  } catch (error) {
    if (error instanceof SearchPlanError) {
      res.status(400).json({
        error: {
          code:    error.code,
          message: error.message,
          context: error.context || {}
        }
      });
    } else {
      console.error('Unhandled server error:', error);
      res.status(500).json({
        error: {
          code:    'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred'
        }
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Search Planner API listening on port ${PORT}`);
});
