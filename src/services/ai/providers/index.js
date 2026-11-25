'use strict';

/**
 * LLM provider registry. Every adapter exposes the same tiny interface
 * ({ name, generate(request) → JSON text }), so the assistant can fail over
 * between keys, and even vendors, without knowing SDK details. SDKs load lazily,
 * so a deployment only loads the one it uses.
 */

const { createGeminiProvider } = require('./gemini');
const { createAnthropicProvider } = require('./anthropic');

/** @typedef {import('../../../types').LlmProvider} LlmProvider */
/** @typedef {'anthropic'|'gemini'} ProviderName */

const DEFAULT_MODELS = Object.freeze({ gemini: 'gemini-3.8-flash', anthropic: 'claude-opus-5-5' });

/**
 * Gemini models tried in order if the chosen one is unavailable or busy: newest
 * stable Flash first, then lighter models, then Google's rolling aliases.
 * Models a key can't use return 404 and are skipped automatically.
 */
const GEMINI_FALLBACK_MODELS = Object.freeze([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
]);

/**
 * Builds one provider per API key (primary first, then backup).
 * @param {object} options
 * @param {string} options.provider 'anthropic' or 'gemini'
 * @param {string[]} options.apiKeys
 * @param {string} [options.model] overrides the provider's default model
 * @param {number} options.timeoutMs per-call timeout
 * @returns {LlmProvider[]}
 * @throws {Error} for an unknown provider name
 */
function createProviders({ provider, apiKeys, model, timeoutMs }) {
  if (provider !== 'anthropic' && provider !== 'gemini') throw new Error(`Unknown LLM provider: ${provider}`);
  const chosenModel = model || DEFAULT_MODELS[provider];
  return apiKeys.map((apiKey, i) => {
    const label = `${provider}#${i + 1}`;
    return provider === 'gemini'
      ? createGeminiProvider({ apiKey, model: chosenModel, models: GEMINI_FALLBACK_MODELS, timeoutMs, label })
      : createAnthropicProvider({ apiKey, model: chosenModel, timeoutMs, label });
  });
}

module.exports = {
  createProviders,
  createGeminiProvider,
  createAnthropicProvider,
  DEFAULT_MODELS,
  GEMINI_FALLBACK_MODELS,
};
