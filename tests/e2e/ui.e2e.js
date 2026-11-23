'use strict';
/* global document, window -- referenced inside page.evaluate() callbacks */

/**
 * Browser end-to-end + automated accessibility (axe-core, WCAG 2.1 AA) tests.
 * Runs the real front end against the app with offline fakes.
 *   npm run test:e2e
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const { createApp } = require('../../src/app');
const { createAirQualityService } = require('../../src/services/airQuality');
const { createAssistant } = require('../../src/services/assistant');
const { makeFetch, silentLogger } = require('../helpers');

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('AirWise UI', async (t) => {
  const app = createApp({
    airQuality: createAirQualityService({ fetchImpl: makeFetch().fetchImpl }),
    assistant: createAssistant({ enabled: false, model: 'x' }),
    rateLimitPerMinute: 1000,
    logger: silentLogger,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const newPage = async (options) => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    return { page, errors };
  };

  const fillAndSubmit = async (page) => {
    await page.getByLabel('City or town').fill('Delhi');
    await page.getByLabel('Children under 14').check();
    await page.getByLabel('Main daily commute').selectOption('car_petrol');
    await page.getByLabel('Home heating').selectOption('wood_coal');
    await page.getByRole('button', { name: 'Get my clean-air plan' }).click();
    await page.locator('#results:not([hidden])').waitFor();
  };

  await t.test('form page has no WCAG 2.1 AA violations', async () => {
    const { page } = await newPage();
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    assert.deepEqual(violations.map((v) => `${v.id}: ${v.help}`), []);
    await page.context().close();
  });

  await t.test('submitting renders a full plan with no console errors', async () => {
    const { page, errors } = await newPage();
    await fillAndSubmit(page);
    const text = await page.locator('#results').innerText();
    assert.match(text, /AQI 312/);
    assert.match(text, /Hazardous/);
    assert.match(text, /Switch your car commute/);
    assert.match(text, /Cleanest window today: 14:00–15:00/);
    assert.match(await page.locator('#community-alert').innerText(), /Air alert for Delhi: AQI 312/);
    assert.equal(text.includes('null'), false);
    assert.equal(text.includes('undefined'), false);
    // Focus moves to the results heading for screen-reader and keyboard users.
    assert.equal(await page.evaluate(() => document.activeElement.id), 'results-heading');
    assert.deepEqual(errors, []);
    await page.context().close();
  });

  await t.test('results page has no WCAG 2.1 AA violations (light and dark mode)', async () => {
    for (const colorScheme of ['light', 'dark']) {
      const { page } = await newPage({ colorScheme });
      await fillAndSubmit(page);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      assert.deepEqual(violations.map((v) => `${colorScheme} ${v.id}: ${v.help} (${v.nodes.length})`), []);
      await page.context().close();
    }
  });

  await t.test('copy alert button copies the community message', async () => {
    const { page } = await newPage();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await fillAndSubmit(page);
    await page.getByRole('button', { name: 'Copy alert' }).click();
    await page.getByRole('status').filter({ hasText: 'copied' }).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Air alert for Delhi/);
    await page.context().close();
  });

  await t.test('empty city shows an accessible error and focuses the field', async () => {
    const { page } = await newPage();
    await page.getByRole('button', { name: 'Get my clean-air plan' }).click();
    await assert.doesNotReject(page.getByRole('alert').filter({ hasText: 'Please enter your city' }).waitFor());
    assert.equal(await page.getAttribute('#city', 'aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'city');
    await page.context().close();
  });

  await t.test('whole flow works with the keyboard only', async () => {
    const { page } = await newPage();
    await page.keyboard.press('Tab'); // skip link
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to main content');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'city');
    await page.keyboard.type('Delhi');
    await page.keyboard.press('Enter');
    await page.locator('#results:not([hidden])').waitFor();
    await page.context().close();
  });

  await t.test('layout does not overflow on a small phone (320px)', async () => {
    const { page } = await newPage({ viewport: { width: 320, height: 640 } });
    await fillAndSubmit(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await page.context().close();
  });
});
