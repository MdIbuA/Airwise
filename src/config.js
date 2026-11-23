'use strict';

/**
 * Central runtime configuration. Every value can be overridden through
 * environment variables so the same build runs locally, in CI and in the cloud.
 */
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const config = Object.freeze({
  port: toInt(process.env.PORT, 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  // Primary key plus an optional backup key used for automatic failover.
  // Without any key the app degrades gracefully to the rule-based narrative.
  apiKeys: [process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY_BACKUP].filter(Boolean),
  llmEnabled:
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY_BACKUP) &&
    process.env.AIRWISE_DISABLE_LLM !== 'true',
  llmModel: process.env.AIRWISE_MODEL || 'claude-opus-5-5',
  llmTimeoutMs: toInt(process.env.AIRWISE_LLM_TIMEOUT_MS, 30000),
  httpTimeoutMs: toInt(process.env.AIRWISE_HTTP_TIMEOUT_MS, 6000),
  airQualityTtlMs: toInt(process.env.AIRWISE_AQ_TTL_MS, 15 * 60 * 1000),
  geocodeTtlMs: toInt(process.env.AIRWISE_GEO_TTL_MS, 24 * 60 * 60 * 1000),
  planTtlMs: toInt(process.env.AIRWISE_PLAN_TTL_MS, 15 * 60 * 1000),
  rateLimitPerMinute: toInt(process.env.AIRWISE_RATE_LIMIT, 30),
});

module.exports = config;
