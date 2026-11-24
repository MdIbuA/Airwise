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

const KEY_SITE = { gemini: 'aistudio.google.com/apikey', anthropic: 'platform.claude.com (API keys)' };
const HINTS = {
  401: `Key rejected. Re-copy it from ${KEY_SITE[config.llmProvider]} (no quotes/spaces), or create a new one.`,
  403:
    config.llmProvider === 'gemini'
      ? 'Key lacks permission. Enable the "Generative Language API" for the key\'s Google Cloud project, or remove API restrictions on the key.'
      : 'Key lacks permission for this model or workspace. Check the key\'s workspace and model access in the Claude Console.',
  402: 'Billing problem: add credits or a payment method to the account that owns this key.',
  404: 'None of the models tried is available to this key. Set AIRWISE_MODEL in .env to a model named in the message above (e.g. the one Google recommends).',
  429: 'Quota or rate limit reached on this key. Wait, or use the backup key / a billing-enabled project.',
  500: 'Google had a temporary server error. Try again in a few minutes.',
  504: 'Google timed out (temporary, on Google\'s side). The app retries and switches models automatically; your other key/model will be used meanwhile.',
  529: 'Claude is temporarily overloaded. Try again in a minute; the app falls back to your backup key and then to rule-based briefings.',
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
    if (names.length) console.log(`Text models your key can use: ${names.join(', ')}`);
  } catch {
    /* listing is best-effort */
  }
}

async function main() {
  const model = config.llmModel || DEFAULT_MODELS[config.llmProvider];
  console.log(`Provider: ${config.llmProvider}   Model: ${model}`);
  if (!config.apiKeys.length) {
    console.log('\n✖ No API key found, so AI is OFF (rule-based mode).');
    console.log('  Fix: create a .env file in the project folder containing either:');
    console.log('       GEMINI_API_KEY=your-key            (Google Gemini)');
    console.log('    or ANTHROPIC_API_KEY=your-key         (Claude; add AIRWISE_LLM_PROVIDER=anthropic');
    console.log('                                           if a Gemini key is also set)');
    console.log('  On Render: Dashboard → your service → Environment → add the same variables.');
    process.exitCode = 1;
    return;
  }
  if (process.env.AIRWISE_DISABLE_LLM === 'true') console.log('⚠ AIRWISE_DISABLE_LLM=true is set — the server will not use AI.');

  if (config.llmProvider === 'gemini') await listGeminiModels(config.apiKeys[0]);
  console.log('\nTesting each key (this can take up to ~30 s if models are busy)...');
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
  console.log('\n==================== RESULT ====================');
  console.log(
    working
      ? `✔ AI IS WORKING (${working}/${providers.length} key(s)). Restart "npm start" if it is running.`
      : '✖ AI IS NOT WORKING: the app will use rule-based briefings. See the ✖ lines above.',
  );
  console.log('================================================');
  if (!working) process.exitCode = 1;
}

main();
