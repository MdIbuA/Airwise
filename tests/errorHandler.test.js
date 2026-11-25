'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorHandler } = require('../src/middleware/errorHandler');
const { AppError } = require('../src/utils/errors');

/** Minimal Express-like response recording status and JSON body. */
function fakeResponse() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test('unexpected errors return a generic 500 and are logged server-side only', () => {
  const logged = [];
  const handler = createErrorHandler({ error: (...args) => logged.push(args.join(' ')), warn() {} });
  const res = fakeResponse();
  handler(new Error('db password is hunter2'), {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Something went wrong. Please try again.' });
  assert.equal(JSON.stringify(res.body).includes('hunter2'), false); // internals never reach the client
  assert.match(logged[0], /unexpected error/);
});

test('AppError messages and details are returned with their status', () => {
  const handler = createErrorHandler({ error() {}, warn() {} });
  const res = fakeResponse();
  handler(new AppError('Invalid input.', 400, ['city is required']), {}, res, () => {});
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Invalid input.', details: ['city is required'] });

  const plain = fakeResponse();
  handler(new AppError('Not found.', 404), {}, plain, () => {});
  assert.deepEqual(plain.body, { error: 'Not found.' }); // no empty details key
});

test('body-parser errors map to 400 and 413', () => {
  const handler = createErrorHandler({ error() {}, warn() {} });
  const malformed = fakeResponse();
  handler(Object.assign(new Error('x'), { type: 'entity.parse.failed' }), {}, malformed, () => {});
  assert.equal(malformed.statusCode, 400);
  const tooLarge = fakeResponse();
  handler(Object.assign(new Error('x'), { type: 'entity.too.large' }), {}, tooLarge, () => {});
  assert.equal(tooLarge.statusCode, 413);
});
