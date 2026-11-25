'use strict';

/**
 * Generative-AI package.
 *
 *   assistant.js          time-boxed, cached, grounded narration with key failover
 *   prompt.js             system prompt, output schema, PII-free payload
 *   fallbackNarrative.js  rule-based briefing (instant / when AI is unavailable)
 *   errors.js             error classification + log-safe descriptions
 *   providers/            Claude and Gemini adapters behind one interface
 */

const { createAssistant } = require('./assistant');
const { templateNarrative } = require('./fallbackNarrative');
const { createProviders, DEFAULT_MODELS } = require('./providers');
const { describeError } = require('./errors');

module.exports = { createAssistant, templateNarrative, createProviders, DEFAULT_MODELS, describeError };
