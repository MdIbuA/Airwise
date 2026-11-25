'use strict';

/**
 * GenAI layer. An LLM (Claude by default, or Gemini) turns the rule engine's
 * structured plan into a short, empathetic briefing and answers the user's
 * question. It is grounded (the prompt holds only engine facts), time-boxed,
 * cached, and fails over from the primary to the backup key. If every option
 * fails, the rule-based briefing is returned, so it never breaks the app.
 */

const crypto = require('node:crypto');
const { TtlCache } = require('../../utils/cache');
const {
  SYSTEM_PROMPT,
  OUTPUT_SCHEMA,
  MAX_PRIORITIES,
  buildPromptPayload,
  buildUserMessage,
  isValidNarrative,
} = require('./prompt');
const { templateNarrative } = require('./fallbackNarrative');
const { shouldFailover, describeError } = require('./errors');

/** @typedef {import('./prompt').Plan} Plan */
/** @typedef {import('../engine/shared').Profile} Profile */
/** @typedef {import('../../types').AirReading} AirReading */
/** @typedef {import('../../types').Narrative} Narrative */
/** @typedef {import('../../types').LlmProvider} LlmProvider */
/** @typedef {import('../../types').LlmRequest} LlmRequest */
/** @typedef {Narrative & { source: 'ai'|'rules', reason?: 'disabled'|'timeout'|'error' }} NarrativeResult */

const TIMED_OUT = Symbol('timed-out');
const CACHE_ENTRIES = 300;
const DEFAULTS = Object.freeze({ ttlMs: 15 * 60 * 1000, budgetMs: 12_000 });

/**
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {LlmProvider[]} [options.providers] tried in order (primary key, then backup)
 * @param {number} [options.ttlMs] how long AI narratives are cached
 * @param {number} [options.budgetMs] max total wait before serving the rule-based briefing
 * @param {import('../../types').Logger} [options.logger]
 */
function createAssistant({
  enabled,
  providers = [],
  ttlMs = DEFAULTS.ttlMs,
  budgetMs = DEFAULTS.budgetMs,
  logger = console,
}) {
  const cache = new TtlCache({ ttlMs, maxEntries: CACHE_ENTRIES });
  const active = enabled && providers.length > 0;

  /**
   * Tries each provider in order, moving on only for retryable errors.
   * Logs the provider label and status only, never keys or prompts.
   * @param {LlmRequest} request
   * @returns {Promise<string>}
   */
  async function generateWithFailover(request) {
    let lastError;
    for (const [i, provider] of providers.entries()) {
      try {
        return await provider.generate(request);
      } catch (error) {
        lastError = error;
        if (!shouldFailover(error) || i === providers.length - 1) break;
        logger.warn(`[assistant] ${provider.name} failed (${describeError(error)}), trying backup key`);
      }
    }
    throw lastError;
  }

  /**
   * Asks the model for a briefing and validates the reply.
   * @param {object} payload from buildPromptPayload
   * @param {string} question
   * @returns {Promise<Narrative>}
   */
  async function callModel(payload, question) {
    const user = buildUserMessage(payload, question);
    const parsed = JSON.parse(await generateWithFailover({ system: SYSTEM_PROMPT, user, schema: OUTPUT_SCHEMA }));
    if (!isValidNarrative(parsed)) throw new Error('Model output failed schema check');
    return { ...parsed, priorities: parsed.priorities.slice(0, MAX_PRIORITIES) };
  }

  /**
   * Resolves to TIMED_OUT after `budgetMs`; `cancel` clears the timer.
   * @returns {{ promise: Promise<typeof TIMED_OUT>, cancel: () => void }}
   */
  function budgetTimer() {
    /** @type {NodeJS.Timeout|undefined} */
    let timer;
    const promise = new Promise((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
    });
    return { promise, cancel: () => clearTimeout(timer) };
  }

  /**
   * Produces the narrative for a plan. Always resolves (never throws).
   *
   * The AI gets at most `budgetMs` in total (across retries, models and keys).
   * If it runs over, the rule-based briefing is returned immediately while the
   * AI call keeps running in the background; its result lands in the cache, so
   * the user's next request for the same plan is instant.
   *
   * @param {Plan} plan
   * @param {Profile} profile
   * @param {AirReading} air
   * @returns {Promise<NarrativeResult>}
   */
  async function narrate(plan, profile, air) {
    /** @param {'disabled'|'timeout'|'error'} reason */
    const rules = (reason) => ({ ...templateNarrative(plan, profile), source: /** @type {const} */ ('rules'), reason });
    if (!active) return rules('disabled');

    const payload = buildPromptPayload(plan, profile, air);
    const key = crypto
      .createHash('sha256')
      .update(JSON.stringify([payload, profile.question]))
      .digest('hex');
    const pending = cache.wrap(key, () => callModel(payload, profile.question));
    pending.catch(() => {}); // if we stop waiting, a later rejection must not go unhandled

    const budget = budgetTimer();
    try {
      const result = await Promise.race([pending, budget.promise]);
      if (result === TIMED_OUT) {
        logger.warn(
          `[assistant] AI took longer than ${budgetMs} ms; serving rule-based briefing (AI result will be cached)`,
        );
        return rules('timeout');
      }
      return { ...result, source: 'ai' };
    } catch (error) {
      logger.warn(`[assistant] AI unavailable, using rule-based briefing: ${describeError(error)}`);
      return rules('error');
    } finally {
      budget.cancel();
    }
  }

  return { narrate, isActive: active };
}

module.exports = { createAssistant };
