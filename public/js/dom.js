/**
 * Tiny DOM helpers. Everything renders through textContent / DOM APIs,
 * never innerHTML, so API or model output cannot inject markup.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** @typedef {Node|string|number|null|undefined|false} Child */

/**
 * Looks up a required element; fails loudly if the markup is missing it.
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} id
 * @returns {T}
 */
export function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return /** @type {T} */ (node);
}

/**
 * Small element factory: el('p', { className: 'x' }, 'text', child).
 * Falsy children are skipped; strings become text nodes (never parsed as HTML).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Partial<HTMLElementTagNameMap[K]>} [props]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Decorative icon from the inline SVG sprite (hidden from assistive tech).
 * @param {string} name sprite id without the "i-" prefix
 * @returns {SVGSVGElement}
 */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/**
 * Replaces an element's children. replaceChildren() would render null as the
 * text "null", so falsy entries are dropped first.
 * @param {Element} parent
 * @param {...(Node|null|undefined|false)} children
 */
export function setChildren(parent, ...children) {
  parent.replaceChildren(.../** @type {Node[]} */ (children.filter(Boolean)));
}

/**
 * "2026-11-23T14:00" → "14:00".
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export const formatTime = (iso) => (iso ? iso.slice(11, 16) : '');

/**
 * "2026-11-23T14:30" → 14.5 (hour of day as a decimal).
 * @param {string} iso
 * @returns {number}
 */
export const hourOf = (iso) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;

/**
 * CSS custom property holding the colour for an AQI band level (0–5).
 * @param {number} level
 * @returns {string}
 */
export const bandColor = (level) => `var(--band-${Math.max(0, Math.min(5, level))})`;

/**
 * Animates a number from 0 to `to` (instantly when reduced motion is on).
 * @param {HTMLElement} node
 * @param {number} to
 * @param {{ decimals?: number, duration?: number }} [options]
 */
export function countUp(node, to, { decimals = 0, duration = 1100 } = {}) {
  /** @param {number} v */
  const format = (v) =>
    v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion || !Number.isFinite(to)) {
    node.textContent = format(to);
    return;
  }
  const start = performance.now();
  /** @param {number} now */
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(to * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Runs `fn` after the next paint, so CSS transitions animate from the initial state.
 * @param {() => void} fn
 */
export const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
