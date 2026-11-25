'use strict';

const express = require('express');
const { validateProfile, validateCity, ENUMS } = require('../utils/validation');
const { AppError } = require('../utils/errors');
const { buildPlan, classifyAqi, buildCommunityAlert } = require('../services/recommendationEngine');
const { templateNarrative } = require('../services/assistant');

/**
 * JSON API. Express 5 forwards rejected promises from async handlers to the
 * error handler, so routes contain no try/catch boilerplate.
 *
 * @param {object} deps
 * @param {{ getAirQuality: Function }} deps.airQuality
 * @param {{ narrate: Function, isActive: boolean }} deps.assistant
 * @param {import('express').RequestHandler} deps.aiLimiter tighter limit for the LLM endpoint
 */
function createApiRouter({ airQuality, assistant, aiLimiter }) {
  const router = express.Router();

  /** Validated profile + air reading (manual override or live, cached) + plan. */
  async function resolveRequest(body) {
    const profile = validateProfile(body);
    const air =
      profile.manualAqi !== null
        ? {
            aqi: profile.manualAqi,
            location: { name: profile.city, country: '' },
            forecast: null,
            source: 'Manual entry',
          }
        : await airQuality.getAirQuality(profile.city);
    return { profile, air, plan: buildPlan(profile, air) };
  }

  router.get('/health', (_req, res) => res.json({ status: 'ok' }));

  router.get('/options', (_req, res) => res.json(ENUMS));

  router.get('/air', async (req, res) => {
    const city = validateCity(req.query.city);
    const air = await airQuality.getAirQuality(city);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ...air, band: classifyAqi(air.aqi) });
  });

  // Fast path: the full plan from the rule engine, no LLM wait.
  // The client then upgrades the briefing via /narrative if AI is on.
  router.post('/plan', async (req, res) => {
    const { profile, air, plan } = await resolveRequest(req.body);
    res.set('Cache-Control', 'no-store');
    res.json({
      air,
      ...plan,
      narrative: { ...templateNarrative(plan, profile), source: 'rules' },
      aiAvailable: Boolean(assistant.isActive),
      communityAlert: buildCommunityAlert(plan, air, profile.city),
    });
  });

  // Slow path: the AI briefing (time-boxed inside the assistant; never throws).
  router.post('/narrative', aiLimiter, async (req, res) => {
    const { profile, air, plan } = await resolveRequest(req.body);
    res.set('Cache-Control', 'no-store');
    res.json({ narrative: await assistant.narrate(plan, profile, air) });
  });

  router.use((_req, _res, next) => next(new AppError('Not found.', 404)));
  return router;
}

module.exports = { createApiRouter };
