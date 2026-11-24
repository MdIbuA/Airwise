'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { createAirQualityService } = require('./services/airQuality');
const { createAssistant } = require('./services/assistant');
const { createProviders, DEFAULT_MODELS } = require('./services/llmProviders');

const app = createApp({
  airQuality: createAirQualityService({
    timeoutMs: config.httpTimeoutMs,
    geocodeTtlMs: config.geocodeTtlMs,
    airQualityTtlMs: config.airQualityTtlMs,
  }),
  assistant: createAssistant({
    enabled: config.llmEnabled,
    providers: createProviders({
      provider: config.llmProvider,
      apiKeys: config.apiKeys,
      model: config.llmModel,
      timeoutMs: config.llmTimeoutMs,
    }),
    ttlMs: config.planTtlMs,
    budgetMs: config.aiBudgetMs,
  }),
  rateLimitPerMinute: config.rateLimitPerMinute,
});

const server = app.listen(config.port, () => {
  console.log(`AirWise listening on http://localhost:${config.port} (AI: ${config.llmEnabled ? `${config.llmProvider} ${config.llmModel || DEFAULT_MODELS[config.llmProvider]}, ${config.apiKeys.length} key(s)` : 'off, rule-based'})`);
});

// Graceful shutdown for containers (Cloud Run / Docker send SIGTERM).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
