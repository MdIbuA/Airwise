'use strict';

const F = require('../../data/factors');
const { hhmm } = require('./shared');

/** @typedef {import('./shared').Profile} Profile */
/** @typedef {import('./shared').Risk} Risk */
/** @typedef {{ slot: string, actions: string[] }} RoutineSlot */

const DEFAULT_WINDOW = 'early afternoon (usually 13:00–16:00 in winter)';

/**
 * @param {Risk} risk
 * @param {boolean} needsMask
 * @returns {string[]}
 */
function morning(risk, needsMask) {
  return [
    risk.effectiveLevel >= 2
      ? 'Skip dawn walks: winter temperature inversions trap smog close to the ground until mid-morning.'
      : 'Morning air is acceptable — a brisk walk is fine, ideally away from main roads.',
    needsMask
      ? 'Anyone stepping out (school run, commute) wears a well-fitted N95/FFP2 mask; ' +
        'cloth and surgical masks block little PM2.5.'
      : 'Masks are optional today; keep N95s handy for traffic-heavy stretches.',
    'Keep windows shut until the cleanest window of the day.',
  ];
}

/**
 * @param {Profile} profile
 * @param {Risk} risk
 * @param {string} windowText when to ventilate / exercise, e.g. "14:00–15:00"
 * @returns {string[]}
 */
function daytime(profile, risk, windowText) {
  const actions = [
    `Open windows for 10–15 minutes around ${windowText}, when PM2.5 is forecast to be lowest, then close them.`,
  ];
  if (profile.commuteMode !== 'work_from_home') {
    const commute = F.COMMUTE[profile.commuteMode];
    actions.push(
      profile.commuteMode.startsWith('car')
        ? 'In the car, set ventilation to recirculate and keep windows up in traffic.'
        : `On your ${commute.label.toLowerCase()} commute, prefer side streets/park routes — ` +
            'PM2.5 drops sharply even 50–100 m from busy roads.',
    );
  }
  if (profile.outdoorActivity !== 'low') {
    actions.push(
      risk.effectiveLevel >= 3
        ? 'Move exercise indoors today (yoga, stair climbing, home workouts).'
        : `If exercising outdoors, do it during ${windowText} at moderate intensity.`,
    );
  }
  return actions;
}

/**
 * @param {Profile} profile
 * @returns {string[]}
 */
function evening(profile) {
  const dirtyCooking = profile.cooking === 'biomass' || profile.cooking === 'kerosene';
  return [
    'Pollution rises again after sunset as the air cools and traffic peaks — keep windows closed.',
    dirtyCooking
      ? 'Cook with doors to living rooms shut and the kitchen window open or exhaust running; ' +
        'keep children out of the kitchen.'
      : 'Run the kitchen exhaust/chimney while cooking and 10 minutes after — ' +
        'frying and gas burners spike indoor PM2.5.',
    'Avoid incense, mosquito coils and candles — each is a strong indoor PM2.5 source.',
  ];
}

/**
 * @param {Profile} profile
 * @returns {string[]}
 */
function night(profile) {
  const combustionHeater = profile.heating === 'wood_coal' || profile.heating === 'kerosene';
  return [
    profile.hasAirPurifier
      ? 'Run the purifier on high in the bedroom with the door closed for 30 minutes before sleep, then on auto/low.'
      : 'Make the bedroom the "clean room": seal gaps around the door/window and run a DIY filter fan ' +
        '(see indoor hacks).',
    combustionHeater
      ? 'Never sleep with a coal/wood/kerosene heater burning in a closed room — ' +
        'besides PM2.5 it can cause fatal carbon-monoxide build-up.'
      : 'Keep heating electric where possible; layer bedding instead of raising heater use.',
  ];
}

/**
 * Daily routine split by time of day, adapted to severity and the forecast.
 * @param {Profile} profile
 * @param {Risk} risk
 * @param {{ cleanestWindow?: { start: string, end: string } }|null} [forecast]
 * @returns {RoutineSlot[]}
 */
function buildRoutine(profile, risk, forecast) {
  const window = forecast?.cleanestWindow;
  const windowText = window ? `${hhmm(window.start)}–${hhmm(window.end)}` : DEFAULT_WINDOW;
  const needsMask = risk.level >= 3 || (risk.level >= 2 && risk.sensitiveGroups.length > 0);
  return [
    { slot: 'Morning (6–10)', actions: morning(risk, needsMask) },
    { slot: 'Daytime (10–17)', actions: daytime(profile, risk, windowText) },
    { slot: 'Evening (17–21)', actions: evening(profile) },
    { slot: 'Night (21–6)', actions: night(profile) },
  ];
}

module.exports = { buildRoutine };
