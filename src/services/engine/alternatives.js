'use strict';

const F = require('../../data/factors');
const { round1, byPriority } = require('./shared');
const { weeklyCommuteKm } = require('./impact');

/** @typedef {import('./shared').Profile} Profile */
/** @typedef {import('./shared').Risk} Risk */
/** @typedef {import('./shared').Recommendation} Recommendation */

const CARPOOL_SHARE = 0.5; // two people share one car
const TWO_WHEELER_TRANSIT_SHARE = 0.6; // switch on 3 of 5 commute days

/** CO₂ and exhaust PM2.5 saved per week by moving `share` of the commute to `targetMode`. */
function commuteSavings(profile, targetMode, share = 1) {
  const km = weeklyCommuteKm(profile);
  const current = F.COMMUTE[profile.commuteMode];
  const target = F.COMMUTE[targetMode];
  return {
    co2: round1((current.co2Kg - target.co2Kg) * km * share),
    pm: round1((current.pm25G - target.pm25G) * km * share),
  };
}

/**
 * Car commuters: transit (largest lever) and carpooling (fallback).
 * @returns {Recommendation[]}
 */
function carAlternatives(profile) {
  const km = weeklyCommuteKm(profile);
  const current = F.COMMUTE[profile.commuteMode];
  const transit = commuteSavings(profile, 'public_transport');
  const carpoolCo2 = round1(current.co2Kg * km * CARPOOL_SHARE);
  return [
    {
      id: 'car-to-transit',
      title: 'Switch your car commute to metro/bus',
      detail: `Your ${km} km/week car commute is the single largest emission lever you control.`,
      priority: 'high',
      impact: {
        kind: 'emissions',
        co2KgPerWeek: transit.co2,
        pm25GramsPerWeek: transit.pm,
        explanation:
          `Saves about ${transit.co2} kg CO₂ and ${transit.pm} g of exhaust PM2.5 every week — ` +
          'and enclosed metro cars usually expose you to less PM2.5 than traffic.',
      },
    },
    {
      id: 'carpool',
      title: 'Carpool with one colleague or neighbour',
      detail: 'If transit is impractical, sharing the ride halves your per-person emissions.',
      priority: 'medium',
      impact: {
        kind: 'emissions',
        co2KgPerWeek: carpoolCo2,
        pm25GramsPerWeek: round1(current.pm25G * km * CARPOOL_SHARE),
        explanation: `Cuts about ${carpoolCo2} kg CO₂ per week from your share of the trip.`,
      },
    },
  ];
}

/**
 * Two-wheeler riders breathe exhaust directly: transit on bad days.
 * @returns {Recommendation}
 */
function twoWheelerAlternative(profile, risk) {
  const s = commuteSavings(profile, 'public_transport', TWO_WHEELER_TRANSIT_SHARE);
  return {
    id: 'bike-to-transit',
    title: 'Use metro/bus on high-smog days',
    detail: 'Riders breathe traffic exhaust directly; enclosed transit lowers both exposure and emissions.',
    priority: risk.level >= 3 ? 'high' : 'medium',
    impact: {
      kind: 'both',
      co2KgPerWeek: s.co2,
      pm25GramsPerWeek: s.pm,
      exposureReductionPct: [30, 50],
      explanation:
        `Switching on 3 of 5 days saves ~${s.co2} kg CO₂/week and roughly halves ` + `your in-transit PM2.5 dose.`,
    },
  };
}

/**
 * On unhealthy days, staying home removes both the trip and the exposure.
 * @returns {Recommendation}
 */
function workFromHomeAlternative(profile, risk) {
  const perDayCo2 = round1(F.COMMUTE[profile.commuteMode].co2Kg * profile.commuteKm * F.TRIPS_PER_DAY);
  return {
    id: 'wfh-peak-days',
    title: 'Work or study from home on "Very Unhealthy" days',
    detail: 'Ask your employer/school for a smog-day remote policy — many cities issue advisories for exactly this.',
    priority: risk.level >= 4 ? 'high' : 'medium',
    impact: {
      kind: 'both',
      co2KgPerWeek: perDayCo2,
      exposureReductionPct: [20, 40],
      explanation: `Each skipped trip day avoids ~${perDayCo2} kg CO₂ and your highest-exposure hours outdoors.`,
    },
  };
}

/**
 * All commute-related swaps for this profile and risk level.
 * @returns {Recommendation[]}
 */
