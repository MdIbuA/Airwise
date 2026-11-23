'use strict';

/**
 * Central runtime configuration. Every value can be overridden through
 * environment variables so the same build runs locally, in CI and in the cloud.
 */
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const env = process.env;
const keysByProvider = {
  gemini: [env.GEMINI_API_KEY || env.GOOGLE_API_KEY, env.GEMINI_API_KEY_BACKUP || env.GOOGLE_API_KEY_BACKUP].filter(Boolean),
  anthropic: [env.ANTHROPIC_API_KEY, env.ANTHROPIC_API_KEY_BACKUP].filter(Boolean),
};
/** Explicit AIRWISE_LLM_PROVIDER wins; otherwise Gemini unless only a Claude key exists. */
function pickProvider() {
  const requested = (env.AIRWISE_LLM_PROVIDER || '').toLowerCase();
  if (Object.hasOwn(keysByProvider, requested)) return requested;
  if (!keysByProvider.gemini.length && keysByProvider.anthropic.length) return 'anthropic';
  return 'gemini';
}
const provider = pickProvider();

const config = Object.freeze({
  port: toInt(process.env.PORT, 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  // LLM: Gemini if a Google key is set, otherwise Claude; override with
  // AIRWISE_LLM_PROVIDER. Each provider takes a primary + optional backup key.
  llmProvider: provider,
  apiKeys: keysByProvider[provider],
  llmEnabled: keysByProvider[provider].length > 0 && process.env.AIRWISE_DISABLE_LLM !== 'true',
  llmModel: process.env.AIRWISE_MODEL || undefined,
  llmTimeoutMs: toInt(process.env.AIRWISE_LLM_TIMEOUT_MS, 30000),
  httpTimeoutMs: toInt(process.env.AIRWISE_HTTP_TIMEOUT_MS, 6000),
  airQualityTtlMs: toInt(process.env.AIRWISE_AQ_TTL_MS, 15 * 60 * 1000),
  geocodeTtlMs: toInt(process.env.AIRWISE_GEO_TTL_MS, 24 * 60 * 60 * 1000),
  planTtlMs: toInt(process.env.AIRWISE_PLAN_TTL_MS, 15 * 60 * 1000),
  rateLimitPerMinute: toInt(process.env.AIRWISE_RATE_LIMIT, 30),
});

module.exports = config;
