'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProviders,
  createGeminiProvider,
  createAnthropicProvider,
  DEFAULT_MODELS,
} = require('../src/services/ai/providers');

const request = { system: 'sys', user: 'hello', schema: { type: 'object' } };

/** Fake @google/genai module exposing GoogleGenAI with a scripted generateContent. */
function fakeGenAi(handler) {
  const calls = [];
  class GoogleGenAI {
    constructor(options) {
      calls.push({ ctor: options });
      this.models = {
        generateContent: async (params) => {
          calls.push({ params });
          return handler(params);
        },
      };
    }
  }
  return { sdk: { GoogleGenAI }, calls };
}

/** Fake @anthropic-ai/sdk module (beta and GA messages endpoints). */
function fakeAnthropic(handler, gaHandler = handler) {
  const calls = [];
  function Anthropic(options) {
    calls.push({ ctor: options });
    this.beta = {
      messages: {
        create: async (params) => {
          calls.push({ params, beta: true });
          return handler(params);
        },
      },
    };
    this.messages = {
      create: async (params) => {
        calls.push({ params, beta: false });
        return gaHandler(params);
      },
    };
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
  assert.equal(params.config.thinkingConfig, undefined);
});

test('Gemini 3+ models use MINIMAL thinking for speed', async () => {
  const { sdk, calls } = fakeGenAi(() => ({ text: '{}', candidates: [{ finishReason: 'STOP' }] }));
  await createGeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', timeoutMs: 1, sdk }).generate(request);
  assert.deepEqual(calls[1].params.config.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.equal(calls[1].params.config.temperature, undefined);
});

test('a model that rejects MINIMAL thinking is retried with LOW and remembered', async () => {
  const { sdk, calls } = fakeGenAi((params) => {
    if (params.config.thinkingConfig?.thinkingLevel === 'MINIMAL') {
      throw Object.assign(new Error('Thinking level MINIMAL is not supported for this model.'), { status: 400 });
    }
    return { text: '{}', candidates: [{ finishReason: 'STOP' }] };
  });
  const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-3.8-flash', timeoutMs: 1, sdk });
  await provider.generate(request);
  await provider.generate(request);
  const levels = calls.filter((c) => c.params).map((c) => c.params.config.thinkingConfig.thinkingLevel);
  assert.deepEqual(levels, ['MINIMAL', 'LOW', 'LOW']);
});

test('Gemini provider falls back to the next model on 404 and remembers it', async () => {
  const { sdk, calls } = fakeGenAi((params) => {
    if (params.model === 'retired-model') {
      throw Object.assign(new Error('This model is no longer available to new users.'), { status: 404 });
    }
    return { text: '{"ok":1}', candidates: [{ finishReason: 'STOP' }] };
  });
  const provider = createGeminiProvider({
    apiKey: 'k',
    model: 'retired-model',
    models: ['retired-model', 'good-model'],
    timeoutMs: 1,
    sdk,
  });
  assert.equal(provider.model, 'retired-model');
  assert.equal(await provider.generate(request), '{"ok":1}');
  assert.equal(provider.model, 'good-model');
  await provider.generate(request);
  const tried = calls.filter((c) => c.params).map((c) => c.params.model);
  assert.deepEqual(tried, ['retired-model', 'good-model', 'good-model']);
});

test('Gemini provider retries an overloaded model, then uses the next model for that request only', async () => {
  let busyCalls = 0;
  const { sdk, calls } = fakeGenAi((params) => {
    if (params.model === 'busy' && busyCalls++ < 2) {
      throw Object.assign(new Error('This model is currently experiencing high demand.'), { status: 503 });
    }
    return { text: `{"m":"${params.model}"}`, candidates: [{ finishReason: 'STOP' }] };
  });
  const provider = createGeminiProvider({
    apiKey: 'k',
    model: 'busy',
    models: ['spare'],
    timeoutMs: 1,
    sdk,
    retryDelayMs: 0,
  });
  assert.equal(await provider.generate(request), '{"m":"spare"}');
  assert.equal(provider.model, 'busy'); // overload is temporary: not sticky
  assert.equal(await provider.generate(request), '{"m":"busy"}'); // recovered
  assert.deepEqual(
    calls.filter((c) => c.params).map((c) => c.params.model),
    ['busy', 'busy', 'spare', 'busy'],
  );
});

test('Gemini provider treats a 504 deadline like overload and moves to the next model', async () => {
  const { sdk } = fakeGenAi((params) => {
    if (params.model === 'slow') {
      throw Object.assign(new Error('Deadline expired before operation could complete.'), { status: 504 });
    }
    return { text: '{"ok":1}', candidates: [{ finishReason: 'STOP' }] };
  });
  const provider = createGeminiProvider({
    apiKey: 'k',
    model: 'slow',
    models: ['fast'],
    timeoutMs: 1,
    sdk,
    retryDelayMs: 0,
  });
  assert.equal(await provider.generate(request), '{"ok":1}');
});

test('Gemini provider does not switch models on auth errors (backup key handles those)', async () => {
  const { sdk, calls } = fakeGenAi(() => {
    throw Object.assign(new Error('bad key'), { status: 401 });
  });
  const provider = createGeminiProvider({ apiKey: 'k', model: 'a', models: ['b'], timeoutMs: 1, sdk, retryDelayMs: 0 });
  await assert.rejects(provider.generate(request), (error) => error.status === 401);
  assert.equal(calls.filter((c) => c.params).length, 1);
});

test('Gemini quota is per model: a 429 moves to the next model; all exhausted -> 429', async () => {
  const { sdk, calls } = fakeGenAi((params) => {
    if (params.model === 'busy-quota') {
      throw Object.assign(new Error('You exceeded your current quota'), { status: 429 });
    }
    return { text: '{"ok":1}', candidates: [{ finishReason: 'STOP' }] };
  });
  const provider = createGeminiProvider({
    apiKey: 'k',
    model: 'busy-quota',
    models: ['spare'],
    timeoutMs: 1,
    sdk,
    retryDelayMs: 0,
  });
  assert.equal(await provider.generate(request), '{"ok":1}');
  assert.deepEqual(
    calls.filter((c) => c.params).map((c) => c.params.model),
    ['busy-quota', 'spare'],
  );

  const allOut = createGeminiProvider({
    apiKey: 'k',
    model: 'a',
    models: ['b'],
    timeoutMs: 1,
    retryDelayMs: 0,
    sdk: fakeGenAi(() => {
      throw Object.assign(new Error('quota'), { status: 429 });
    }).sdk,
  });
  await assert.rejects(allOut.generate(request), (error) => error.status === 429);
});

test('Gemini provider surfaces the last error when every model is overloaded', async () => {
  const { sdk } = fakeGenAi(() => {
    throw Object.assign(new Error('busy'), { status: 503 });
  });
  const provider = createGeminiProvider({ apiKey: 'k', model: 'a', models: ['b'], timeoutMs: 1, sdk, retryDelayMs: 0 });
  await assert.rejects(provider.generate(request), (error) => error.status === 503);
});

test('Gemini provider surfaces 404 when every model is unavailable', async () => {
  const { sdk } = fakeGenAi(() => {
    throw Object.assign(new Error('gone'), { status: 404 });
  });
  const provider = createGeminiProvider({ apiKey: 'k', model: 'a', models: ['b'], timeoutMs: 1, sdk });
  await assert.rejects(provider.generate(request), (error) => error.status === 404);
});

test('Gemini 2.5 Flash runs with thinking disabled so JSON is not truncated', async () => {
  const { sdk, calls } = fakeGenAi(() => ({ text: '{}', candidates: [{ finishReason: 'STOP' }] }));
  await createGeminiProvider({ apiKey: 'k', model: 'gemini-2.5-flash', timeoutMs: 1, sdk }).generate(request);
  assert.deepEqual(calls[1].params.config.thinkingConfig, { thinkingBudget: 0 });
});

test('Gemini provider maps an invalid-key 400 to 401 so the backup key is tried', async () => {
  const { sdk } = fakeGenAi(() => {
    throw Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 });
  });
  const provider = createGeminiProvider({ apiKey: 'bad', model: 'm', timeoutMs: 1, sdk });
  await assert.rejects(provider.generate(request), (error) => error.status === 401);
});

