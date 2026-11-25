'use strict';

/**
 * Deterministic recommendation engine. Given a validated household profile and
 * an air-quality reading, it returns prioritised, explainable recommendations.
 *
 * The GenAI layer only *narrates* this output: every number shown to the user
 * originates here, so advice stays consistent, testable and auditable.
 *
 *   risk.js          AQI band, household-adjusted risk, headline
 *   routine.js       time-of-day routine (forecast-aware)
 *   indoorHacks.js   indoor air-quality actions
 *   alternatives.js  sustainable swaps with quantified impact
 *   impact.js        weekly/annual CO₂ totals
 *   communityAlert.js shareable neighbourhood message
 */

const { assessRisk, classifyAqi } = require('./risk');
const { buildRoutine } = require('./routine');
const { buildIndoorHacks } = require('./indoorHacks');
const { buildAlternatives } = require('./alternatives');
const { summariseImpact, weeklyCommuteKm } = require('./impact');
const { buildCommunityAlert } = require('./communityAlert');

/**
 * Builds the full plan for one household.
 * @param {import('./shared').Profile} profile validated profile
 * @param {{ aqi: number, forecast?: any }} air air-quality reading
 */
function buildPlan(profile, air) {
  const risk = assessRisk(profile, air.aqi);
  const alternatives = buildAlternatives(profile, risk);
  return {
    risk,
    routine: buildRoutine(profile, risk, air.forecast),
    indoorHacks: buildIndoorHacks(profile, risk),
    alternatives,
    impactSummary: summariseImpact(alternatives),
  };
}

module.exports = {
  buildPlan,
  assessRisk,
  classifyAqi,
  buildRoutine,
  buildIndoorHacks,
  buildAlternatives,
  summariseImpact,
  weeklyCommuteKm,
  buildCommunityAlert,
};
