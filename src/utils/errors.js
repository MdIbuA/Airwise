'use strict';

/** An error whose message is written for users and safe to return to API clients. */
class AppError extends Error {
  /**
   * @param {string} message user-facing message
   * @param {number} [status] HTTP status code (default 400)
   * @param {string[]} [details] individual validation problems
   */
  constructor(message, status = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

module.exports = { AppError };
