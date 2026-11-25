'use strict';

const F = require('../../data/factors');
const { byPriority } = require('./shared');

/** @typedef {import('./shared').Profile} Profile */
/** @typedef {import('./shared').Risk} Risk */
/** @typedef {import('./shared').Recommendation} Recommendation */

/** Clean-air delivery rate a typical 12 m² bedroom needs (m³/h). */
const BEDROOM_CADR = Math.round(F.TYPICAL_BEDROOM_M3 * F.PURIFIER_TARGET_ACH);

/**
 * Filtration advice depends on whether the household already owns a purifier.
 * @param {Profile} profile
 * @param {number} level household-adjusted risk level
 * @returns {Recommendation}
 */
function filtrationHack(profile, level) {
  const priority = level >= 2 ? 'high' : 'medium';
  if (profile.hasAirPurifier) {
    return {
      id: 'purifier-placement',
      title: 'Get more out of your purifier',
      detail:
        'Run it in one closed room rather than the whole house, keep it 30 cm from walls, and check the HEPA ' +
        `filter monthly in smog season. For a 12 m² bedroom you need a CADR of about ${BEDROOM_CADR} m³/h.`,
      priority,
      impact: {
        kind: 'exposure',
        exposureReductionPct: [50, 80],
        explanation:
          'A correctly sized HEPA purifier in a closed room typically removes half to four-fifths of indoor PM2.5.',
      },
    };
  }
  return {
    id: 'diy-filter-fan',
    title: 'Build a DIY filter fan (box fan + MERV-13 filter)',
    detail:
      'Strap a MERV-13/HEPA-grade filter to the intake side of a box or table fan. It costs a fraction of a ' +
      `purifier and delivers roughly the ${BEDROOM_CADR} m³/h CADR a 12 m² bedroom needs.`,
    priority,
    impact: {
      kind: 'exposure',
      exposureReductionPct: [40, 70],
      explanation:
        'Independent tests of DIY filter fans show indoor PM2.5 reductions comparable to ' +
        'entry-level purifiers in a closed room.',
    },
  };
}

/**
 * Hacks that apply to every household; only "seal-gaps" priority depends on severity.
 * @param {number} level household-adjusted risk level
 * @returns {Recommendation[]}
 */
function generalHacks(level) {
  return [
    {
      id: 'seal-gaps',
      title: 'Seal the clean room',
      detail:
        'Use foam weather-strips or a rolled towel on window and door gaps of the room where ' +
        'sensitive members spend most time.',
      priority: level >= 3 ? 'high' : 'medium',
      impact: {
        kind: 'exposure',
        exposureReductionPct: [10, 30],
        explanation: 'Less infiltration means your filter works on clean recirculated air instead of fresh smog.',
      },
    },
    {
      id: 'smart-ventilation',
      title: 'Ventilate by the forecast, not by habit',
      detail:
        'Air out the home briefly during the cleanest forecast window shown above, then close up. Short bursts avoid ' +
        'CO₂ and moisture build-up without importing peak smog.',
      priority: 'medium',
      impact: {
        kind: 'exposure',
        exposureReductionPct: [10, 25],
        explanation: 'Shifting ventilation from peak to off-peak hours cuts the PM2.5 you let in.',
      },
    },
    {
      id: 'wet-cleaning',
      title: 'Wet-mop and damp-dust instead of sweeping',
      detail: 'Dry sweeping re-suspends settled fine dust. A damp cloth and mop trap it.',
      priority: 'low',
      impact: {
        kind: 'exposure',
        exposureReductionPct: [5, 10],
        explanation: 'Reduces re-suspended indoor dust, especially near floor level where children play.',
      },
    },
    {
      id: 'no-indoor-smoke',
      title: 'Cut indoor smoke sources',
      detail:
        'Swap incense sticks, dhoop, mosquito coils and candles for electric diffusers / ' +
        'mosquito nets. Never smoke indoors.',
      priority: 'medium',
      impact: {
        kind: 'exposure',
        exposureReductionPct: [10, 40],
        explanation: 'One burning mosquito coil can release as much PM2.5 as dozens of cigarettes.',
      },
    },
    {
      id: 'plants-myth',
      title: 'Myth check: house plants will not clean smog',
      detail:
        'You would need hundreds of plants per room to match one filter. Keep plants for ' +
        'wellbeing, but rely on filtration for PM2.5.',
      priority: 'low',
      impact: {
        kind: 'awareness',
        exposureReductionPct: null,
        explanation: 'Avoids spending money on solutions that do not measurably reduce PM2.5.',
      },
    },
  ];
}

/**
 * Indoor air-quality hacks with explained impact, ordered by priority.
 * @param {Profile} profile
 * @param {Risk} risk
 * @returns {Recommendation[]}
 */
function buildIndoorHacks(profile, risk) {
  const level = risk.effectiveLevel;
  return byPriority([filtrationHack(profile, level), ...generalHacks(level)]);
}

module.exports = { buildIndoorHacks, BEDROOM_CADR };
