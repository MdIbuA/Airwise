/**
 * AirWise front end entry point: form handling and orchestration of the
 * result sections. Loaded as an ES module (allowed by the strict CSP: 'self').
 */

import { postJson } from './api.js';
import { renderAqi } from './aqiPanel.js';
import { renderNarrative, loadAiNarrative, invalidateNarrative } from './narrative.js';
import { renderImpact, renderRoutine, renderItems } from './sections.js';
import { renderCommunityAlert, initCommunityAlert } from './community.js';

const form = document.getElementById('profile-form');
const submitBtn = document.getElementById('submit-btn');
const submitLabel = submitBtn.querySelector('.btn__label');
const formError = document.getElementById('form-error');
const results = document.getElementById('results');
const loading = document.getElementById('loading');

initCommunityAlert();

function collectPayload() {
  const data = new FormData(form);
  const payload = {};
  for (const [key, value] of data.entries()) payload[key] = typeof value === 'string' ? value.trim() : value;
  for (const name of ['hasChildren', 'hasElderly', 'hasRespiratoryCondition', 'isPregnant', 'hasAirPurifier']) {
    payload[name] = form.elements[name].checked;
  }
  if (!payload.manualAqi) delete payload.manualAqi;
  return payload;
}

function showError(message) {
  formError.textContent = message;
  formError.hidden = false;
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitLabel.textContent = busy ? 'Building your plan…' : 'Get my clean-air plan';
  results.setAttribute('aria-busy', String(busy));
  loading.hidden = !busy;
  if (busy) results.hidden = true;
}

function revealSections() {
  const blocks = results.querySelectorAll(':scope > *');
  blocks.forEach((node, i) => {
    node.classList.remove('reveal');
    // Restart the animation, staggered.
    void node.offsetWidth;
    node.style.animationDelay = `${Math.min(i, 8) * 70}ms`;
    node.classList.add('reveal');
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const city = form.elements.city;
  if (!city.value.trim()) {
    city.setAttribute('aria-invalid', 'true');
    city.focus();
    showError('Please enter your city or town.');
    return;
  }
  city.removeAttribute('aria-invalid');
  setBusy(true);

  const payload = collectPayload();
  invalidateNarrative(); // ignore any in-flight AI request from a previous submit
  try {
    const { ok, status, data } = await postJson('/api/plan', payload);
    if (!ok) {
      const details = Array.isArray(data.details) ? ` ${data.details.join(' ')}` : '';
      const hint = status >= 500 ? ' You can enter the AQI manually in step 4.' : '';
      throw new Error(`${data.error || 'Request failed.'}${details}${hint}`);
    }
    results.hidden = false;
    renderAqi(data);
    const hasQuestion = Boolean(payload.question);
    renderNarrative(data.narrative, { pending: data.aiAvailable, hasQuestion });
    renderImpact(data.impactSummary);
    renderRoutine(data.routine);
    renderItems('indoor', data.indoorHacks);
    renderItems('alternatives', data.alternatives);
    renderCommunityAlert(data.communityAlert);
    revealSections();
    document.getElementById('results-heading').focus();
    if (data.aiAvailable) loadAiNarrative(payload, hasQuestion);
  } catch (error) {
    showError(error.message || 'Could not reach AirWise. Check your connection and try again.');
  } finally {
    setBusy(false);
  }
});
