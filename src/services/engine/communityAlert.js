'use strict';

const { hhmm } = require('./shared');

/**
 * A short, plain-text message a family can forward to a building, school or
 * neighbourhood group, so one person's plan protects the wider community.
 * Deliberately contains no personal household details.
 *
 * @param {{ risk: import('./shared').Risk }} plan
 * @param {{ location?: { name?: string }, forecast?: any }} air
 * @param {string} city fallback place name
 * @returns {string}
 */
function buildCommunityAlert(plan, air, city) {
  const { risk } = plan;
  const window = air.forecast?.cleanestWindow;
  const worst = air.forecast?.worstHour;
  const lines = [`Air alert for ${air.location?.name || city}: AQI ${risk.aqi} (${risk.category}).`];
  if (window) {
    lines.push(
      `Cleanest time today: ${hhmm(window.start)}–${hhmm(window.end)} — best for airing homes and outdoor play.`,
    );
  }
  if (worst) lines.push(`Worst around ${hhmm(worst.time)} — keep windows shut.`);
  lines.push(advice(risk.level));
  lines.push('Please avoid burning leaves or waste, share rides, and check on elderly neighbours. 🌱');
  return lines.join('\n');
}

function advice(level) {
  if (level >= 3) return 'Kids, elders and anyone with asthma: stay indoors where possible; N95 masks outside.';
  if (level === 2) return 'Sensitive groups: limit outdoor exertion; N95 masks near traffic.';
  return 'Air is acceptable — a good day to ventilate.';
}

module.exports = { buildCommunityAlert };
