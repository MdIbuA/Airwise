/**
 * Result sections: impact stat tiles, routine timeline and recommendation cards.
 */

import { el, icon, setChildren, countUp } from './dom.js';

function statTile(value, unit, label, decimals = 0) {
  const num = el('span', {}, '0');
  countUp(num, value, { decimals });
  return el(
    'div',
    { className: 'stat' },
    el('span', { className: 'stat__value' }, num, el('span', { className: 'stat__unit' }, unit)),
    el('span', { className: 'stat__label' }, label),
  );
}

export function renderImpact(summary) {
  const text = document.getElementById('impact-summary');
  const tiles = document.getElementById('stat-tiles');
  if (summary.co2KgPerYear > 0) {
    const trees = summary.treeEquivalent === 1 ? 'tree absorbs' : 'trees absorb';
    text.textContent =
      `Adopting these swaps could avoid ≈${summary.co2KgPerYear} kg CO₂ per year ` +
      `(${summary.co2KgPerWeek} kg/week) — about what ${summary.treeEquivalent} mature ${trees}.`;
    setChildren(
      tiles,
      statTile(summary.co2KgPerYear, 'kg', 'CO₂ avoidable per year'),
      statTile(summary.co2KgPerWeek, 'kg', 'CO₂ avoidable per week', 1),
      statTile(summary.treeEquivalent, summary.treeEquivalent === 1 ? 'tree' : 'trees', 'Equivalent yearly absorption'),
    );
  } else {
    text.textContent =
      'Your current choices are already low-emission — focus on reducing exposure and helping your community.';
    tiles.replaceChildren();
  }
}

/* ---------------- Routine & cards ---------------- */

const SLOT_ICONS = ['sunrise', 'sun', 'sunset', 'moon'];

export function renderRoutine(routine) {
  document.getElementById('routine').replaceChildren(
    ...routine.map((slot, i) => {
      const iconBox = el('span', { className: 'slot__icon' }, icon(SLOT_ICONS[i % 4]));
      return el(
        'li',
        { className: `slot slot--${i % 4}` },
        el('div', { className: 'slot__head' }, iconBox, el('h4', {}, slot.slot)),
        el('ul', {}, ...slot.actions.map((a) => el('li', {}, a))),
      );
    }),
  );
}

function metricChips(impact) {
  const chips = [];
  if (Array.isArray(impact.exposureReductionPct)) {
    chips.push(
      el(
        'span',
        { className: 'metric metric--exposure' },
        `Exposure ↓ ${impact.exposureReductionPct[0]}–${impact.exposureReductionPct[1]}%`,
      ),
    );
  }
  if (Number.isFinite(impact.co2KgPerWeek) && impact.co2KgPerWeek > 0) {
    chips.push(el('span', { className: 'metric' }, `CO₂ ↓ ${impact.co2KgPerWeek} kg/week`));
  }
  if (Number.isFinite(impact.pm25GramsPerWeek) && impact.pm25GramsPerWeek > 0) {
    chips.push(el('span', { className: 'metric' }, `PM2.5 ↓ ${impact.pm25GramsPerWeek} g/week`));
  }
  return chips.length ? el('div', { className: 'metrics' }, ...chips) : null;
}

export function renderItems(listId, items) {
  document
    .getElementById(listId)
    .replaceChildren(
      ...items.map((item) =>
        el(
          'li',
          { className: 'card' },
          el('span', { className: `badge ${item.priority}` }, `${item.priority} priority`),
          el('h4', {}, item.title),
          el('p', {}, item.detail),
          el(
            'div',
            { className: 'card__foot' },
            metricChips(item.impact),
            el('p', { className: 'impact-text' }, el('strong', {}, 'Impact: '), item.impact.explanation),
          ),
        ),
      ),
    );
}
