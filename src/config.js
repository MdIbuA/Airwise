'use strict';

/**
 * Central runtime configuration. Every value can be overridden through
 * environment variables (or a local `.env` file), so the same build runs
 * locally, in CI and in the cloud.
 */

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

/** @typedef {'anthropic'|'gemini'} ProviderName */

const ENV_FILE = path.join(__dirname, '..', '.env');

/** Defaults used when a variable is unset or invalid. */
const DEFAULTS = Object.freeze({
  port: 8080,
  llmTimeoutMs: 10_000, // one model call
  aiBudgetMs: 12_000, // total wait for the AI briefing before the rule-based one is kept
  httpTimeoutMs: 6_000, // air-quality / geocoding requests
  airQualityTtlMs: 15 * 60 * 1000,
  geocodeTtlMs: 24 * 60 * 60 * 1000,
  planTtlMs: 15 * 60 * 1000, // AI narrative cache
  rateLimitPerMinute: 30,
});

/**
 * Parses .env text with Node's built-in parser after stripping a UTF-8 BOM
 * (Windows Notepad can prepend one, which would corrupt the first key's name).
 * @param {string} text
 * @returns {NodeJS.Dict<string>}
 */
const parseEnvText = (text) => util.parseEnv(String(text).replace(/^\uFEFF/, ''));

/**
 * Copies `.env` values into process.env without overriding real environment
 * variables. Skipped under NODE_ENV=test so a developer's file can't leak into tests.
 * @returns {Set<string>} keys that came from the file
 */
function loadEnvFile() {
  const loaded = new Set();
  if (process.env.NODE_ENV === 'test' || !fs.existsSync(ENV_FILE)) return loaded;
  for (const [key, value] of Object.entries(parseEnvText(fs.readFileSync(ENV_FILE, 'utf8')))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.add(key);
    }
  }
  return loaded;
}

const loadedFromFile = loadEnvFile();

/**
 * @param {string} name environment variable name
 * @returns {string} trimmed value, or '' when unset
 */
const read = (name) => (process.env[name] || '').trim();

/**
 * @param {string} name environment variable name
 * @param {number} fallback used when the value is missing, not a number or not positive
 * @returns {number}
 */
function readPositiveInt(name, fallback) {
  const parsed = Number.parseInt(read(name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** @type {Record<ProviderName, string[]>} primary key first, then the optional backup */
const keysByProvider = {
  anthropic: [read('ANTHROPIC_API_KEY'), read('ANTHROPIC_API_KEY_BACKUP')].filter(Boolean),
  gemini: [
    read('GEMINI_API_KEY') || read('GOOGLE_API_KEY'),
    read('GEMINI_API_KEY_BACKUP') || read('GOOGLE_API_KEY_BACKUP'),
  ].filter(Boolean),
};

/**
 * Explicit AIRWISE_LLM_PROVIDER wins. Otherwise Claude when an Anthropic key
 * is set (the provider verified in live testing), else Gemini.
 * @returns {ProviderName}
 */
function pickProvider() {
  const requested = read('AIRWISE_LLM_PROVIDER').toLowerCase();
  if (requested === 'anthropic' || requested === 'gemini') return requested;
  return keysByProvider.anthropic.length ? 'anthropic' : 'gemini';
}

/** Where AIRWISE_LLM_PROVIDER came from (shown by `npm run check:ai`). */
function providerSource() {
  if (process.env.AIRWISE_LLM_PROVIDER === undefined) return 'not set';
  return loadedFromFile.has('AIRWISE_LLM_PROVIDER') ? '.env file' : 'system environment';
}

const llmProvider = pickProvider();

const config = Object.freeze({
  port: readPositiveInt('PORT', DEFAULTS.port),
  nodeEnv: read('NODE_ENV') || 'development',

  // Generative AI
  llmProvider,
  apiKeys: keysByProvider[llmProvider],
  llmEnabled: keysByProvider[llmProvider].length > 0 && read('AIRWISE_DISABLE_LLM') !== 'true',
  llmModel: read('AIRWISE_MODEL') || undefined,
  llmTimeoutMs: readPositiveInt('AIRWISE_LLM_TIMEOUT_MS', DEFAULTS.llmTimeoutMs),
  aiBudgetMs: readPositiveInt('AIRWISE_AI_BUDGET_MS', DEFAULTS.aiBudgetMs),

  // Diagnostics for `npm run check:ai`
  providerRequested: read('AIRWISE_LLM_PROVIDER'),
  providerSource: providerSource(),
  envFileFound: fs.existsSync(ENV_FILE),
  keyCounts: { gemini: keysByProvider.gemini.length, anthropic: keysByProvider.anthropic.length },

  // Air quality, caching and limits
  httpTimeoutMs: readPositiveInt('AIRWISE_HTTP_TIMEOUT_MS', DEFAULTS.httpTimeoutMs),
  airQualityTtlMs: readPositiveInt('AIRWISE_AQ_TTL_MS', DEFAULTS.airQualityTtlMs),
  geocodeTtlMs: readPositiveInt('AIRWISE_GEO_TTL_MS', DEFAULTS.geocodeTtlMs),
  planTtlMs: readPositiveInt('AIRWISE_PLAN_TTL_MS', DEFAULTS.planTtlMs),
  rateLimitPerMinute: readPositiveInt('AIRWISE_RATE_LIMIT', DEFAULTS.rateLimitPerMinute),
});

module.exports = Object.freeze({ ...config, parseEnvText });
