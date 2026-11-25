/**
 * Coach card: rule-based briefing first, upgraded in place when the AI
 * briefing arrives (progressive loading). Stale AI responses are ignored.
 */

import { el, icon, setChildren } from './dom.js';
import { postJson } from './api.js';

/**
 * Coach card. States:
 *  - pending: rule-based briefing shown, AI still writing (status line + shimmer)
 *  - ai:      AI briefing
 *  - rules:   final rule-based briefing (AI off, failed or slow)
 */
export function renderNarrative(narrative, { pending = false, hasQuestion = false } = {}) {
  const card = document.getElementById('narrative-card');
  const isAi = narrative.source === 'ai';
  card.classList.toggle('is-pending', pending);
  card.setAttribute('aria-busy', String(pending));

  let answer = null;
  if (pending && hasQuestion) {
    answer = el(
      'div',
      { className: 'answer answer--pending' },
      icon('chat'),
      el('div', {}, el('strong', {}, 'Your question'), el('p', {}, 'The AI coach is answering…')),
    );
  } else if (narrative.answer) {
    const text =
      narrative.reason === 'timeout' && hasQuestion
        ? 'The AI coach is busy right now, so this answer is not ready yet. Submit again in a ' +
          'minute — it will be ready instantly.'
        : narrative.answer;
    answer = el(
      'div',
      { className: 'answer' },
      icon('chat'),
      el('div', {}, el('strong', {}, 'Your question'), el('p', {}, text)),
    );
  }

  const badge = isAi ? 'AI coach' : pending ? 'AI coach · writing' : 'Coach · rule-based';
  const title = isAi ? 'AI coach briefing' : 'Coach briefing (rule-based)';
  setChildren(
    card,
    el('span', { className: 'ai-badge' }, icon('spark'), badge),
    el('h3', {}, title),
    pending
      ? el(
          'div',
          { className: 'ai-progress' },
          el('span', { className: 'ai-progress__bar' }),
          el('span', {}, 'Personalising with AI — your plan below is ready to use now.'),
        )
      : null,
    el('p', { className: 'ai-summary' }, narrative.summary),
    el('h4', { className: 'visually-hidden' }, 'Top 3 actions today'),
    el(
      'ol',
      { className: 'top-actions' },
      ...narrative.priorities.map((p) => el('li', {}, el('strong', {}, p.action), el('p', {}, p.impact))),
    ),
    answer,
  );
}

/** Upgrades the coach card with the AI briefing, ignoring stale responses. */
let narrativeRequestId = 0;

/** Marks any in-flight AI request as stale (called on every new submission). */
export function invalidateNarrative() {
  narrativeRequestId += 1;
}

export async function loadAiNarrative(payload, hasQuestion) {
  const requestId = ++narrativeRequestId;
  const status = document.getElementById('ai-status');
  let narrative = null;
  try {
    const { ok, data } = await postJson('/api/narrative', payload);
    if (ok) narrative = data.narrative;
  } catch {
    /* network error: keep the rule-based briefing */
  }
  if (requestId !== narrativeRequestId) return; // a newer submission superseded this one
  const card = document.getElementById('narrative-card');
  if (narrative) {
    renderNarrative(narrative, { hasQuestion });
  } else {
    card.classList.remove('is-pending');
    card.setAttribute('aria-busy', 'false');
    card.querySelector('.ai-progress')?.remove();
    card.querySelector('.answer--pending')?.remove();
  }
  card.classList.remove('reveal');
  void card.offsetWidth;
  card.style.animationDelay = '0ms';
  card.classList.add('reveal');
  status.textContent = narrative?.source === 'ai' ? 'AI coach briefing is ready.' : '';
}
