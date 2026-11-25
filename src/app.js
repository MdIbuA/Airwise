'use strict';

const path = require('node:path');
const express = require('express');
const compression = require('compression');

const { securityHeaders, sameOriginOnly, requireJson, createRateLimiters } = require('./middleware/security');
const { createErrorHandler } = require('./middleware/errorHandler');
const { createApiRouter } = require('./routes/api');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Builds the Express app. Services are injected so tests can run fully offline.
 *
 * @param {object} deps
 * @param {{ getAirQuality: Function }} deps.airQuality
 * @param {{ narrate: Function, isActive: boolean }} deps.assistant
 * @param {number} [deps.rateLimitPerMinute] general API requests per minute per IP
 * @param {{ error: Function }} [deps.logger]
 */
function createApp({ airQuality, assistant, rateLimitPerMinute = 30, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs behind Render / Cloud Run proxies

  app.use(securityHeaders());
  app.use(compression()); // gzip JSON + static assets
  app.use(express.json({ limit: '10kb' }));

  const { apiLimiter, aiLimiter } = createRateLimiters(rateLimitPerMinute);
  app.use('/api', apiLimiter, sameOriginOnly, requireJson, createApiRouter({ airQuality, assistant, aiLimiter }));

  app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: 'index.html' }));
  app.use(createErrorHandler(logger));
  return app;
}

module.exports = { createApp };