function commuteAlternatives(profile, risk) {
  if (weeklyCommuteKm(profile) <= 0) return [];
  const out = [];
  if (profile.commuteMode.startsWith('car')) out.push(...carAlternatives(profile));
  if (profile.commuteMode === 'two_wheeler') out.push(twoWheelerAlternative(profile, risk));
  if (risk.level >= 3 && profile.commuteMode !== 'work_from_home') out.push(workFromHomeAlternative(profile, risk));
  return out;
}

/**
 * Combustion heaters → clean heat; resistive electric → heat pump.
 * @returns {Recommendation[]}
 */
function heatingAlternatives(profile) {
  const heating = F.HEATING[profile.heating];
  const co2 = round1(heating.co2KgPerWeek - F.HEATING.heat_pump.co2KgPerWeek);
  if (profile.heating === 'wood_coal' || profile.heating === 'kerosene') {
    return [
      {
        id: 'clean-heating',
        title: 'Replace combustion heating with an inverter AC/heat pump or electric heater',
        detail:
          `${heating.label}s are among the largest household PM2.5 sources and add to neighbourhood smog. ` +
          'Insulate first (door snakes, curtains, rugs) to need less heat.',
        priority: 'high',
        impact: {
          kind: 'both',
          co2KgPerWeek: co2,
          exposureReductionPct: [60, 90],
          explanation:
            `Removes an in-home combustion source (indoor PM2.5 down by up to ` +
            `~60–90%) and saves around ${co2} kg CO₂ per week.`,
        },
      },
    ];
  }
  if (profile.heating === 'electric') {
    return [
      {
        id: 'heat-pump',
        title: 'Use an inverter AC in heat mode instead of a resistive heater',
        detail: 'Heat pumps deliver 3–4 units of heat per unit of electricity.',
        priority: 'low',
        impact: {
          kind: 'emissions',
          co2KgPerWeek: co2,
          explanation:
            `Roughly a third of the electricity, saving ~${co2} kg CO₂ per week ` + 'from power-plant emissions.',
        },
      },
    ];
  }
  return [];
}

/**
 * Solid-fuel / kerosene cooking → LPG, PNG or induction.
 * @returns {Recommendation[]}
 */
function cookingAlternatives(profile) {
  if (profile.cooking !== 'biomass' && profile.cooking !== 'kerosene') return [];
  return [
    {
      id: 'clean-cooking',
      title: 'Move to LPG/PNG or induction cooking',
      detail:
        'Check eligibility for subsidised LPG connections (e.g. PMUY in India) or use an ' +
        'induction plate for everyday cooking.',
      priority: 'high',
      impact: {
        kind: 'exposure',
        exposureReductionPct: [50, 80],
        explanation:
          'Solid-fuel and kerosene cooking is the leading cause of household air pollution deaths worldwide (WHO); ' +
          'clean fuels cut kitchen PM2.5 by more than half.',
      },
    },
  ];
}

/**
 * Actions that protect the neighbourhood, offered to every household.
 * @returns {Recommendation[]}
 */
function communityAlternatives() {
  return [
    {
      id: 'no-burning',
      title: 'Never burn leaves, waste or crop residue — compost it',
      detail:
        'Join or start a resident-welfare composting drive and report open burning to the ' +
        'local pollution-control helpline.',
      priority: 'medium',
      impact: {
        kind: 'community',
        explanation:
          'Open burning is a major local winter PM2.5 source; one stopped bonfire protects the ' +
          'whole street, not just your home.',
      },
    },
    {
      id: 'community-alerts',
      title: 'Share a neighbourhood smog alert group',
      detail:
        'A building or school WhatsApp/Signal group that shares daily AQI and the cleanest ' +
        'window helps elderly neighbours and parents plan.',
      priority: 'low',
      impact: {
        kind: 'community',
        explanation: 'Collective timing of school runs and outdoor play lowers exposure for the most vulnerable.',
      },
    },
  ];
}

/**
 * Sustainable swaps with quantified emissions and exposure impact, by priority.
 * @param {Profile} profile
 * @param {Risk} risk
 * @returns {Recommendation[]}
 */
function buildAlternatives(profile, risk) {
  return byPriority([
    ...commuteAlternatives(profile, risk),
    ...heatingAlternatives(profile),
    ...cookingAlternatives(profile),
    ...communityAlternatives(),
  ]);
}

module.exports = { buildAlternatives };
