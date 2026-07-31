'use strict';

/**
 * Profile Builder — Public Entry Point
 *
 * This file must be required FIRST in any process that uses the profile-builder.
 * It requires config.js which calls dotenv.config() before any other module
 * is loaded, ensuring process.env is populated before the shared data package
 * reads PostgreSQL configuration from environment variables.
 *
 * Usage:
 *   const { buildProfile } = require('./profile-builder/src');
 *   const result = await buildProfile(parsedResumeObject);
 */

// Load env vars before anything else — must be first require.
require('./config');

const { buildProfile, ProfileBuildError, computeResumeHash } = require('./profile-builder');

module.exports = { buildProfile, ProfileBuildError, computeResumeHash };
