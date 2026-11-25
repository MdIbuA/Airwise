/**
 * AQI panel: ring gauge, PM2.5 / risk meters and the cleanest-window day strip.
 * Band colour is always paired with a text label (never colour alone).
 */

import { SVG_NS, afterPaint, bandColor, byId, countUp, el, formatTime, hourOf, icon, setChildren } from './dom.js';

/** @typedef {import('./types.js').PlanResponse} PlanResponse */
/** @typedef {import('./types.js').Forecast} Forecast */

const AQI_SCALE_MAX = 500;
const WHO_PM25_24H = 15; // µg/m³
const PM25_METER_MAX = 250; // µg/m³ shown as a full bar

const GAUGE = Object.freeze({ size: 200, radius: 82, stroke: 16, sweep: 0.75, rotation: 135 });

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const DAY_TICKS = ['06:00', '10:00', '14:00', '18:00', '22:00'];

/**
 * One gauge ring (track or value arc).
 * @param {string} className
 * @param {number} arc visible arc length
 * @param {number} circumference
 * @returns {SVGCircleElement}
 */
function gaugeRing(className, arc, circumference) {
  const centre = String(GAUGE.size / 2);
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', centre);
  ring.setAttribute('cy', centre);
  ring.setAttribute('r', String(GAUGE.radius));
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke-width', String(GAUGE.stroke));
  ring.setAttribute('stroke-linecap', 'round');
  ring.setAttribute('stroke-dasharray', `${arc} ${circumference}`);
  ring.setAttribute('transform', `rotate(${GAUGE.rotation} ${centre} ${centre})`);
  ring.setAttribute('class', className);
  return ring;
}

/**
 * 270° ring gauge on a 0–500 AQI scale with a counting number in the centre.
 * @param {number} aqi
 * @param {number} level AQI band level, drives the colour
 * @returns {HTMLDivElement}
 */
function buildGauge(aqi, level) {
  const circumference = 2 * Math.PI * GAUGE.radius;
  const arc = circumference * GAUGE.sweep;
  const fraction = Math.min(1, Math.max(0, aqi / AQI_SCALE_MAX));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${GAUGE.size} ${GAUGE.size}`);
  svg.setAttribute('aria-hidden', 'true');
  const value = gaugeRing('gauge__value', arc, circumference);
  value.style.strokeDashoffset = String(arc);
  svg.append(gaugeRing('gauge__track', arc, circumference), value);
  afterPaint(() => {
    value.style.strokeDashoffset = String(arc * (1 - fraction));
  });

  const num = el('span', { className: 'gauge__num' }, '0');
  countUp(num, aqi);
  const wrap = el(
    'div',
    { className: 'gauge' },
    svg,
    el(
      'div',
      { className: 'gauge__center' },
      el('span', { className: 'gauge__label' }, 'US AQI'),
      num,
      el('span', { className: 'gauge__scale' }, `of ${AQI_SCALE_MAX}`),
    ),
  );
  wrap.style.setProperty('--band-color', bandColor(level));
  return wrap;
}

/**
 * Labelled horizontal meter, announced to screen readers as "label: value".
 * @param {string} label
 * @param {string} valueText
 * @param {number} percent fill 0–100
 * @param {string} [extraClass] modifier class for the fill
 * @returns {HTMLDivElement}
 */
function meter(label, valueText, percent, extraClass = '') {
  const fill = el('div', { className: `meter__fill ${extraClass}` });
  const pct = Math.max(2, Math.min(100, percent));
  // Keep gradient colours tied to the absolute 0–100 scale, not the fill width.
  if (extraClass) fill.style.backgroundSize = `${(100 / pct) * 100}% 100%`;
  afterPaint(() => {
    fill.style.width = `${pct}%`;
  });
  const bar = el('div', { className: 'meter__bar' }, fill);
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${label}: ${valueText}`);
  return el(
    'div',
    { className: 'meter' },
    el('div', { className: 'meter__head' }, el('span', {}, label), el('strong', {}, valueText)),
    bar,
  );
}

