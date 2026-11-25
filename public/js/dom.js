/**
 * Tiny DOM helpers. Everything renders through textContent / DOM APIs,
 * never innerHTML, so API or model output cannot inject markup.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Small element factory: el('p', { className: 'x' }, 'text', child). */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Decorative icon from the inline sprite. */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** replaceChildren() would render null as the text "null", so drop falsy nodes. */
export function setChildren(parent, ...children) {
  parent.replaceChildren(...children.filter((child) => child !== null && child !== undefined && child !== false));
}

export const formatTime = (iso) => (iso ? iso.slice(11, 16) : '');
export const hourOf = (iso) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
export const bandColor = (level) => `var(--band-${Math.max(0, Math.min(5, level))})`;

/** Animates a number from 0 to `to` (instantly when reduced motion is on). */
export function countUp(node, to, { decimals = 0, duration = 1100 } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const format = (v) =>
    v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  if (reduce || !Number.isFinite(to)) {
    node.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(to * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
