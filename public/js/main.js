/**
 * AirWise front end entry point: form handling and orchestration of the result
 * sections. Loaded as an ES module (allowed by the strict CSP: 'self').
 */

import { postJson } from './api.js';
import { renderAqi } from './aqiPanel.js';
import { initCommunityAlert, renderCommunityAlert } from './community.js';
import { byId } from './dom.js';
import { invalidateNarrative, loadAiNarrative, renderNarrative } from './narrative.js';
import { renderImpact, renderItems, renderRoutine } from './sections.js';

/** @typedef {import('./types.js').PlanResponse} PlanResponse */
/** @typedef {Record<string, string|boolean>} Payload */

const CHECKBOX_FIELDS = ['hasChildren', 'hasElderly', 'hasRespiratoryCondition', 'isPregnant', 'hasAirPurifier'];
const REVEAL_STAGGER_MS = 70;
const MAX_STAGGERED_SECTIONS = 8;
const TEXT = Object.freeze({
  submit: 'Get my clean-air plan',
  busy: 'Building your plan…',
  cityMissing: 'Please enter your city or town.',
  offline: 'Could not reach AirWise. Check your connection and try again.',
  manualHint: ' You can enter the AQI manually in step 4.',
});

/** @type {HTMLFormElement} */
const form = byId('profile-form');
/** @type {HTMLButtonElement} */
const submitBtn = byId('submit-btn');
const formError = byId('form-error');
const results = byId('results');
const loading = byId('loading');

/**
 * @param {string} name
 * @returns {HTMLInputElement}
 */
const field = (name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));

/**
 * Reads the form into the JSON body expected by the API (checkboxes as booleans).
 * @returns {Payload}
 */
function collectPayload() {
  /** @type {Payload} */
  const payload = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === 'string') payload[key] = value.trim();
  }
  for (const name of CHECKBOX_FIELDS) payload[name] = field(name).checked;
  if (!payload.manualAqi) delete payload.manualAqi;
  return payload;
}

/** @param {string} message */
function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

/**
 * Toggles the loading state (button label, skeleton, aria-busy).
 * @param {boolean} busy
 */
function setBusy(busy) {
  submitBtn.disabled = busy;
  const label = submitBtn.querySelector('.btn__label');
  if (label) label.textContent = busy ? TEXT.busy : TEXT.submit;
  results.setAttribute('aria-busy', String(busy));
  loading.hidden = !busy;
  if (busy) results.hidden = true;
}

/** Restarts the staggered fade-in of the result sections. */
function revealSections() {
  results.querySelectorAll(':scope > *').forEach((node, i) => {
    const section = /** @type {HTMLElement} */ (node);
    section.classList.remove('reveal');
    void section.offsetWidth; // force reflow so the animation restarts
    section.style.animationDelay = `${Math.min(i, MAX_STAGGERED_SECTIONS) * REVEAL_STAGGER_MS}ms`;
    section.classList.add('reveal');
  });
}

/**
 * Client-side check for the one required field (the server validates everything).
 * @returns {boolean}
 */
function validateCity() {
  const city = field('city');
  if (city.value.trim()) {
    city.removeAttribute('aria-invalid');
    return true;
  }
  city.setAttribute('aria-invalid', 'true');
  city.focus();
  showError(TEXT.cityMissing);
  return false;
}

/**
 * @param {Payload} payload
 * @returns {Promise<PlanResponse>}
 * @throws {Error} with a user-facing message when the API rejects the request
 */
async function requestPlan(payload) {
  const { ok, status, data } = await postJson('/api/plan', payload);
  if (ok) return data;
  const details = Array.isArray(data.details) ? ` ${data.details.join(' ')}` : '';
  const hint = status >= 500 ? TEXT.manualHint : '';
  throw new Error(`${data.error || 'Request failed.'}${details}${hint}`);
}

/**
 * Renders every result section and moves focus to the results heading.
 * @param {PlanResponse} plan
 * @param {boolean} hasQuestion
 */
function renderPlan(plan, hasQuestion) {
  results.hidden = false;
  renderAqi(plan);
  renderNarrative(plan.narrative, { pending: plan.aiAvailable, hasQuestion });
  renderImpact(plan.impactSummary);
  renderRoutine(plan.routine);
  renderItems('indoor', plan.indoorHacks);
  renderItems('alternatives', plan.alternatives);
  renderCommunityAlert(plan.communityAlert);
  revealSections();
  byId('results-heading').focus();
}

/** @param {SubmitEvent} event */
async function onSubmit(event) {
  event.preventDefault();
  formError.hidden = true;
  if (!validateCity()) return;
  setBusy(true);

  const payload = collectPayload();
  const hasQuestion = Boolean(payload.question);
  invalidateNarrative(); // ignore any in-flight AI request from a previous submission
  try {
    const plan = await requestPlan(payload);
    renderPlan(plan, hasQuestion);
    if (plan.aiAvailable) loadAiNarrative(payload, hasQuestion);
  } catch (error) {
    showError(error instanceof Error && error.message ? error.message : TEXT.offline);
  } finally {
    setBusy(false);
  }
}

initCommunityAlert();
form.addEventListener('submit', onSubmit);
