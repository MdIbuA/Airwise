'use strict';

const F = require('../../data/factors');
const { round1 } = require('./shared');

/** @typedef {import('./shared').Recommendation} Recommendation */

const WEEKS_PER_YEAR = 52;
/** Alternatives that overlap a larger one (carpool vs. transit) and must not be double counted. */
const MUTUALLY_EXCLUSIVE_IDS = new Set(['carpool']);

/** Total commute distance per week (round trips on working days). */
function weeklyCommuteKm(profile) {
  return profile.commuteKm * F.TRIPS_PER_DAY * F.COMMUTE_DAYS_PER_WEEK;
}

/**
 * Aggregates potential weekly/annual CO₂ savings into a relatable figure.
 * @param {Recommendation[]} alternatives
 * @returns {{ co2KgPerWeek: number, co2KgPerYear: number, treeEquivalent: number }}
 */
function summariseImpact(alternatives) {
  const weekly = alternatives
    .filter((a) => !MUTUALLY_EXCLUSIVE_IDS.has(a.id) && Number.isFinite(a.impact.co2KgPerWeek))
    .reduce((sum, a) => sum + a.impact.co2KgPerWeek, 0);
  const yearly = Math.round(weekly * WEEKS_PER_YEAR);
  return {
    co2KgPerWeek: round1(weekly),
    co2KgPerYear: yearly,
    treeEquivalent: Math.round(yearly / F.TREE_CO2_KG_PER_YEAR),
  };
}

module.exports = { weeklyCommuteKm, summariseImpact };
