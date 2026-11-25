'use strict';

/**
 * Shared JSDoc type definitions (type-checked by `npm run typecheck`).
 * Engine-specific types (Profile, Risk, Recommendation) live in
 * services/engine/shared.js.
 *
 * @typedef {{ error: (...args: any[]) => void, warn: (...args: any[]) => void }} Logger
 *
 * @typedef {object} Location
 * @property {string} name
 * @property {string} [region]
 * @property {string} [country]
 * @property {number} [latitude]
 * @property {number} [longitude]
 * @property {string} [timezone]
 *
 * @typedef {object} TimeWindow
 * @property {string} start ISO local time of the first hour
 * @property {string} end ISO local time of the last hour
 * @property {number} meanPm25
 *
 * @typedef {object} Forecast
 * @property {TimeWindow|null} cleanestWindow
 * @property {{ time: string, pm25: number }|null} worstHour
 * @property {number} hoursAnalysed
 *
 * @typedef {object} AirReading
 * @property {number} aqi US AQI
 * @property {Location} location
 * @property {Forecast|null} forecast
 * @property {string} source
 * @property {number|null} [pm25]
 * @property {number|null} [pm10]
 * @property {number|null} [no2]
 * @property {number|null} [ozone]
 * @property {string} [observedAt]
 *
 * @typedef {object} Narrative
 * @property {string} summary
 * @property {{ action: string, impact: string }[]} priorities
 * @property {string} answer
 *
 * @typedef {object} LlmRequest
 * @property {string} system system prompt
 * @property {string} user user message
 * @property {object} schema JSON schema the reply must match
 *
 * @typedef {object} LlmProvider
 * @property {string} name label used in logs, e.g. "gemini#1"
 * @property {string} [model] model currently in use
 * @property {(request: LlmRequest) => Promise<string>} generate resolves to JSON text
 *
 * @typedef {Error & { status?: number }} HttpLikeError error carrying an HTTP-like status
 */

module.exports = {};
