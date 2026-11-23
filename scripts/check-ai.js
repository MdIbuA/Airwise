'use strict';

/**
 * AI connectivity check:  npm run check:ai
 *
 * Loads the same config as the server (.env + environment), then sends one
 * tiny request per configured key and explains the result in plain language.
 * Keys are never printed — only their count and length.
 */
const config = require('../src/config');
const { createProviders, DEFAULT_MODELS } = require('../src/services/llmProviders');
const { describeError } = require('../src/services/assistant');

const HINTS = {
  401: 'Key rejected. Re-copy it from aistudio.google.com/apikey (no quotes/spaces), or create a new one.',
  403: 'Key lacks permission. Enable the "Generative Language API" for the key\'s Google Cloud project, or remove API restrictions on the key.',
  404: 'None of the models tried is available to this key. Set AIRWISE_MODEL in .env to a model named in the message above (e.g. the one Google recommends).',
  429: 'Quota or rate limit reached on this key. Wait, or use the backup key / a billing-enabled project.',
  500: 'Google had a temporary server error. Try again in a few minutes.',
  503: 'Google\'s servers for every model tried are overloaded right now (temporary). Try again in a few minutes; the app retries and switches models automatically.',
  network: 'Could not reach the API. Check your internet connection, VPN or firewall.',
};

/** Prints the Gemini text models this key can use (helps pick AIRWISE_MODEL). */
async function listGeminiModels(apiKey) {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      .filter((n) => /^gemini/.test(n) && !/(tts|image|audio|live|embedding)/.test(n));
    if (names.length) console.log(`\nText models your key can use: ${names.join(', ')}`);
  } catch {
    /* listing is best-effort */
  }
}

async function main() {
  const model = config.llmModel || DEFAULT_MODELS[config.llmProvider];
  console.log(`Provider: ${config.llmProvider}   Model: ${model}`);
  if (!config.apiKeys.length) {
    console.log('\n✖ No API key found, so AI is OFF (rule-based mode).');
    console.log('  Fix: create a .env file in the project folder containing:');
    console.log('       GEMINI_API_KEY=your-key');
    console.log('       GEMINI_API_KEY_BACKUP=your-backup-key   (optional)');
    console.log('  On Render: Dashboard → your service → Environment → add the same variables.');
    process.exitCode = 1;
    return;
  }
  if (process.env.AIRWISE_DISABLE_LLM === 'true') console.log('⚠ AIRWISE_DISABLE_LLM=true is set — the server will not use AI.');

  const providers = createProviders({ provider: config.llmProvider, apiKeys: config.apiKeys, model, timeoutMs: 20000 });
  const schema = { type: 'object', properties: { ok: { type: 'string' } }, required: ['ok'], additionalProperties: false };
  let working = 0;
  for (const [i, provider] of providers.entries()) {
    const label = i === 0 ? 'Primary key' : 'Backup key ';
    const len = config.apiKeys[i].length;
    const suspicious = /^["'\s]|["'\s]$/.test(config.apiKeys[i]) ? ' (⚠ has quotes/spaces at the ends!)' : '';
    try {
      const text = await provider.generate({ system: 'Reply with JSON only.', user: 'Return {"ok":"yes"}', schema });
      JSON.parse(text);
      working += 1;
      console.log(`✔ ${label} (${len} chars) works with model ${provider.model || model}.`);
    } catch (error) {
      const status = error?.status ?? 'network';
      console.log(`✖ ${label} (${len} chars)${suspicious} failed: ${describeError(error)}`);
      console.log(`  → ${HINTS[status] || 'See the message above.'}`);
    }
  }
  if (config.llmProvider === 'gemini') await listGeminiModels(config.apiKeys[0]);
  console.log(working ? `\nAI is ready (${working}/${providers.length} key(s) working). Restart the server if it is running.` : '\nNo key works, so the app will use rule-based briefings.');
  if (!working) process.exitCode = 1;
}

main();
