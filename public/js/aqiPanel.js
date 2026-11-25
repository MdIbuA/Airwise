/**
 * AQI panel: ring gauge, PM2.5 / risk meters and the cleanest-window day strip.
 * Band colour is always paired with a text label (never colour alone).
 */

import { SVG_NS, el, icon, setChildren, countUp, formatTime, hourOf, bandColor } from './dom.js';

/** 270° ring gauge on a 0–500 AQI scale. Colour always paired with a text label. */
function buildGauge(aqi, level) {
  const size = 200;
  const r = 82;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.75;
  const fraction = Math.min(1, Math.max(0, aqi / 500));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  const ring = (cls) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', size / 2);
    c.setAttribute('cy', size / 2);
    c.setAttribute('r', r);
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', '16');
    c.setAttribute('stroke-linecap', 'round');
    c.setAttribute('stroke-dasharray', `${arc} ${circumference}`);
    c.setAttribute('transform', `rotate(135 ${size / 2} ${size / 2})`);
    c.setAttribute('class', cls);
    return c;
  };
  const track = ring('gauge__track');
  const value = ring('gauge__value');
  value.style.strokeDashoffset = String(arc);
  svg.append(track, value);
  // Animate after insertion.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      value.style.strokeDashoffset = String(arc * (1 - fraction));
    }),
  );

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
      el('span', { className: 'gauge__scale' }, 'of 500'),
    ),
  );
  wrap.style.setProperty('--band-color', bandColor(level));
  return wrap;
}

function meter(label, valueText, percent, extraClass = '') {
  const fill = el('div', { className: `meter__fill ${extraClass}` });
  const pct = Math.max(2, Math.min(100, percent));
  // Keep gradient colours tied to the absolute 0–100 scale, not the fill width.
  if (extraClass) fill.style.backgroundSize = `${(100 / pct) * 100}% 100%`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      fill.style.width = `${pct}%`;
    }),
  );
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

/** 06:00–22:00 strip with the cleanest forecast window and worst hour. */
function buildDayStrip(forecast) {
  if (!forecast?.cleanestWindow) return null;
  const START = 6;
  const SPAN = 16;
  const pos = (h) => `${((Math.min(22, Math.max(START, h)) - START) / SPAN) * 100}%`;
  const win = forecast.cleanestWindow;
  const windowEl = el('div', { className: 'daystrip__window' });
  windowEl.style.left = pos(hourOf(win.start));
  windowEl.style.width = `calc(${pos(hourOf(win.end) + 1)} - ${pos(hourOf(win.start))})`;
  const bar = el('div', { className: 'daystrip__bar' }, windowEl);
  if (forecast.worstHour) {
    const worst = el('div', { className: 'daystrip__worst' });
    worst.style.left = pos(hourOf(forecast.worstHour.time));
    bar.append(worst);
  }
  bar.setAttribute('aria-hidden', 'true');
  const ticks = el(
    'div',
    { className: 'daystrip__ticks' },
    ...['06:00', '10:00', '14:00', '18:00', '22:00'].map((t) => el('span', {}, t)),
  );
  ticks.setAttribute('aria-hidden', 'true');

  const caption = el(
    'p',
    { className: 'daystrip__caption' },
    el('strong', {}, `Cleanest window today: ${formatTime(win.start)}–${formatTime(win.end)}`),
    ` (≈${win.meanPm25} µg/m³)`,
    forecast.worstHour
      ? ` · Worst hour: ${formatTime(forecast.worstHour.time)} (≈${forecast.worstHour.pm25} µg/m³)`
      : '',
  );
  return el('div', { className: 'daystrip' }, bar, ticks, caption);
}

export function renderAqi(data) {
  const card = document.getElementById('aqi-card');
  const { air, risk } = data;
  card.style.setProperty('--band-color', bandColor(risk.level));
  const place = [air.location?.name, air.location?.region, air.location?.country].filter(Boolean).join(', ');

  const bandPill = el('span', { className: 'band-pill' }, el('span', { className: 'band-dot' }), risk.category);
  bandPill.querySelector('.band-dot').setAttribute('aria-hidden', 'true');

  const meters = [];
  if (Number.isFinite(air.pm25)) {
    const times = air.pm25 / 15;
    meters.push(
      meter(
        'PM2.5 vs WHO 24-h guideline (15 µg/m³)',
        `${Math.round(air.pm25)} µg/m³ · ${times.toFixed(1)}×`,
        (air.pm25 / 250) * 100,
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
