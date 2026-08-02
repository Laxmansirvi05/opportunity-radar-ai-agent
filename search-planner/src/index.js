'use strict';

/**
 * index.js — Search Planner public entry point
 *
 * Ensures config (dotenv) is loaded before anything else.
 * Exports only the public API surface.
 */

require('./config'); // dotenv must load before data package reads process.env

const { buildSearchPlan, SearchPlanError } = require('./search-planner');

module.exports = { buildSearchPlan, SearchPlanError };