/**
 * Horizontal position (percent) of an hour on the 06:00–22:00 strip.
 * @param {number} hour
 * @returns {string}
 */
function stripPosition(hour) {
  const clamped = Math.min(DAY_END_HOUR, Math.max(DAY_START_HOUR, hour));
  return `${((clamped - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR)) * 100}%`;
}

/**
 * 06:00–22:00 strip highlighting the cleanest forecast window and the worst hour.
 * The visual is decorative; the caption carries the same information as text.
 * @param {Forecast|null} forecast
 * @returns {HTMLDivElement|null}
 */
function buildDayStrip(forecast) {
  const win = forecast?.cleanestWindow;
  if (!forecast || !win) return null;
  const windowEl = el('div', { className: 'daystrip__window' });
  windowEl.style.left = stripPosition(hourOf(win.start));
  windowEl.style.width = `calc(${stripPosition(hourOf(win.end) + 1)} - ${stripPosition(hourOf(win.start))})`;
  const bar = el('div', { className: 'daystrip__bar' }, windowEl);
  if (forecast.worstHour) {
    const worst = el('div', { className: 'daystrip__worst' });
    worst.style.left = stripPosition(hourOf(forecast.worstHour.time));
    bar.append(worst);
  }
  bar.setAttribute('aria-hidden', 'true');
  const ticks = el('div', { className: 'daystrip__ticks' }, ...DAY_TICKS.map((t) => el('span', {}, t)));
  ticks.setAttribute('aria-hidden', 'true');

  const worstText = forecast.worstHour
    ? ` · Worst hour: ${formatTime(forecast.worstHour.time)} (≈${forecast.worstHour.pm25} µg/m³)`
    : '';
  const caption = el(
    'p',
    { className: 'daystrip__caption' },
    el('strong', {}, `Cleanest window today: ${formatTime(win.start)}–${formatTime(win.end)}`),
    ` (≈${win.meanPm25} µg/m³)`,
    worstText,
  );
  return el('div', { className: 'daystrip' }, bar, ticks, caption);
}

/**
 * Renders the AQI panel for a plan.
 * @param {PlanResponse} data
 */
export function renderAqi(data) {
  const card = byId('aqi-card');
  const { air, risk } = data;
  card.style.setProperty('--band-color', bandColor(risk.level));
  const place = [air.location?.name, air.location?.region, air.location?.country].filter(Boolean).join(', ');

  const dot = el('span', { className: 'band-dot' });
  dot.setAttribute('aria-hidden', 'true');
  const bandPill = el('span', { className: 'band-pill' }, dot, risk.category);

  const meters = [];
  if (typeof air.pm25 === 'number' && Number.isFinite(air.pm25)) {
    const timesWho = (air.pm25 / WHO_PM25_24H).toFixed(1);
    meters.push(
      meter(
        `PM2.5 vs WHO 24-h guideline (${WHO_PM25_24H} µg/m³)`,
        `${Math.round(air.pm25)} µg/m³ · ${timesWho}×`,
        (air.pm25 / PM25_METER_MAX) * 100,
      ),
    );
  }
  meters.push(
    meter('Personal risk score', `${risk.personalRiskScore}/100`, risk.personalRiskScore, 'meter__fill--risk'),
  );

  setChildren(
    card,
    buildGauge(risk.aqi, risk.level),
    el(
      'div',
      {},
      el('p', { className: 'aqi-place' }, icon('pin'), place || 'Your location'),
      el('h3', { id: 'aqi-heading', className: 'visually-hidden' }, `Air quality: AQI ${risk.aqi}, ${risk.category}`),
      bandPill,
      el('p', { className: 'aqi-headline' }, risk.headline),
      el('div', { className: 'meters' }, ...meters),
      buildDayStrip(air.forecast),
      el('p', { className: 'source-note' }, `Source: ${air.source || 'Open-Meteo'}`),
    ),
  );
}
