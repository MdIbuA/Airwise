'use strict';

/**
 * Input validation. Everything from the client is allow-listed: enum values
 * must match exactly, numbers must be in range, text is cleaned and length
 * capped, and unknown fields are dropped, so nothing unexpected reaches the
 * rule engine or the LLM prompt.
 */

const { AppError } = require('./errors');

/** @typedef {import('../services/engine/shared').Profile} Profile */
/** @typedef {keyof typeof ENUMS} EnumField */
/** @typedef {readonly [number, number]} Range inclusive [min, max] */

/** Allowed enum values. Anything else is rejected rather than coerced. */
const ENUMS = Object.freeze({
  commuteMode: ['car_petrol', 'car_diesel', 'two_wheeler', 'public_transport', 'walk_cycle', 'work_from_home'],
  heating: ['wood_coal', 'kerosene', 'gas', 'electric', 'heat_pump', 'none'],
  cooking: ['biomass', 'kerosene', 'lpg_png', 'electric'],
  outdoorActivity: ['low', 'moderate', 'high'],
});

const LIMITS = Object.freeze({
  cityMaxLength: 80,
  questionMaxLength: 500,
  /** @type {Range} */ householdSize: [1, 20],
  /** @type {Range} */ commuteKm: [0, 200],
  /** @type {Range} */ aqi: [0, 500],
});

/** Defaults applied when an optional field is omitted. */
const DEFAULTS = Object.freeze({
  commuteMode: 'public_transport',
  heating: 'none',
  cooking: 'lpg_png',
  outdoorActivity: 'moderate',
});

// Letters (any script), spaces and common punctuation found in place names.
const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s.,'-]*$/u;

/**
 * Strips control characters and collapses whitespace.
 * @param {unknown} value
 * @returns {string}
 */
function cleanText(value) {
  return (
    String(value)
      // eslint-disable-next-line no-control-regex -- stripping control chars is the intent
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Accepts JSON booleans and HTML-checkbox style values ("on", "true", 1).
 * @param {unknown} value
 * @returns {boolean}
 */
function toBool(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

/** @param {unknown} value */
const isBlank = (value) => value === undefined || value === null || value === '';

/**
 * Parses a number within an inclusive range; records an error otherwise.
 * @param {unknown} value raw input
 * @param {Range} range [min, max] inclusive
 * @param {string} field name used in error messages
 * @param {string[]} errors collected validation errors
 * @returns {number} the parsed value, or `min` when blank/invalid
 */
function toNumberInRange(value, [min, max], field, errors) {
  if (isBlank(value)) return min;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    errors.push(`${field} must be a number between ${min} and ${max}.`);
    return min;
  }
  return num;
}

/**
 * Accepts only an allow-listed enum value; records an error otherwise.
 * @param {unknown} value raw input
 * @param {EnumField} field
 * @param {string[]} errors collected validation errors
 * @returns {string} the value, or the field's default when blank/invalid
 */
function pickEnum(value, field, errors) {
  if (isBlank(value)) return DEFAULTS[field];
  const allowed = /** @type {readonly string[]} */ (ENUMS[field]);
  if (typeof value !== 'string' || !allowed.includes(value)) {
    errors.push(`${field} must be one of: ${allowed.join(', ')}.`);
    return DEFAULTS[field];
  }
  return value;
}

/**
 * Validates a city name for the geocoder.
 * @param {unknown} raw
 * @returns {string} the cleaned city name
 * @throws {AppError} when missing, too long or containing unsupported characters
 */
function validateCity(raw) {
  const city = cleanText(raw ?? '');
  if (!city) throw new AppError('Please provide a city or town name.');
  if (city.length > LIMITS.cityMaxLength || !CITY_PATTERN.test(city)) {
    throw new AppError('City name contains unsupported characters or is too long.');
  }
  return city;
}

/**
 * Validates and normalises the household profile sent by the client.
 * All problems are collected and reported together.
 * @param {unknown} body parsed JSON request body
 * @returns {Profile}
 * @throws {AppError} 400 with `details` listing every invalid field
 */
function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be a JSON object.');
  }
  const input = /** @type {Record<string, unknown>} */ (body);
  /** @type {string[]} */
  const errors = [];

  let city = '';
  try {
    city = validateCity(input.city);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid city.');
  }

  const question = input.question ? cleanText(input.question) : '';
  if (question.length > LIMITS.questionMaxLength) {
    errors.push(`question must be at most ${LIMITS.questionMaxLength} characters.`);
  }

  // Evaluated in field order so error messages are listed in form order.
  const householdSize = Math.round(toNumberInRange(input.householdSize, LIMITS.householdSize, 'householdSize', errors));
  const commuteMode = pickEnum(input.commuteMode, 'commuteMode', errors);
  const commuteKm = toNumberInRange(input.commuteKm, LIMITS.commuteKm, 'commuteKm', errors);

  /** @type {Profile} */
  const profile = {
    city,
    householdSize,
    hasChildren: toBool(input.hasChildren),
    hasElderly: toBool(input.hasElderly),
    hasRespiratoryCondition: toBool(input.hasRespiratoryCondition),
    isPregnant: toBool(input.isPregnant),
    commuteMode,
    commuteKm: commuteMode === 'work_from_home' ? 0 : commuteKm,
    heating: pickEnum(input.heating, 'heating', errors),
    cooking: pickEnum(input.cooking, 'cooking', errors),
    hasAirPurifier: toBool(input.hasAirPurifier),
    outdoorActivity: pickEnum(input.outdoorActivity, 'outdoorActivity', errors),
    question,
    // Optional manual AQI override, used when live data is unavailable.
    manualAqi: isBlank(input.manualAqi)
      ? null
      : Math.round(toNumberInRange(input.manualAqi, LIMITS.aqi, 'manualAqi', errors)),
  };

  if (errors.length) throw new AppError('Invalid input.', 400, errors);
  return profile;
}

module.exports = { validateProfile, validateCity, cleanText, ENUMS, LIMITS };
