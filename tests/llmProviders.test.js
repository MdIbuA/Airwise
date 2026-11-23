'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProviders, createGeminiProvider, createAnthropicProvider, DEFAULT_MODELS } = require('../src/services/llmProviders');

const request = { system: 'sys', user: 'hello', schema: { type: 'object' } };

/** Fake @google/genai module exposing GoogleGenAI with a scripted generateContent. */
function fakeGenAi(handler) {
  const calls = [];
  class GoogleGenAI {
    constructor(options) {
      calls.push({ ctor: options });
      this.models = { generateContent: async (params) => { calls.push({ params }); return handler(params); } };
    }
  }
  return { sdk: { GoogleGenAI }, calls };
}

/** Fake @anthropic-ai/sdk module. */
function fakeAnthropic(handler) {
  const calls = [];
  function Anthropic(options) {
    calls.push({ ctor: options });
    this.beta = { messages: { create: async (params) => { calls.push({ params }); return handler(params); } } };
  }
  return { sdk: Anthropic, calls };
}

test('Gemini provider sends system prompt + JSON schema and returns text', async () => {
  const { sdk, calls } = fakeGenAi(() => ({ text: '{"ok":true}', candidates: [{ finishReason: 'STOP' }] }));
  const provider = createGeminiProvider({ apiKey: 'k1', model: 'gemini-test', timeoutMs: 5000, sdk });
  assert.equal(await provider.generate(request), '{"ok":true}');
  assert.deepEqual(calls[0].ctor, { apiKey: 'k1', httpOptions: { timeout: 5000 } });
  const { params } = calls[1];
  assert.equal(params.model, 'gemini-test');
  assert.equal(params.contents, 'hello');
  assert.equal(params.config.systemInstruction, 'sys');
  assert.equal(params.config.responseMimeType, 'application/json');
  assert.deepEqual(params.config.responseJsonSchema, { type: 'object' });
});

test('Gemini provider maps an invalid-key 400 to 401 so the backup key is tried', async () => {
  const { sdk } = fakeGenAi(() => {
    throw Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 });
  });
  const provider = createGeminiProvider({ apiKey: 'bad', model: 'm', timeoutMs: 1, sdk });
  await assert.rejects(provider.generate(request), (error) => error.status === 401);
});

test('Gemini provider keeps other 400s as 400 and flags safety stops / empty output as 422', async () => {
  const other400 = createGeminiProvider({ apiKey: 'k', model: 'm', timeoutMs: 1, sdk: fakeGenAi(() => { throw Object.assign(new Error('bad schema'), { status: 400 }); }).sdk });
  await assert.rejects(other400.generate(request), (error) => error.status === 400);

  const safety = createGeminiProvider({ apiKey: 'k', model: 'm', timeoutMs: 1, sdk: fakeGenAi(() => ({ text: '', candidates: [{ finishReason: 'SAFETY' }] })).sdk });
  await assert.rejects(safety.generate(request), (error) => error.status === 422 && /SAFETY/.test(error.message));

  const empty = createGeminiProvider({ apiKey: 'k', model: 'm', timeoutMs: 1, sdk: fakeGenAi(() => ({ text: '' })).sdk });
  await assert.rejects(empty.generate(request), (error) => error.status === 422);
});

test('Anthropic provider uses structured output and rejects refusals', async () => {
  const ok = fakeAnthropic(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] }));
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-test', timeoutMs: 1, sdk: ok.sdk });
  assert.equal(await provider.generate(request), '{"a":1}');
  const { params } = ok.calls[1];
  assert.equal(params.model, 'claude-test');
  assert.equal(params.system, 'sys');
  assert.equal(params.output_config.format.type, 'json_schema');

  const refused = fakeAnthropic(() => ({ stop_reason: 'refusal', content: [] }));
  const refusing = createAnthropicProvider({ apiKey: 'k', model: 'm', timeoutMs: 1, sdk: refused.sdk });
  await assert.rejects(refusing.generate(request), (error) => error.status === 422);
});

test('createProviders builds one labelled provider per key with default models', () => {
  const providers = createProviders({ provider: 'gemini', apiKeys: ['a', 'b'], timeoutMs: 1 });
  assert.deepEqual(providers.map((p) => p.name), ['gemini#1', 'gemini#2']);
  assert.equal(DEFAULT_MODELS.gemini, 'gemini-3.8-flash');
  assert.equal(createProviders({ provider: 'anthropic', apiKeys: ['a'], timeoutMs: 1 })[0].name, 'anthropic#1');
  assert.throws(() => createProviders({ provider: 'nope', apiKeys: [], timeoutMs: 1 }), /Unknown LLM provider/);
});
