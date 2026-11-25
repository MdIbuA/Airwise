'use strict';

const { MAX_PRIORITIES } = require('./prompt');

/** @typedef {import('./prompt').Plan} Plan */
/** @typedef {import('../engine/shared').Profile} Profile */
/** @typedef {import('../../types').Narrative} Narrative */

const NO_AI_ANSWER =
  'Live AI answers are unavailable right now. The routine and hacks below are tailored to your profile; ' +
  'for health symptoms, please consult a doctor.';

/**
 * Picks the top actions: high-priority items first, topped up with the
 * remaining hacks and alternatives, without duplicates.
 * @param {Plan} plan
 * @returns {Narrative['priorities']}
 */
function topPriorities(plan) {
  const high = [...plan.alternatives, ...plan.indoorHacks].filter((item) => item.priority === 'high');
  const candidates = high.length >= MAX_PRIORITIES ? high : [...high, ...plan.indoorHacks, ...plan.alternatives];
  const seen = new Set();
  /** @type {Narrative['priorities']} */
  const priorities = [];
  for (const item of candidates) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    priorities.push({ action: item.title, impact: item.impact.explanation });
    if (priorities.length === MAX_PRIORITIES) break;
  }
  return priorities;
}

/**
 * Rule-based briefing, used instantly while the AI writes, and whenever the
 * AI is disabled, slow or failing. Same shape as the AI narrative.
 * @param {Plan} plan
 * @param {Profile} profile
 * @returns {Narrative}
 */
function templateNarrative(plan, profile) {
  const { risk } = plan;
  const { co2KgPerYear, treeEquivalent } = plan.impactSummary;
  const trees = treeEquivalent === 1 ? 'tree absorbs' : 'trees absorb';
  const savings =
    co2KgPerYear > 0
      ? ` Adopting the suggested swaps could avoid about ${co2KgPerYear} kg of CO₂ a year — ` +
        `roughly what ${treeEquivalent} ${trees}.`
      : '';
  return {
    summary: `AQI in ${profile.city} is ${risk.aqi} (${risk.category}). ${risk.headline}${savings}`,
    priorities: topPriorities(plan),
    answer: profile.question ? NO_AI_ANSWER : '',
  };
}

module.exports = { templateNarrative };
