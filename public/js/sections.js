/**
 * Result sections: impact stat tiles, the routine timeline and recommendation cards.
 */

import { byId, countUp, el, icon, setChildren } from './dom.js';

/** @typedef {import('./types.js').ImpactSummary} ImpactSummary */
/** @typedef {import('./types.js').RoutineSlot} RoutineSlot */
/** @typedef {import('./types.js').Recommendation} Recommendation */
/** @typedef {import('./types.js').Impact} Impact */

const SLOT_ICONS = ['sunrise', 'sun', 'sunset', 'moon'];
const LOW_EMISSION_MESSAGE =
  'Your current choices are already low-emission — focus on reducing exposure and helping your community.';

/**
 * Big counting number with a unit and a caption.
 * @param {number} value
 * @param {string} unit
 * @param {string} label
 * @param {number} [decimals]
 * @returns {HTMLDivElement}
 */
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

/**
 * Renders the CO₂ impact sentence and stat tiles.
 * @param {ImpactSummary} summary
 */
export function renderImpact(summary) {
  const text = byId('impact-summary');
  const tiles = byId('stat-tiles');
  if (summary.co2KgPerYear <= 0) {
    text.textContent = LOW_EMISSION_MESSAGE;
    tiles.replaceChildren();
    return;
  }
  const oneTree = summary.treeEquivalent === 1;
  text.textContent =
    `Adopting these swaps could avoid ≈${summary.co2KgPerYear} kg CO₂ per year ` +
    `(${summary.co2KgPerWeek} kg/week) — about what ${summary.treeEquivalent} mature ` +
    `${oneTree ? 'tree absorbs' : 'trees absorb'}.`;
  setChildren(
    tiles,
    statTile(summary.co2KgPerYear, 'kg', 'CO₂ avoidable per year'),
    statTile(summary.co2KgPerWeek, 'kg', 'CO₂ avoidable per week', 1),
    statTile(summary.treeEquivalent, oneTree ? 'tree' : 'trees', 'Equivalent yearly absorption'),
  );
}

/**
 * Renders the morning-to-night routine timeline.
 * @param {RoutineSlot[]} routine
 */
export function renderRoutine(routine) {
  byId('routine').replaceChildren(
    ...routine.map((slot, i) => {
      const variant = i % SLOT_ICONS.length;
      const iconBox = el('span', { className: 'slot__icon' }, icon(SLOT_ICONS[variant]));
      return el(
        'li',
        { className: `slot slot--${variant}` },
        el('div', { className: 'slot__head' }, iconBox, el('h4', {}, slot.slot)),
        el('ul', {}, ...slot.actions.map((action) => el('li', {}, action))),
      );
    }),
  );
}

/**
 * @param {number|undefined} value
 * @returns {value is number} true for a finite, positive number
 */
const isPositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Small chips quantifying an impact (exposure %, CO₂, PM2.5).
 * @param {Impact} impact
 * @returns {HTMLDivElement|null} null when there is nothing to quantify
 */
function metricChips(impact) {
  const chips = [];
  const range = impact.exposureReductionPct;
  if (range) {
    chips.push(el('span', { className: 'metric metric--exposure' }, `Exposure ↓ ${range[0]}–${range[1]}%`));
  }
  if (isPositive(impact.co2KgPerWeek)) {
    chips.push(el('span', { className: 'metric' }, `CO₂ ↓ ${impact.co2KgPerWeek} kg/week`));
  }
  if (isPositive(impact.pm25GramsPerWeek)) {
    chips.push(el('span', { className: 'metric' }, `PM2.5 ↓ ${impact.pm25GramsPerWeek} g/week`));
  }
  return chips.length ? el('div', { className: 'metrics' }, ...chips) : null;
}

/**
 * One recommendation card: priority badge, title, detail and quantified impact.
 * @param {Recommendation} item
 * @returns {HTMLLIElement}
 */
function recommendationCard(item) {
  return el(
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
  );
}

/**
 * Renders a list of recommendation cards.
 * @param {string} listId id of the target <ul>
 * @param {Recommendation[]} items
 */
export function renderItems(listId, items) {
  byId(listId).replaceChildren(...items.map(recommendationCard));
}
