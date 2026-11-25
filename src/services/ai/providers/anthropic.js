'use strict';

/**
 * Anthropic Claude adapter (official @anthropic-ai/sdk) with JSON-schema
 * output. Uses server-side model fallback when the account supports it, and
 * remembers if it doesn't.
 */

const { outputError } = require('../errors');

/** @typedef {import('../../../types').LlmRequest} LlmRequest */
/** @typedef {import('../../../types').LlmProvider} LlmProvider */

const MAX_OUTPUT_TOKENS = 2000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const INCOMPLETE_STOP_REASONS = new Set(['refusal', 'max_tokens']);

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {number} options.timeoutMs per-call timeout
 * @param {string} [options.label] provider name used in logs
 * @param {any} [options.sdk] injected Anthropic SDK module (tests)
 * @returns {LlmProvider}
 */
function createAnthropicProvider({ apiKey, model, timeoutMs, label = 'anthropic', sdk = undefined }) {
  /** @type {any} */
  let client;
  let fallbackSupported = true;

  /** Creates the Anthropic SDK client on first use (lazy, so unused SDKs never load). */
  function getClient() {
    if (!client) {
      const Anthropic = sdk || require('@anthropic-ai/sdk');
      const Ctor = Anthropic.default || Anthropic;
      client = new Ctor({ apiKey, timeout: timeoutMs, maxRetries: 1 });
    }
    return client;
  }

  /**
   * Sends the request, with server-side fallback unless the account rejected it.
   * @param {LlmRequest} request
   */
  async function create({ system, user, schema }) {
    const params = {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Narrating pre-computed facts is a light task: low effort = faster, cheaper.
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    };
    if (!fallbackSupported) return getClient().messages.create(params);
    try {
      return await getClient().beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' });
    } catch (error) {
      const err = /** @type {import('../../../types').HttpLikeError} */ (error);
      if (err?.status === 400 && /fallback|beta/i.test(err.message || '')) {
        fallbackSupported = false;
        return getClient().messages.create(params);
      }
      throw error;
    }
  }

  return {
    name: label,
    async generate(request) {
      const response = await create(request);
      if (INCOMPLETE_STOP_REASONS.has(response.stop_reason)) {
        throw outputError(`Claude stopped early: ${response.stop_reason}`);
      }
      return response.content
        .filter(/** @param {{ type: string }} block */ (block) => block.type === 'text')
        .map(/** @param {{ text: string }} block */ (block) => block.text)
        .join('');
    },
  };
}

module.exports = { createAnthropicProvider };
