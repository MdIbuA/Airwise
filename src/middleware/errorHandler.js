'use strict';

const { AppError } = require('../utils/errors');

/**
 * Central error handler: only AppError messages (written for users) reach the
 * client; anything unexpected is logged server-side and returned as a generic 500.
 * @param {import('../types').Logger} logger
 * @returns {import('express').ErrorRequestHandler}
 */
function createErrorHandler(logger) {
  // Express recognises error handlers by their four parameters.

  return (error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
    if (error instanceof AppError) {
      const body = { error: error.message, ...(error.details ? { details: error.details } : {}) };
      return res.status(error.status).json(body);
    }
    logger.error('[server] unexpected error:', error.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
}

module.exports = { createErrorHandler };
