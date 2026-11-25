'use strict';

const { default: helmet } = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { AppError } = require('../utils/errors');

/** Strict Content-Security-Policy: everything from our own origin, nothing inline. */
const CSP_DIRECTIVES = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
});

const CROSS_SITE_MESSAGE = 'Cross-site requests are not allowed.';

/** Browser features the app never needs. */
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/**
 * Security headers (helmet defaults + strict CSP + Permissions-Policy).
 * @returns {import('express').RequestHandler[]}
 */
function securityHeaders() {
  const headers = helmet({ contentSecurityPolicy: { useDefaults: true, directives: CSP_DIRECTIVES } });
  /**
   * @param {import('express').Request} _req
   * @param {import('express').Response} res
   * @param {import('express').NextFunction} next
   */
  const permissionsPolicy = (_req, res, next) => {
    res.set('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  };
  return [headers, permissionsPolicy];
}

/**
 * Cross-site request guard for state-changing requests.
 * - Modern browsers send `Sec-Fetch-Site`; anything other than same-origin is rejected.
 * - Older browsers send only `Origin`; its host must match the host we are served on
 *   (the proxy's forwarded host when deployed behind Render / Cloud Run).
 * Requests with neither header (curl, server-to-server, tests) are allowed:
 * CSRF is a browser-only attack.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function sameOriginOnly(req, _res, next) {
  if (req.method !== 'POST') return next();
  const site = req.get('sec-fetch-site');
  if (site) {
    return site === 'same-origin' || site === 'none' ? next() : next(new AppError(CROSS_SITE_MESSAGE, 403));
  }
  const origin = req.get('origin');
  if (!origin) return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return next(new AppError('Invalid Origin header.', 403));
  }
  const servedHost = req.get('x-forwarded-host') || req.get('host');
  return originHost === servedHost ? next() : next(new AppError(CROSS_SITE_MESSAGE, 403));
}

/**
 * POST bodies must be JSON: blocks form-encoded / text/plain CSRF payloads outright.
 * @param {import('express').Request} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function requireJson(req, _res, next) {
  if (req.method === 'POST' && !req.is('application/json')) {
    return next(new AppError('Content-Type must be application/json.', 415));
  }
  return next();
}

/**
 * Per-IP rate limiters: a general API budget and a tighter one for the
 * LLM-backed endpoint (caps cost and abuse).
 * @param {number} perMinute general API requests per minute per IP
 */
function createRateLimiters(perMinute) {
  /** @type {import('express-rate-limit').Options['standardHeaders']} */
  const standardHeaders = 'draft-7';
  const common = { windowMs: 60_000, standardHeaders, legacyHeaders: false };
  return {
    apiLimiter: rateLimit({ ...common, limit: perMinute, message: { error: 'Too many requests, please slow down.' } }),
    aiLimiter: rateLimit({
      ...common,
      limit: Math.max(1, Math.ceil(perMinute / 3)),
      message: { error: 'Too many plan requests, please wait a minute.' },
    }),
  };
}

module.exports = { securityHeaders, sameOriginOnly, requireJson, createRateLimiters, CSP_DIRECTIVES };
