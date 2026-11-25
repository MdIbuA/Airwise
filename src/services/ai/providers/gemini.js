'use strict';

/**
 * Google Gemini adapter (official @google/genai SDK) with JSON-schema output
 * and model-level resilience:
 *  - 404 (model retired / not enabled for this key): skip it permanently.
 *  - 429 (quota, counted per model): try the next model.
 *  - 500/503/504 (transient): retry once after a pause, then try the next
 *    model for this request only (the preferred model is tried again next time).
 * Anything else (e.g. a bad key) is thrown so the assistant can try the backup key.
 */

const { outputError, isModelUnavailable, isOverloaded, isQuotaExceeded } = require('../errors');

/** @typedef {import('../../../types').LlmRequest} LlmRequest */
/** @typedef {import('../../../types').LlmProvider} LlmProvider */
/** @typedef {'MINIMAL'|'LOW'} ThinkingLevel */

// Gemini counts any thinking tokens against this limit, so leave headroom.
const MAX_OUTPUT_TOKENS = 4096;
const LEGACY_TEMPERATURE = 0.4;
const DEFAULT_RETRY_DELAY_MS = 800;
const OK_FINISH_REASONS = new Set(['STOP', 'FINISH_REASON_UNSPECIFIED']);

/** @param {string} model */
const isGemini3Plus = (model) => /^gemini-[3-9]/.test(model);

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-model thinking settings: narrating pre-computed facts needs little reasoning.
 * @param {string} model
 * @param {ThinkingLevel} level
 * @returns {object|undefined}
 */
function thinkingConfigFor(model, level) {
  // 2.5 Flash thinks by default and thinking tokens count against
  // maxOutputTokens; disabling it avoids truncated JSON.
  if (/2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (isGemini3Plus(model)) return { thinkingLevel: level };
  return undefined;
}

/** @param {unknown} error 404 or 429: this model can't serve the request now */
const shouldTryNextModel = (error) => isModelUnavailable(error) || isQuotaExceeded(error);

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.model preferred model
 * @param {readonly string[]} [options.models] fallback models, in order
 * @param {number} options.timeoutMs per-call timeout
 * @param {string} [options.label] provider name used in logs
 * @param {any} [options.sdk] injected Google GenAI SDK module (tests)
 * @param {number} [options.retryDelayMs] pause before retrying an overloaded model
 * @returns {LlmProvider}
 */
function createGeminiProvider({
  apiKey,
  model,
  models = [],
  timeoutMs,
  label = 'gemini',
  sdk = undefined,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}) {
  const chain = [...new Set([model, ...models].filter(Boolean))];
  let active = 0; // index of the first model still worth trying
  /** @type {any} */
  let client;
  /** Models that rejected MINIMAL thinking; they are called with LOW from then on. */
  const needsLowThinking = new Set();

  /** Creates the Google GenAI SDK client on first use (lazy, so unused SDKs never load). */
  function getClient() {
    if (!client) {
      const { GoogleGenAI } = sdk || require('@google/genai');
      client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
    }
    return client;
  }

  /**
   * One raw API call.
   * @param {string} modelName
   * @param {LlmRequest} request
   * @param {ThinkingLevel} level
   */
  async function callOnce(modelName, { system, user, schema }, level) {
    const thinkingConfig = thinkingConfigFor(modelName, level);
    try {
      return await getClient().models.generateContent({
        model: modelName,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          // Google advises keeping Gemini 3+ at its default temperature.
          ...(isGemini3Plus(modelName) ? {} : { temperature: LEGACY_TEMPERATURE }),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      });
    } catch (error) {
      // Gemini reports an invalid key as HTTP 400; treat it as an auth failure
      // so the backup key is tried.
      const err = /** @type {import('../../../types').HttpLikeError} */ (error);
      if (err?.status === 400 && /API[_ ]KEY/i.test(err.message || '')) err.status = 401;
      throw error;
    }
  }

  /**
   * Calls a model with MINIMAL thinking, falling back to LOW if the model rejects it.
   * @param {string} modelName
   * @param {LlmRequest} request
   */
  async function callModel(modelName, request) {
    const level = needsLowThinking.has(modelName) ? 'LOW' : 'MINIMAL';
    try {
      return await callOnce(modelName, request, level);
    } catch (error) {
      const err = /** @type {import('../../../types').HttpLikeError} */ (error);
      const rejectedLevel = err?.status === 400 && /thinking/i.test(err.message || '');
      if (!rejectedLevel || level === 'LOW') throw error;
      needsLowThinking.add(modelName);
      return callOnce(modelName, request, 'LOW');
    }
  }

  /**
   * Calls one model, retrying once after a short pause if it is overloaded.
   * @param {string} modelName
   * @param {LlmRequest} request
   * @returns {Promise<{ response?: any, skip?: unknown }>} a response, or the error meaning "try the next model"
   */
  async function tryModel(modelName, request) {
    try {
      return { response: await callModel(modelName, request) };
    } catch (error) {
      if (shouldTryNextModel(error)) return { skip: error };
      if (!isOverloaded(error)) throw error;
    }
    await sleep(retryDelayMs);
    try {
      return { response: await callModel(modelName, request) };
    } catch (error) {
      if (shouldTryNextModel(error) || isOverloaded(error)) return { skip: error };
      throw error;
    }
  }

  /**
   * Walks the model chain until one answers.
   * @param {LlmRequest} request
   */
  async function callWithFallback(request) {
    let lastError;
    for (let i = active; i < chain.length; i += 1) {
      const { response, skip } = await tryModel(chain[i], request);
      if (response) return response;
      lastError = skip;
      // A retired/unavailable preferred model is skipped permanently (sticky).
      if (isModelUnavailable(skip) && i === active && active < chain.length - 1) active += 1;
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
      if (finishReason && !OK_FINISH_REASONS.has(finishReason)) {
        throw outputError(`Gemini stopped early: ${finishReason}`);
      }
      const text = response?.text;
      if (!text) throw outputError('Gemini returned no text');
      return text;
    },
  };
}

module.exports = { createGeminiProvider };
