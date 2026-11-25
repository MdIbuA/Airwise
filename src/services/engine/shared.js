'use strict';

/**
 * Shared types and helpers for the recommendation engine.
 *
 * @typedef {'high'|'medium'|'low'} Priority
 *
 * @typedef {object} Impact
 * @property {'exposure'|'emissions'|'both'|'community'|'awareness'} kind
 * @property {[number, number]|null} [exposureReductionPct] range of exposure reduction
 * @property {number} [co2KgPerWeek] CO₂ avoided per week
 * @property {number} [pm25GramsPerWeek] exhaust PM2.5 avoided per week
 * @property {string} explanation plain-language consequence of the choice
 *
 * @typedef {object} Recommendation
 * @property {string} id stable identifier
 * @property {string} title
 * @property {string} detail
 * @property {Priority} priority
 * @property {Impact} impact
 *
 * @typedef {object} Profile validated household profile (see utils/validation)
 * @property {string} city
 * @property {number} householdSize
 * @property {boolean} hasChildren
 * @property {boolean} hasElderly
 * @property {boolean} hasRespiratoryCondition
 * @property {boolean} isPregnant
 * @property {string} commuteMode
 * @property {number} commuteKm one-way distance
 * @property {string} heating
 * @property {string} cooking
 * @property {boolean} hasAirPurifier
 * @property {string} outdoorActivity
 * @property {string} question
 * @property {number|null} manualAqi
 *
 * @typedef {object} Risk
 * @property {number} aqi
 * @property {string} category band label, e.g. "Hazardous"
 * @property {string} color band colour
 * @property {number} level band level 0–5
 * @property {number} effectiveLevel level adjusted for this household
 * @property {string[]} sensitiveGroups
 * @property {number} personalRiskScore 0–100
 * @property {string} headline
 */

const PRIORITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

/** Rounds to one decimal place. */
const round1 = (n) => Math.round(n * 10) / 10;

/** Formats an ISO local time ("2026-11-23T14:00") as "14:00". */
const hhmm = (iso) => (iso ? iso.slice(11, 16) : null);

/** ['a'] -> 'a'; ['a','b'] -> 'a and b'; ['a','b','c'] -> 'a, b and c'. */
function joinWithAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Sorts recommendations high → low priority (stable for equal priorities).
 * @param {Recommendation[]} items
 * @returns {Recommendation[]}
 */
const byPriority = (items) => items.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

module.exports = { round1, hhmm, joinWithAnd, byPriority, PRIORITY_ORDER };
