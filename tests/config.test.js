'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const KEYS = ['GEMINI_API_KEY', 'GEMINI_API_KEY_BACKUP', 'GOOGLE_API_KEY', 'GOOGLE_API_KEY_BACKUP', 'ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_BACKUP', 'AIRWISE_LLM_PROVIDER', 'AIRWISE_DISABLE_LLM'];

/** Loads a fresh copy of config.js under the given environment. */
function loadConfig(vars) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    delete require.cache[require.resolve('../src/config')];
    return require('../src/config');
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('no keys: rule-based mode', () => {
  const config = loadConfig({});
  assert.equal(config.llmEnabled, false);
  assert.deepEqual(config.apiKeys, []);
});

test('Google keys select Gemini with primary + backup order', () => {
  const config = loadConfig({ GOOGLE_API_KEY: 'g1', GOOGLE_API_KEY_BACKUP: 'g2', ANTHROPIC_API_KEY: 'a1' });
  assert.equal(config.llmProvider, 'gemini');
  assert.deepEqual(config.apiKeys, ['g1', 'g2']);
  assert.equal(config.llmEnabled, true);
});

test('only a Claude key selects Anthropic; explicit provider and disable flag win', () => {
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'a1' }).llmProvider, 'anthropic');
  const forced = loadConfig({ GEMINI_API_KEY: 'g1', ANTHROPIC_API_KEY: 'a1', AIRWISE_LLM_PROVIDER: 'anthropic' });
  assert.deepEqual(forced.apiKeys, ['a1']);
  assert.equal(loadConfig({ GEMINI_API_KEY: 'g1', AIRWISE_DISABLE_LLM: 'true' }).llmEnabled, false);
});
