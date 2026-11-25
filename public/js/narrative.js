/**
 * Coach card: the rule-based briefing appears instantly, then is upgraded in
 * place when the AI briefing arrives (progressive loading). Responses from an
 * older submission are ignored.
 */

import { postJson } from './api.js';
import { byId, el, icon, setChildren } from './dom.js';

/** @typedef {import('./types.js').Narrative} Narrative */

const TEXT = Object.freeze({
  answering: 'The AI coach is answering…',
  busy:
    'The AI coach is busy right now, so this answer is not ready yet. Submit again in a ' +
    'minute — it will be ready instantly.',
  progress: 'Personalising with AI — your plan below is ready to use now.',
  ready: 'AI coach briefing is ready.',
});

/** Bumped on every submission so late AI responses for older plans are dropped. */
let latestRequestId = 0;

/**
 * "Your question" box.
 * @param {string} text
 * @param {boolean} [pending] italic placeholder style while the AI writes
 * @returns {HTMLDivElement}
 */
function answerBox(text, pending = false) {
  return el(
    'div',
    { className: pending ? 'answer answer--pending' : 'answer' },
    icon('chat'),
    el('div', {}, el('strong', {}, 'Your question'), el('p', {}, text)),
  );
}

/**
 * @param {Narrative} narrative
 * @param {boolean} pending
 * @param {boolean} hasQuestion
 * @returns {HTMLDivElement|null}
 */
function answerFor(narrative, pending, hasQuestion) {
  if (pending && hasQuestion) return answerBox(TEXT.answering, true);
  if (!narrative.answer) return null;
  return answerBox(narrative.reason === 'timeout' && hasQuestion ? TEXT.busy : narrative.answer);
}

/**
 * @param {boolean} isAi
 * @param {boolean} pending
 * @returns {string}
 */
function badgeLabel(isAi, pending) {
  if (isAi) return 'AI coach';
  return pending ? 'AI coach · writing' : 'Coach · rule-based';
}

/**
 * Renders the coach card. States:
 *  - pending: rule-based briefing shown while the AI writes (progress line)
 *  - ai:      the AI briefing
 *  - rules:   final rule-based briefing (AI off, failed or slow)
 * @param {Narrative} narrative
 * @param {{ pending?: boolean, hasQuestion?: boolean }} [state]
 */
export function renderNarrative(narrative, { pending = false, hasQuestion = false } = {}) {
  const card = byId('narrative-card');
  const isAi = narrative.source === 'ai';
  card.classList.toggle('is-pending', pending);
  card.setAttribute('aria-busy', String(pending));

  const progress = pending
    ? el(
        'div',
        { className: 'ai-progress' },
        el('span', { className: 'ai-progress__bar' }),
        el('span', {}, TEXT.progress),
      )
    : null;
  setChildren(
    card,
    el('span', { className: 'ai-badge' }, icon('spark'), badgeLabel(isAi, pending)),
    el('h3', {}, isAi ? 'AI coach briefing' : 'Coach briefing (rule-based)'),
    progress,
    el('p', { className: 'ai-summary' }, narrative.summary),
    el('h4', { className: 'visually-hidden' }, 'Top 3 actions today'),
    el(
      'ol',
      { className: 'top-actions' },
      ...narrative.priorities.map((p) => el('li', {}, el('strong', {}, p.action), el('p', {}, p.impact))),
    ),
    answerFor(narrative, pending, hasQuestion),
  );
}

/** Marks any in-flight AI request as stale (call on every new submission). */
export function invalidateNarrative() {
  latestRequestId += 1;
}

/**
 * Leaves the rule-based briefing in place but clears the "writing" state.
 * @param {HTMLElement} card
 */
function settleWithoutAi(card) {
  card.classList.remove('is-pending');
  card.setAttribute('aria-busy', 'false');
  card.querySelector('.ai-progress')?.remove();
  card.querySelector('.answer--pending')?.remove();
}

/**
 * Restarts the card's reveal animation.
 * @param {HTMLElement} card
 */
function replayReveal(card) {
  card.classList.remove('reveal');
  void card.offsetWidth; // force reflow so the animation restarts
  card.style.animationDelay = '0ms';
  card.classList.add('reveal');
}

/**
 * Fetches the AI briefing and upgrades the coach card, unless a newer
 * submission has happened in the meantime. Screen readers are told when it is ready.
 * @param {object} payload the same profile sent to /api/plan
 * @param {boolean} hasQuestion
 */
export async function loadAiNarrative(payload, hasQuestion) {
  const requestId = ++latestRequestId;
  /** @type {Narrative|null} */
  let narrative = null;
  try {
    const { ok, data } = await postJson('/api/narrative', payload);
    if (ok) narrative = data.narrative;
  } catch {
    /* network error: keep the rule-based briefing */
  }
  if (requestId !== latestRequestId) return;

  const card = byId('narrative-card');
  if (narrative) renderNarrative(narrative, { hasQuestion });
  else settleWithoutAi(card);
  replayReveal(card);
  byId('ai-status').textContent = narrative?.source === 'ai' ? TEXT.ready : '';
}