test('Gemini provider keeps other 400s as 400 and flags safety stops / empty output as 422', async () => {
  const other400 = createGeminiProvider({
    apiKey: 'k',
    model: 'm',
    timeoutMs: 1,
    sdk: fakeGenAi(() => {
      throw Object.assign(new Error('bad schema'), { status: 400 });
    }).sdk,
  });
  await assert.rejects(other400.generate(request), (error) => error.status === 400);

  const safety = createGeminiProvider({
    apiKey: 'k',
    model: 'm',
    timeoutMs: 1,
    sdk: fakeGenAi(() => ({ text: '', candidates: [{ finishReason: 'SAFETY' }] })).sdk,
  });
  await assert.rejects(safety.generate(request), (error) => error.status === 422 && /SAFETY/.test(error.message));

  const empty = createGeminiProvider({
    apiKey: 'k',
    model: 'm',
    timeoutMs: 1,
    sdk: fakeGenAi(() => ({ text: '' })).sdk,
  });
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

test('Anthropic provider retries without the fallback beta if the account rejects it', async () => {
  const ok = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] };
  const { sdk, calls } = fakeAnthropic(
    () => {
      throw Object.assign(new Error('fallbacks: unsupported beta'), { status: 400 });
    },
    () => ok,
  );
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'm', timeoutMs: 1, sdk });
  assert.equal(await provider.generate(request), '{"a":1}');
  assert.equal(await provider.generate(request), '{"a":1}');
  const sent = calls.filter((c) => c.params);
  assert.deepEqual(
    sent.map((c) => c.beta),
    [true, false, false],
  ); // beta tried once, then remembered
  assert.equal(sent[1].params.fallbacks, undefined);
  assert.equal(sent[1].params.output_config.format.type, 'json_schema');
});

test('Anthropic provider does not hide unrelated 400 errors', async () => {
  const { sdk } = fakeAnthropic(() => {
    throw Object.assign(new Error('invalid schema'), { status: 400 });
  });
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'm', timeoutMs: 1, sdk });
  await assert.rejects(provider.generate(request), (error) => error.status === 400 && /schema/.test(error.message));
});

test('createProviders builds one labelled provider per key with default models', () => {
  const providers = createProviders({ provider: 'gemini', apiKeys: ['a', 'b'], timeoutMs: 1 });
  assert.deepEqual(
    providers.map((p) => p.name),
    ['gemini#1', 'gemini#2'],
  );
  assert.equal(DEFAULT_MODELS.gemini, 'gemini-3.8-flash');
  assert.equal(createProviders({ provider: 'anthropic', apiKeys: ['a'], timeoutMs: 1 })[0].name, 'anthropic#1');
  assert.throws(() => createProviders({ provider: 'nope', apiKeys: [], timeoutMs: 1 }), /Unknown LLM provider/);
});
