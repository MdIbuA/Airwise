'use strict';

/**
 * Air-quality service backed by the free, key-less Open-Meteo APIs
 * (geocoding + Copernicus CAMS air quality). Results are cached, and every
 * upstream call has a hard timeout so a slow provider never stalls a request.
 */

const { TtlCache } = require('../utils/cache');
const { AppError } = require('../utils/errors');

/** @typedef {import('../types').AirReading} AirReading */
/** @typedef {import('../types').Forecast} Forecast */
/** @typedef {import('../types').Location} Location */
/** @typedef {import('../types').TimeWindow} TimeWindow */
/** @typedef {{ time: string, hour: number, pm25: number|null, aqi: number|null }} HourReading */
/** @typedef {{ time?: string[], pm2_5?: (number|null)[], us_aqi?: (number|null)[] }} HourlySeries */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const SOURCE_LABEL = 'Open-Meteo (CAMS)';

/** Only waking hours of the current local day are actionable. */
const FIRST_WAKING_HOUR = 6;
const LAST_WAKING_HOUR = 22;
/** Length of the "cleanest window" recommended for ventilation / exercise. */
const WINDOW_HOURS = 2;
/** Decimal places for coordinates: ~1 km grid, so nearby lookups share a cache entry. */
const COORD_PRECISION = 2;

const CACHE_LIMITS = Object.freeze({ geocodeEntries: 1000, readingEntries: 500 });
const DEFAULT_OPTIONS = Object.freeze({ timeoutMs: 6000, geocodeTtlMs: 86_400_000, airQualityTtlMs: 900_000 });

/**
 * Fetches JSON with a hard timeout.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<any>} parsed JSON body
 * @throws {AppError} 503 when unreachable, 502 on an HTTP error
 */
async function fetchJson(fetchImpl, url, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new AppError('Air quality provider is unreachable right now.', 503);
  }
  if (!response.ok) throw new AppError('Air quality provider returned an error.', 502);
  return response.json();
}

/**
 * Finds the contiguous window of `size` hours with the lowest mean PM2.5.
 * Windows containing a missing reading are skipped.
 * @param {HourReading[]} hours consecutive hourly readings
 * @param {number} [size] window length in hours
 * @returns {TimeWindow|null} null when no complete window exists
 */
function findCleanestWindow(hours, size = WINDOW_HOURS) {
  /** @type {TimeWindow|null} */
  let best = null;
  for (let i = 0; i + size <= hours.length; i += 1) {
    const values = hours.slice(i, i + size).map((h) => h.pm25);
    if (values.some((v) => v === null)) continue;
    const mean = /** @type {number[]} */ (values).reduce((sum, v) => sum + v, 0) / size;
    if (!best || mean < best.meanPm25) {
      best = { start: hours[i].time, end: hours[i + size - 1].time, meanPm25: Math.round(mean) };
    }
  }
  return best;
}

/**
 * @param {unknown} value
 * @returns {number|null} the value when it is a finite number, else null
 */
const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Turns the raw Open-Meteo hourly arrays into daytime insights: the cleanest
 * window to ventilate / exercise and the worst hour to avoid.
 * @param {HourlySeries|undefined} hourly
 * @param {string} [currentTime] ISO local time of the current reading
 * @returns {Forecast|null}
 */
function summariseHourly(hourly, currentTime) {
  if (!hourly || !Array.isArray(hourly.time)) return null;
  const today = (currentTime || hourly.time[0] || '').slice(0, 10);
  /** @type {HourReading[]} */
  const hours = hourly.time
    .map((time, i) => ({
      time,
      hour: Number(time.slice(11, 13)),
      pm25: finiteOrNull(hourly.pm2_5?.[i]),
      aqi: finiteOrNull(hourly.us_aqi?.[i]),
    }))
    .filter((h) => h.time.startsWith(today) && h.hour >= FIRST_WAKING_HOUR && h.hour <= LAST_WAKING_HOUR);

  if (!hours.length) return null;
  const withPm = hours.filter((h) => h.pm25 !== null);
  const worst = withPm.reduce((a, b) => (Number(b.pm25) > Number(a.pm25) ? b : a), withPm[0]);
  return {
    cleanestWindow: findCleanestWindow(hours, WINDOW_HOURS),
    worstHour: worst ? { time: worst.time, pm25: Math.round(Number(worst.pm25)) } : null,
    hoursAnalysed: hours.length,
  };
}

/**
 * Creates the service. `fetchImpl` is injectable so it can be tested offline.
 *
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] HTTP client (defaults to global fetch)
 * @param {number} [options.timeoutMs] per-request timeout
 * @param {number} [options.geocodeTtlMs] cache lifetime for city lookups
 * @param {number} [options.airQualityTtlMs] cache lifetime for readings
 */
function createAirQualityService({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_OPTIONS.timeoutMs,
  geocodeTtlMs = DEFAULT_OPTIONS.geocodeTtlMs,
  airQualityTtlMs = DEFAULT_OPTIONS.airQualityTtlMs,
} = {}) {
  const geoCache = new TtlCache({ ttlMs: geocodeTtlMs, maxEntries: CACHE_LIMITS.geocodeEntries });
  const aqCache = new TtlCache({ ttlMs: airQualityTtlMs, maxEntries: CACHE_LIMITS.readingEntries });

  /**
   * Resolves a city name to coordinates (cached).
   * @param {string} city validated city name
   * @returns {Promise<Location & { latitude: number, longitude: number }>}
   * @throws {AppError} 404 when the place is unknown
   */
  async function geocode(city) {
    return geoCache.wrap(city.toLowerCase(), async () => {
      const query = new URLSearchParams({ name: city, count: '1', language: 'en', format: 'json' });
      const data = await fetchJson(fetchImpl, `${GEOCODE_URL}?${query}`, timeoutMs);
      const place = data?.results?.[0];
      if (!place) throw new AppError(`Could not find a place called "${city}".`, 404);
      return {
        name: place.name,
        region: place.admin1 || '',
        country: place.country || '',
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone || 'auto',
      };
    });
  }

  /**
   * Current air quality plus today's forecast insights for a city (cached per ~1 km cell).
   * @param {string} city validated city name
   * @returns {Promise<AirReading>}
   * @throws {AppError} 404 unknown place, 502/503 upstream problems
   */
  async function getAirQuality(city) {
    const location = await geocode(city);
    const lat = location.latitude.toFixed(COORD_PRECISION);
    const lon = location.longitude.toFixed(COORD_PRECISION);
    const reading = await aqCache.wrap(`${lat},${lon}`, async () => {
      const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
        hourly: 'pm2_5,us_aqi',
        forecast_days: '1',
        timezone: 'auto',
      });
      const data = await fetchJson(fetchImpl, `${AIR_QUALITY_URL}?${params}`, timeoutMs);
      const current = data?.current;
      if (!current || !Number.isFinite(current.us_aqi)) {
        throw new AppError('No air quality data is available for this location.', 502);
      }
      return {
        aqi: Math.round(current.us_aqi),
        pm25: current.pm2_5 ?? null,
        pm10: current.pm10 ?? null,
        no2: current.nitrogen_dioxide ?? null,
        ozone: current.ozone ?? null,
        observedAt: current.time,
        forecast: summariseHourly(data.hourly, current.time),
        source: SOURCE_LABEL,
      };
    });
    return { location, ...reading };
  }

  return { geocode, getAirQuality };
}

module.exports = { createAirQualityService, summariseHourly, findCleanestWindow };
