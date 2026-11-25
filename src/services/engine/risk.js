'use strict';

const F = require('../../data/factors');
const { joinWithAnd } = require('./shared');

/** @typedef {import('./shared').Profile} Profile */
/** @typedef {import('./shared').Risk} Risk */

const MAX_LEVEL = 5;
// Personal risk score weights (sum to 100 at the top of every scale).
const SCORE_FROM_LEVEL = 85;
const SCORE_HIGH_ACTIVITY = 10;
const SCORE_SENSITIVE = 5;

/** Maps an AQI value to its US EPA band. */
function classifyAqi(aqi) {
  const value = Math.max(0, Number(aqi) || 0);
  return F.AQI_BANDS.find((band) => value <= band.max);
}

/** Lists the sensitive groups present in the household. */
function sensitiveGroups(profile) {
  const groups = [];
  if (profile.hasChildren) groups.push('children');
  if (profile.hasElderly) groups.push('older adults');
  if (profile.hasRespiratoryCondition) groups.push('people with asthma/heart or lung conditions');
  if (profile.isPregnant) groups.push('pregnancy');
  return groups;
}

/** One-line, household-aware summary of what today's air means. */
function buildHeadline(band, effectiveLevel, groups) {
  const air = `Air is ${band.label.toLowerCase()}`;
  const who = groups.length ? ` for a household with ${joinWithAnd(groups)}` : '';
  if (effectiveLevel >= 4) return `${air} — treat today as a stay-indoors, clean-room day${who}.`;
  if (effectiveLevel === 3) return `${air} — limit time outside and protect indoor air${who}.`;
  if (effectiveLevel === 2) return `${air} — sensitive members should cut outdoor exertion${who}.`;
  return `${air} — a good day to ventilate and move actively${who}.`;
}

/**
 * Personal risk: sensitive households are treated one AQI band higher, and
 * severe indoor combustion adds a level independent of outdoor air.
 * @param {Profile} profile
 * @param {number} aqi
 * @returns {Risk}
 */
function assessRisk(profile, aqi) {
  const band = classifyAqi(aqi);
  const groups = sensitiveGroups(profile);
  const isSensitive = groups.length > 0;
  const indoorSources = [F.HEATING[profile.heating].indoorRisk, F.COOKING[profile.cooking].indoorRisk];
  const indoorPenalty = indoorSources.includes('severe') ? 1 : 0;
  const effectiveLevel = Math.min(MAX_LEVEL, band.level + (isSensitive ? 1 : 0) + indoorPenalty);
  const rawScore =
    (effectiveLevel / MAX_LEVEL) * SCORE_FROM_LEVEL +
    (profile.outdoorActivity === 'high' ? SCORE_HIGH_ACTIVITY : 0) +
    (isSensitive ? SCORE_SENSITIVE : 0);
  return {
    aqi: Math.round(aqi),
    category: band.label,
    color: band.color,
    level: band.level,
    effectiveLevel,
    sensitiveGroups: groups,
    personalRiskScore: Math.min(100, Math.round(rawScore)),
    headline: buildHeadline(band, effectiveLevel, groups),
  };
}

module.exports = { classifyAqi, sensitiveGroups, assessRisk };
