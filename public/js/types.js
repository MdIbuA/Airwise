/**
 * JSDoc types for the JSON the front end receives from the API
 * (mirrors src/types.js and src/services/engine/shared.js).
 *
 * @typedef {{ start: string, end: string, meanPm25: number }} TimeWindow
 * @typedef {{ cleanestWindow: TimeWindow|null, worstHour: { time: string, pm25: number }|null }} Forecast
 * @typedef {{ name?: string, region?: string, country?: string }} Location
 * @typedef {object} AirReading
 * @property {number} aqi
 * @property {number|null} [pm25]
 * @property {Location} [location]
 * @property {Forecast|null} forecast
 * @property {string} [source]
 *
 * @typedef {object} Risk
 * @property {number} aqi
 * @property {string} category
 * @property {number} level 0–5 AQI band
 * @property {number} personalRiskScore 0–100
 * @property {string} headline
 *
 * @typedef {object} Impact
 * @property {[number, number]|null} [exposureReductionPct]
 * @property {number} [co2KgPerWeek]
 * @property {number} [pm25GramsPerWeek]
 * @property {string} explanation
 *
 * @typedef {object} Recommendation
 * @property {string} id
 * @property {string} title
 * @property {string} detail
 * @property {'high'|'medium'|'low'} priority
 * @property {Impact} impact
 * @typedef {{ slot: string, actions: string[] }} RoutineSlot
 * @typedef {{ co2KgPerWeek: number, co2KgPerYear: number, treeEquivalent: number }} ImpactSummary
 *
 * @typedef {object} Narrative
 * @property {string} summary
 * @property {{ action: string, impact: string }[]} priorities
 * @property {string} answer
 * @property {'ai'|'rules'} source
 * @property {'disabled'|'timeout'|'error'} [reason]
 *
 * @typedef {object} PlanResponse
 * @property {AirReading} air
 * @property {Risk} risk
 * @property {RoutineSlot[]} routine
 * @property {Recommendation[]} indoorHacks
 * @property {Recommendation[]} alternatives
 * @property {ImpactSummary} impactSummary
 * @property {Narrative} narrative
 * @property {boolean} aiAvailable
 * @property {string} communityAlert
 */

export {};
