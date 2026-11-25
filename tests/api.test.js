'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createAirQualityService } = require('../src/services/airQuality');
const { createAssistant } = require('../src/services/assistant');
const { makeFetch, silentLogger } = require('./helpers');

/** Starts the app on an ephemeral port and returns a base URL + closer. */
async function startServer({ fail = false, rateLimitPerMinute = 100, assistant } = {}) {
  const { fetchImpl } = makeFetch({ fail });
  const app = createApp({
    airQuality: createAirQualityService({ fetchImpl }),
    assistant: assistant || createAssistant({ enabled: false }),
    rateLimitPerMinute,
    logger: silentLogger,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

const postJson = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('API end-to-end', async (t) => {
  const srv = await startServer();
  t.after(srv.close);

  await t.test('GET /api/health', async () => {
    const res = await fetch(`${srv.base}/api/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  await t.test('security headers are set', async () => {
    const res = await fetch(`${srv.base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('permissions-policy'), /geolocation=\(\)/);
  });

  await t.test('GET /api/air returns reading with band', async () => {
    const res = await fetch(`${srv.base}/api/air?city=Delhi`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.aqi, 312);
    assert.equal(body.band.label, 'Hazardous');
  });

  await t.test('GET /api/air validates city', async () => {
    const res = await fetch(`${srv.base}/api/air?city=${encodeURIComponent('<b>')}`);
    assert.equal(res.status, 400);
  });

  await t.test('POST /api/plan returns full plan and narrative', async () => {
    const res = await postJson(`${srv.base}/api/plan`, {
      city: 'Delhi',
      hasChildren: true,
      commuteMode: 'car_diesel',
      commuteKm: 12,
      heating: 'wood_coal',
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(body.risk.aqi, 312);
    assert.equal(body.routine.length, 4);
    assert.ok(body.indoorHacks.length >= 5);
    assert.ok(body.alternatives.some((a) => a.id === 'clean-heating'));
    assert.equal(body.narrative.source, 'rules');
    assert.equal(body.narrative.priorities.length, 3);
    assert.equal(body.air.forecast.cleanestWindow.start, '2026-11-23T14:00');
    assert.match(body.communityAlert, /^Air alert for Delhi: AQI 312/);
  });

  await t.test('POST /api/plan with manual AQI skips the network', async () => {
    const res = await postJson(`${srv.base}/api/plan`, { city: 'Offline Town', manualAqi: 75 });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.risk.category, 'Moderate');
    assert.equal(body.air.source, 'Manual entry');
  });

  await t.test('POST /api/plan rejects invalid input with details', async () => {
    const res = await postJson(`${srv.base}/api/plan`, { city: '', heating: 'nuclear' });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.details.length, 2);
  });

  await t.test('malformed JSON and oversized bodies are rejected', async () => {
    const bad = await postJson(`${srv.base}/api/plan`, '{oops');
    assert.equal(bad.status, 400);
    const big = await postJson(`${srv.base}/api/plan`, { city: 'Delhi', question: 'x'.repeat(20_000) });
    assert.equal(big.status, 413);
  });

  await t.test('unknown API route returns JSON 404', async () => {
    const res = await fetch(`${srv.base}/api/nope`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'Not found.');
  });
});

test('upstream outage surfaces a friendly 503', async (t) => {
  const srv = await startServer({ fail: true });
  t.after(srv.close);
  const res = await postJson(`${srv.base}/api/plan`, { city: 'Delhi' });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /unreachable/);
});

test('responses are gzip-compressed when the client accepts it', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const res = await fetch(`${srv.base}/styles.css`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
});

test('AI narrative endpoint has a tighter rate limit than the rest of the API', async (t) => {
  const srv = await startServer({ rateLimitPerMinute: 6 }); // narrative limit = 2
  t.after(srv.close);
  const body = { city: 'Delhi', manualAqi: 80 };
  assert.equal((await postJson(`${srv.base}/api/narrative`, body)).status, 200);
  assert.equal((await postJson(`${srv.base}/api/narrative`, body)).status, 200);
  const limited = await postJson(`${srv.base}/api/narrative`, body);
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /plan requests/);
  assert.equal((await fetch(`${srv.base}/api/health`)).status, 200);
});

test('rate limiter returns 429 after the limit', async (t) => {
  const srv = await startServer({ rateLimitPerMinute: 2 });
  t.after(srv.close);
  await fetch(`${srv.base}/api/health`);
  await fetch(`${srv.base}/api/health`);
  const res = await fetch(`${srv.base}/api/health`);
  assert.equal(res.status, 429);
});

test('plan responds without waiting for the AI; narrative endpoint returns the AI briefing', async (t) => {
  let calls = 0;
  const slowProvider = {
    name: 'slow',
    generate: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return JSON.stringify({ summary: 'AI summary', priorities: [{ action: 'A', impact: 'a' }], answer: 'AI answer' });
    },
  };
  const srv = await startServer({
    assistant: createAssistant({ enabled: true, providers: [slowProvider], logger: silentLogger }),
  });
  t.after(srv.close);
  const body = { city: 'Delhi', manualAqi: 250, question: 'Can my kid play outside?' };

  const started = Date.now();
  const plan = await (await postJson(`${srv.base}/api/plan`, body)).json();
  assert.ok(Date.now() - started < 250, 'plan must not wait for the slow AI');
  assert.equal(plan.aiAvailable, true);
  assert.equal(plan.narrative.source, 'rules');
  assert.equal(calls, 0);

  const ai = await (await postJson(`${srv.base}/api/narrative`, body)).json();
  assert.equal(ai.narrative.source, 'ai');
  assert.equal(ai.narrative.answer, 'AI answer');
});

test('narrative endpoint validates input like the plan endpoint', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const res = await postJson(`${srv.base}/api/narrative`, { city: '' });
  assert.equal(res.status, 400);
  const off = await (await postJson(`${srv.base}/api/narrative`, { city: 'Delhi', manualAqi: 90 })).json();
  assert.equal(off.narrative.source, 'rules');
  assert.equal(off.narrative.reason, 'disabled');
});

test('cross-site and non-JSON POSTs are rejected (CSRF protection)', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const body = JSON.stringify({ city: 'Delhi', manualAqi: 90 });
  const post = (headers) =>
    fetch(`${srv.base}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });

  assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await post({ 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({ Origin: 'not a url' })).status, 403);
  assert.equal((await post({ Origin: srv.base })).status, 200);
  assert.equal((await post({ Origin: 'https://app.example', 'X-Forwarded-Host': 'app.example' })).status, 200);

  const form = await fetch(`${srv.base}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body,
  });
  assert.equal(form.status, 415);
  assert.match((await form.json()).error, /application\/json/);
});

test('CSP also restricts base-uri and form-action', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const csp = (await fetch(`${srv.base}/`)).headers.get('content-security-policy');
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
