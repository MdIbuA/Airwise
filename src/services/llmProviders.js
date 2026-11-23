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

/** Refusal / empty output: 422 so it is NOT retried with the backup key. */
function outputError(message) {
  return Object.assign(new Error(message), { name: 'OutputError', status: 422 });
}

/**
 * Google Gemini via the official @google/genai SDK, with JSON-schema
 * constrained output.
 */
function createGeminiProvider({ apiKey, model, timeoutMs, label = 'gemini', sdk }) {
  let client;
  const getClient = () => {
    if (!client) {
      const { GoogleGenAI } = sdk || require('@google/genai');
      client = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
    }
    return client;
  };

  return {
    name: label,
    async generate({ system, user, schema }) {
      let response;
      try {
        response = await getClient().models.generateContent({
          model,
          contents: user,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            temperature: 0.4,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // 2.5 Flash "thinks" by default and thinking tokens count against
            // maxOutputTokens. Narrating pre-computed facts needs none, so turn
            // it off: faster, cheaper, and no truncated JSON.
            ...(/2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        });
      } catch (error) {
        // Gemini reports an invalid key as HTTP 400; treat it as an auth failure
        // so the backup key is tried.
        if (error?.status === 400 && /API[_ ]KEY/i.test(error.message || '')) error.status = 401;
        throw error;
      }
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

const DEFAULT_MODELS = Object.freeze({ gemini: 'gemini-2.5-flash', anthropic: 'claude-opus-5-5' });
const FACTORIES = Object.freeze({ gemini: createGeminiProvider, anthropic: createAnthropicProvider });

/**
 * Builds one provider per API key (primary first, then backup).
 * @param {{ provider: 'gemini'|'anthropic', apiKeys: string[], model?: string, timeoutMs: number }} options
 */
function createProviders({ provider, apiKeys, model, timeoutMs }) {
  const factory = FACTORIES[provider];
  if (!factory) throw new Error(`Unknown LLM provider: ${provider}`);
  return apiKeys.map((apiKey, i) =>
    factory({ apiKey, model: model || DEFAULT_MODELS[provider], timeoutMs, label: `${provider}#${i + 1}` }),
  );
}

module.exports = { createProviders, createGeminiProvider, createAnthropicProvider, DEFAULT_MODELS };
