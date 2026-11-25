'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

// Load .env (if present). Real environment variables always win over the file.
// Parsed with Node's built-in parser after stripping a UTF-8 BOM: Windows
// Notepad can prepend one, which would otherwise corrupt the first key's name.
/** Parses .env text (BOM-safe). Exported for tests. */
const parseEnvText = (text) => util.parseEnv(String(text).replace(/^\uFEFF/, ''));

const envFile = path.join(__dirname, '..', '.env');
const loadedFromFile = new Set();
if (process.env.NODE_ENV !== 'test' && fs.existsSync(envFile)) {
  for (const [key, value] of Object.entries(parseEnvText(fs.readFileSync(envFile, 'utf8')))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loadedFromFile.add(key);
    }
  }
}

/**
 * Central runtime configuration. Every value can be overridden through
 * environment variables so the same build runs locally, in CI and in the cloud.
 */
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const env = process.env;
const read = (name) => (env[name] || '').trim();
const keysByProvider = {
  gemini: [
    read('GEMINI_API_KEY') || read('GOOGLE_API_KEY'),
    read('GEMINI_API_KEY_BACKUP') || read('GOOGLE_API_KEY_BACKUP'),
  ].filter(Boolean),
  anthropic: [read('ANTHROPIC_API_KEY'), read('ANTHROPIC_API_KEY_BACKUP')].filter(Boolean),
};
/**
 * Explicit AIRWISE_LLM_PROVIDER wins. Otherwise Claude when an Anthropic key
 * is set (the provider verified in live testing), else Gemini.
 */
function pickProvider() {
  const requested = read('AIRWISE_LLM_PROVIDER').toLowerCase();
  if (Object.hasOwn(keysByProvider, requested)) return requested;
  if (keysByProvider.anthropic.length) return 'anthropic';
  return 'gemini';
}
const provider = pickProvider();

const config = Object.freeze({
  port: toInt(process.env.PORT, 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  // LLM: Claude if an Anthropic key is set, otherwise Gemini; override with
  // AIRWISE_LLM_PROVIDER. Each provider takes a primary + optional backup key.
  llmProvider: provider,
  apiKeys: keysByProvider[provider],
  llmEnabled: keysByProvider[provider].length > 0 && process.env.AIRWISE_DISABLE_LLM !== 'true',
  llmModel: read('AIRWISE_MODEL') || undefined,
  // For diagnostics (npm run check:ai): what was asked for, and where it came from.
  providerRequested: read('AIRWISE_LLM_PROVIDER'),
  providerSource:
    env.AIRWISE_LLM_PROVIDER === undefined
      ? 'not set'
      : loadedFromFile.has('AIRWISE_LLM_PROVIDER')
        ? '.env file'
        : 'system environment',
  envFileFound: fs.existsSync(envFile),
  keyCounts: { gemini: keysByProvider.gemini.length, anthropic: keysByProvider.anthropic.length },
  // Per-request timeout for one model call, and the total time the user waits
  // for AI before getting the rule-based briefing (AI then finishes in the background).
  llmTimeoutMs: toInt(process.env.AIRWISE_LLM_TIMEOUT_MS, 10000),
  aiBudgetMs: toInt(process.env.AIRWISE_AI_BUDGET_MS, 12000),
  httpTimeoutMs: toInt(process.env.AIRWISE_HTTP_TIMEOUT_MS, 6000),
  airQualityTtlMs: toInt(process.env.AIRWISE_AQ_TTL_MS, 15 * 60 * 1000),
  geocodeTtlMs: toInt(process.env.AIRWISE_GEO_TTL_MS, 24 * 60 * 60 * 1000),
  planTtlMs: toInt(process.env.AIRWISE_PLAN_TTL_MS, 15 * 60 * 1000),
  rateLimitPerMinute: toInt(process.env.AIRWISE_RATE_LIMIT, 30),
});

module.exports = Object.freeze({ ...config, parseEnvText });
