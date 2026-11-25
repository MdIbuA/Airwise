'use strict';

/**
 * Error classification for AI calls. Provider SDK errors carry an HTTP-like
 * `status`; these helpers decide whether to try another model, another key,
 * or fall back to the rule-based briefing.
 */

/** @typedef {import('../../types').HttpLikeError} HttpLikeError */

/** Statuses for which the backup key may succeed where the primary failed. */
const KEY_FAILOVER_STATUSES = new Set([401, 402, 403, 429]);
/** Temporary server-side trouble: retrying or switching model can help. */
const TRANSIENT_STATUSES = new Set([500, 503, 504]);
/** Max length of a provider message written to the logs. */
const MAX_LOGGED_MESSAGE = 180;

/**
 * @param {unknown} error
 * @returns {number|undefined}
 */
const statusOf = (error) => /** @type {HttpLikeError|undefined} */ (error)?.status;

/**
 * Refusal / empty output. Status 422 so it is NOT retried with the backup key:
 * the same request would be declined again.
 * @param {string} message
 * @returns {HttpLikeError}
 */
function outputError(message) {
  return Object.assign(new Error(message), { name: 'OutputError', status: 422 });
}

/**
 * Worth retrying with the backup key? Bad/revoked key (401/403), billing (402),
 * quota (429), server errors (5xx) and network failures (no status) are; a 400
 * would fail identically, so it is not.
 * @param {unknown} error
 * @returns {boolean}
 */
function shouldFailover(error) {
  const status = statusOf(error);
  return status === undefined || KEY_FAILOVER_STATUSES.has(status) || status >= 500;
}

/** @param {unknown} error true when the model is retired / not enabled for this key */
const isModelUnavailable = (error) => statusOf(error) === 404;

/** @param {unknown} error true for transient server errors (retry or switch model) */
const isOverloaded = (error) => TRANSIENT_STATUSES.has(Number(statusOf(error)));

/** @param {unknown} error true for quota / rate limits (counted per model on Gemini) */
const isQuotaExceeded = (error) => statusOf(error) === 429;

/**
 * Short, log-safe description of an error: status plus the first line of the
 * provider's message, with anything that looks like an API key masked.
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  const err = /** @type {HttpLikeError|undefined} */ (error);
  const raw = String(err?.message || err?.name || 'unknown error');
  let message = raw;
  try {
    // Provider SDKs often embed a JSON body; prefer its human-readable message.
    message = JSON.parse(raw.slice(raw.indexOf('{')))?.error?.message || raw;
  } catch {
    /* not JSON */
  }
  const safe = message
    .split('\n')[0]
    .replace(/AIza[\w-]{10,}/g, 'AIza…')
    .replace(/sk-ant-[\w-]+/g, 'sk-ant-…')
    .slice(0, MAX_LOGGED_MESSAGE);
  return `${err?.status ?? 'network'} ${safe}`;
}

module.exports = { outputError, shouldFailover, isModelUnavailable, isOverloaded, isQuotaExceeded, describeError };
