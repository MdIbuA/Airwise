'use strict';

/**
 * AirWise front end. All server data is rendered with textContent / DOM APIs
 * (never innerHTML), so model or API output cannot inject markup. Dynamic
 * styling goes through the CSSOM (element.style / SVG attributes), which the
 * strict Content-Security-Policy allows.
 */
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const form = document.getElementById('profile-form');
  const submitBtn = document.getElementById('submit-btn');
  const submitLabel = submitBtn.querySelector('.btn__label');
  const formError = document.getElementById('form-error');
  const results = document.getElementById('results');
  const loading = document.getElementById('loading');

  /** Small element factory: el('p', { className: 'x' }, 'text', child). */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  /** Decorative icon from the inline sprite. */
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  /** replaceChildren() would render null as the text "null", so drop falsy nodes. */
  function setChildren(parent, ...children) {
    parent.replaceChildren(...children.filter((child) => child !== null && child !== undefined && child !== false));
  }

  const formatTime = (iso) => (iso ? iso.slice(11, 16) : '');
  const hourOf = (iso) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
  const bandColor = (level) => `var(--band-${Math.max(0, Math.min(5, level))})`;

  /** Animates a number from 0 to `to` (instantly when reduced motion is on). */
  function countUp(node, to, { decimals = 0, duration = 1100 } = {}) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const format = (v) => v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
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

  /* ---------------- AQI panel ---------------- */

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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      value.style.strokeDashoffset = String(arc * (1 - fraction));
    }));

    const num = el('span', { className: 'gauge__num' }, '0');
    countUp(num, aqi);
    const wrap = el(
      'div',
      { className: 'gauge' },
      svg,
      el('div', { className: 'gauge__center' }, el('span', { className: 'gauge__label' }, 'US AQI'), num, el('span', { className: 'gauge__scale' }, 'of 500')),
    );
    wrap.style.setProperty('--band-color', bandColor(level));
    return wrap;
  }

  function meter(label, valueText, percent, extraClass = '') {
    const fill = el('div', { className: `meter__fill ${extraClass}` });
    const pct = Math.max(2, Math.min(100, percent));
    // Keep gradient colours tied to the absolute 0–100 scale, not the fill width.
    if (extraClass) fill.style.backgroundSize = `${(100 / pct) * 100}% 100%`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.width = `${pct}%`;
    }));
    const bar = el('div', { className: 'meter__bar' }, fill);
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${label}: ${valueText}`);
    return el('div', { className: 'meter' }, el('div', { className: 'meter__head' }, el('span', {}, label), el('strong', {}, valueText)), bar);
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
    const ticks = el('div', { className: 'daystrip__ticks' }, ...['06:00', '10:00', '14:00', '18:00', '22:00'].map((t) => el('span', {}, t)));
    ticks.setAttribute('aria-hidden', 'true');

    const caption = el(
      'p',
      { className: 'daystrip__caption' },
      el('strong', {}, `Cleanest window today: ${formatTime(win.start)}–${formatTime(win.end)}`),
      ` (≈${win.meanPm25} µg/m³)`,
      forecast.worstHour ? ` · Worst hour: ${formatTime(forecast.worstHour.time)} (≈${forecast.worstHour.pm25} µg/m³)` : '',
    );
    return el('div', { className: 'daystrip' }, bar, ticks, caption);
  }

  function renderAqi(data) {
    const card = document.getElementById('aqi-card');
    const { air, risk } = data;
    card.style.setProperty('--band-color', bandColor(risk.level));
    const place = [air.location?.name, air.location?.region, air.location?.country].filter(Boolean).join(', ');

    const bandPill = el('span', { className: 'band-pill' }, el('span', { className: 'band-dot' }), risk.category);
    bandPill.querySelector('.band-dot').setAttribute('aria-hidden', 'true');

    const meters = [];
    if (Number.isFinite(air.pm25)) {
      const times = air.pm25 / 15;
      meters.push(meter('PM2.5 vs WHO 24-h guideline (15 µg/m³)', `${Math.round(air.pm25)} µg/m³ · ${times.toFixed(1)}×`, (air.pm25 / 250) * 100));
    }
    meters.push(meter('Personal risk score', `${risk.personalRiskScore}/100`, risk.personalRiskScore, 'meter__fill--risk'));

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

  /* ---------------- AI briefing ---------------- */

  /**
   * Coach card. States:
   *  - pending: rule-based briefing shown, AI still writing (status line + shimmer)
   *  - ai:      AI briefing
   *  - rules:   final rule-based briefing (AI off, failed or slow)
   */
  function renderNarrative(narrative, { pending = false, hasQuestion = false } = {}) {
    const card = document.getElementById('narrative-card');
    const isAi = narrative.source === 'ai';
    card.classList.toggle('is-pending', pending);
    card.setAttribute('aria-busy', String(pending));

    let answer = null;
    if (pending && hasQuestion) {
      answer = el('div', { className: 'answer answer--pending' }, icon('chat'), el('div', {}, el('strong', {}, 'Your question'), el('p', {}, 'The AI coach is answering…')));
    } else if (narrative.answer) {
      const text = narrative.reason === 'timeout' && hasQuestion
        ? 'The AI coach is busy right now, so this answer is not ready yet. Submit again in a minute — it will be ready instantly.'
        : narrative.answer;
      answer = el('div', { className: 'answer' }, icon('chat'), el('div', {}, el('strong', {}, 'Your question'), el('p', {}, text)));
    }

    const badge = isAi ? 'AI coach' : pending ? 'AI coach · writing' : 'Coach · rule-based';
    const title = isAi ? 'AI coach briefing' : 'Coach briefing (rule-based)';
    setChildren(
      card,
      el('span', { className: 'ai-badge' }, icon('spark'), badge),
      el('h3', {}, title),
      pending ? el('div', { className: 'ai-progress' }, el('span', { className: 'ai-progress__bar' }), el('span', {}, 'Personalising with AI — your plan below is ready to use now.')) : null,
      el('p', { className: 'ai-summary' }, narrative.summary),
      el('h4', { className: 'visually-hidden' }, 'Top 3 actions today'),
      el('ol', { className: 'top-actions' }, ...narrative.priorities.map((p) => el('li', {}, el('strong', {}, p.action), el('p', {}, p.impact)))),
      answer,
    );
  }

  /** Upgrades the coach card with the AI briefing, ignoring stale responses. */
  let narrativeRequestId = 0;
  async function loadAiNarrative(payload, hasQuestion) {
    const requestId = ++narrativeRequestId;
    const status = document.getElementById('ai-status');
    let narrative = null;
    try {
      const response = await fetch('/api/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.ok) narrative = (await response.json()).narrative;
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


  /* ---------------- Impact tiles ---------------- */

  function statTile(value, unit, label, decimals = 0) {
    const num = el('span', {}, '0');
    countUp(num, value, { decimals });
    return el('div', { className: 'stat' }, el('span', { className: 'stat__value' }, num, el('span', { className: 'stat__unit' }, unit)), el('span', { className: 'stat__label' }, label));
  }

  function renderImpact(summary) {
    const text = document.getElementById('impact-summary');
    const tiles = document.getElementById('stat-tiles');
    if (summary.co2KgPerYear > 0) {
      text.textContent = `Adopting these swaps could avoid ≈${summary.co2KgPerYear} kg CO₂ per year (${summary.co2KgPerWeek} kg/week) — about what ${summary.treeEquivalent} mature ${summary.treeEquivalent === 1 ? 'tree absorbs' : 'trees absorb'}.`;
      setChildren(
        tiles,
        statTile(summary.co2KgPerYear, 'kg', 'CO₂ avoidable per year'),
        statTile(summary.co2KgPerWeek, 'kg', 'CO₂ avoidable per week', 1),
        statTile(summary.treeEquivalent, summary.treeEquivalent === 1 ? 'tree' : 'trees', 'Equivalent yearly absorption'),
      );
    } else {
      text.textContent = 'Your current choices are already low-emission — focus on reducing exposure and helping your community.';
      tiles.replaceChildren();
    }
  }

  /* ---------------- Routine & cards ---------------- */

  const SLOT_ICONS = ['sunrise', 'sun', 'sunset', 'moon'];

  function renderRoutine(routine) {
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
      chips.push(el('span', { className: 'metric metric--exposure' }, `Exposure ↓ ${impact.exposureReductionPct[0]}–${impact.exposureReductionPct[1]}%`));
    }
    if (Number.isFinite(impact.co2KgPerWeek) && impact.co2KgPerWeek > 0) {
      chips.push(el('span', { className: 'metric' }, `CO₂ ↓ ${impact.co2KgPerWeek} kg/week`));
    }
    if (Number.isFinite(impact.pm25GramsPerWeek) && impact.pm25GramsPerWeek > 0) {
      chips.push(el('span', { className: 'metric' }, `PM2.5 ↓ ${impact.pm25GramsPerWeek} g/week`));
    }
    return chips.length ? el('div', { className: 'metrics' }, ...chips) : null;
  }

  function renderItems(listId, items) {
    document.getElementById(listId).replaceChildren(
      ...items.map((item) =>
        el(
          'li',
          { className: 'card' },
          el('span', { className: `badge ${item.priority}` }, `${item.priority} priority`),
          el('h4', {}, item.title),
          el('p', {}, item.detail),
          el('div', { className: 'card__foot' }, metricChips(item.impact), el('p', { className: 'impact-text' }, el('strong', {}, 'Impact: '), item.impact.explanation)),
        ),
      ),
    );
  }

  /* ---------------- Community alert ---------------- */

  function renderCommunityAlert(text) {
    document.getElementById('community-alert').textContent = text;
    document.getElementById('copy-status').textContent = '';
    document.getElementById('share-alert').hidden = typeof navigator.share !== 'function';
  }

  document.getElementById('copy-alert').addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    const text = document.getElementById('community-alert').textContent;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Alert copied — paste it into your group chat.';
    } catch {
      // Clipboard can be blocked (permissions / insecure context): select the text instead.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('community-alert'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Copy is blocked here — the text is selected, press Ctrl+C / ⌘+C.';
    }
  });

  document.getElementById('share-alert').addEventListener('click', async () => {
    try {
      await navigator.share({ title: 'Air alert', text: document.getElementById('community-alert').textContent });
    } catch {
      /* user cancelled the share sheet */
    }
  });

  /* ---------------- Form handling ---------------- */

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
    narrativeRequestId += 1; // invalidate any in-flight AI request from a previous submit
    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(data.details) ? ` ${data.details.join(' ')}` : '';
        const hint = response.status >= 500 ? ' You can enter the AQI manually in step 4.' : '';
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
})();
