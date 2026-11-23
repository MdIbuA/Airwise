'use strict';

/**
 * LLM provider adapters. Each adapter exposes the same tiny interface:
 *
 *   { name: string, generate({ system, user, schema }) -> Promise<string JSON> }
 *
 * so the assistant can fail over between keys (and even vendors) without
 * knowing SDK details. SDKs are required lazily, so a deployment only loads
 * the one it uses. Errors carry an HTTP-like `status` for failover decisions.
 */

const MAX_OUTPUT_TOKENS = 2000;
// Gemini counts any thinking tokens against this limit, so leave headroom.
const GEMINI_MAX_OUTPUT_TOKENS = 4096;

/** Refusal / empty output: 422 so it is NOT retried with the backup key. */
function outputError(message) {
  return Object.assign(new Error(message), { name: 'OutputError', status: 422 });
}

/** Per-model thinking settings: narrating pre-computed facts needs little reasoning. */
function geminiThinkingConfig(model) {
  // 2.5 Flash thinks by default and thinking tokens count against
  // maxOutputTokens; disabling it avoids truncated JSON.
  if (/2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  // Gemini 3+ uses thinking levels; LOW is fast and plenty for this task.
  if (/^gemini-[3-9]/.test(model)) return { thinkingLevel: 'LOW' };
  return undefined;
}

/** True when Google says the model doesn't exist or is retired for this key. */
const isModelUnavailable = (error) => error?.status === 404;
/** True when the model is temporarily overloaded (worth retrying / switching model). */
const isOverloaded = (error) => error?.status === 503 || error?.status === 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Google Gemini via the official @google/genai SDK, with JSON-schema
 * constrained output. `models` is a preference-ordered list: if Google
 * reports a model as unavailable (404, e.g. retired for new users), the next
 * one is tried and remembered, so a model retirement can't silently turn AI off.
 */
function createGeminiProvider({ apiKey, model, models, timeoutMs, label = 'gemini', sdk, retryDelayMs = 800 }) {
  const chain = [...new Set([model, ...(models || [])].filter(Boolean))];
  let active = 0;
  let client;
  const getClient = () => {
    if (!client) {
      const { GoogleGenAI } = sdk || require('@google/genai');
      client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
    }
    return client;
  };

  async function callModel(modelName, { system, user, schema }) {
    const thinkingConfig = geminiThinkingConfig(modelName);
    try {
      return await getClient().models.generateContent({
        model: modelName,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          // Google advises keeping Gemini 3+ at its default temperature.
          ...(/^gemini-[3-9]/.test(modelName) ? {} : { temperature: 0.4 }),
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });
    } catch (error) {
      // Gemini reports an invalid key as HTTP 400; treat it as an auth failure
      // so the backup key is tried.
      if (error?.status === 400 && /API[_ ]KEY/i.test(error.message || '')) error.status = 401;
      throw error;
    }
  }

  /**
   * Model resilience, in order:
   *  - 404 (retired / not enabled for this key): skip that model permanently.
   *  - 503 (overloaded): retry the same model once after a short pause, then
   *    try the next model for this request only; the preferred model is tried
   *    first again next time, since overload is temporary.
   * Anything else (bad key, quota) is thrown so the backup key can be tried.
   */
  async function callWithFallback(request) {
    let lastError;
    for (let i = active; i < chain.length; i += 1) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await callModel(chain[i], request);
        } catch (error) {
          lastError = error;
          if (isModelUnavailable(error)) {
            if (i === active && active < chain.length - 1) active += 1;
            break; // next model
          }
          if (!isOverloaded(error)) throw error;
          if (attempt === 0) await sleep(retryDelayMs);
        }
      }
    }
    throw lastError;
  }

  return {
    name: label,
    /** The model currently in use (after any fallback). */
    get model() {
      return chain[active];
    },
    async generate(request) {
      const response = await callWithFallback(request);
      const finishReason = response?.candidates?.[0]?.finishReason;
      if (finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(finishReason)) {
        throw outputError(`Gemini stopped early: ${finishReason}`);
      }
      const text = response?.text;
      if (!text) throw outputError('Gemini returned no text');
      return text;
    },
  };
}

/** Anthropic Claude via the official @anthropic-ai/sdk, structured output. */
function createAnthropicProvider({ apiKey, model, timeoutMs, label = 'anthropic', sdk }) {
  let client;
  const getClient = () => {
    if (!client) {
      const Anthropic = sdk || require('@anthropic-ai/sdk');
      const Ctor = Anthropic.default || Anthropic;
      client = new Ctor({ apiKey, timeout: timeoutMs, maxRetries: 1 });
    }
    return client;
  };

  return {
    name: label,
    async generate({ system, user, schema }) {
      const response = await getClient().beta.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Server-side fallback keeps answers flowing if the primary model declines.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Narrating pre-computed facts is a light task: low effort = faster, cheaper.
        output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: user }],
      });
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
        throw outputError(`Claude stopped early: ${response.stop_reason}`);
      }
      return response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    },
  };
}

const DEFAULT_MODELS = Object.freeze({ gemini: 'gemini-3.8-flash', anthropic: 'claude-opus-5-5' });
/** Tried in order after the chosen model if Google reports it unavailable. */
// Models that don't exist for a key return 404 and are skipped automatically.
const GEMINI_FALLBACK_MODELS = Object.freeze(['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
const FACTORIES = Object.freeze({ gemini: createGeminiProvider, anthropic: createAnthropicProvider });

/**
 * Builds one provider per API key (primary first, then backup).
 * @param {{ provider: 'gemini'|'anthropic', apiKeys: string[], model?: string, timeoutMs: number }} options
 */
function createProviders({ provider, apiKeys, model, timeoutMs }) {
  const factory = FACTORIES[provider];
  if (!factory) throw new Error(`Unknown LLM provider: ${provider}`);
  return apiKeys.map((apiKey, i) =>
    factory({
      apiKey,
      model: model || DEFAULT_MODELS[provider],
      models: provider === 'gemini' ? GEMINI_FALLBACK_MODELS : undefined,
      timeoutMs,
      label: `${provider}#${i + 1}`,
    }),
  );
}

module.exports = { createProviders, createGeminiProvider, createAnthropicProvider, DEFAULT_MODELS, GEMINI_FALLBACK_MODELS };
