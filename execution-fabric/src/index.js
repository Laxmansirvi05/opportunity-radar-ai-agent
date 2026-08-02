'use strict';

/**
 * index.js — Execution Fabric public entry point
 *
 * Ensures config (dotenv) is loaded before anything else.
 * Exports only the public API surface.
 */

require('./config'); // dotenv must load before data package reads process.env

const { executeSearchPlan } = require('./orchestrator');

module.exports = { executeSearchPlan };
