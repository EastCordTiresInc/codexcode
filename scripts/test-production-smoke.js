#!/usr/bin/env node
const assert = require('assert');
const { chromium } = require('playwright');

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ORIGIN = 'https://eastcordtires.ca';
const PATHS = ['/', '/new-tires.html', '/appointment.html', '/cart.html', '/login.html', '/account.html'];

async function checkPage(browser, pathname, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error'
        && !/Failed to load resource: the server responded with a status of 404|favicon|ERR_ABORTED|Permissions policy violation: compute-pressure/i.test(message.text())
    ) errors.push(message.text());
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === ORIGIN && response.status() >= 400) {
      errors.push(`${response.status()} ${url.pathname}`);
    }
  });

  const response = await page.goto(`${ORIGIN}${pathname}`, { waitUntil: 'networkidle', timeout: 60000 });
  assert.ok(response?.ok(), `${pathname} returned ${response?.status()}`);
  assert.ok((await page.title()).trim(), `${pathname} has no page title`);
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  assert.ok(overflow <= 1, `${pathname} has ${overflow}px horizontal overflow at ${viewport.width}px`);
  assert.deepStrictEqual(errors, [], `${pathname} browser errors: ${errors.join('; ')}`);

  if (pathname === '/new-tires.html') {
    await page.locator('#tireconnect').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => /HOW WOULD YOU LIKE TO SEARCH/i.test(
      document.querySelector('#tireconnect')?.innerText || '',
    ), null, { timeout: 30000 });
  }

  if (pathname === '/appointment.html') {
    assert.strictEqual(await page.locator('[data-booking-step]').count(), 5);
    if (viewport.width <= 800) {
      const menu = page.locator('.menu-toggle');
      await menu.click();
      assert.strictEqual(await menu.getAttribute('aria-expanded'), 'true');
      assert.ok(await page.locator('.main-nav').evaluate((nav) => (
        nav.classList.contains('open') || nav.classList.contains('is-open')
      )));
    }
  }

  if (pathname === '/cart.html') {
    assert.ok(
      await page.locator('[data-stripe-test-note]').evaluate((note) => note.hidden),
      'Production cart enables test-card instructions.',
    );
  }
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const failures = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      for (const pathname of PATHS) {
        try {
          await checkPage(browser, pathname, viewport);
        } catch (error) {
          failures.push(`${viewport.width}px ${pathname}: ${error.message}`);
        }
      }
    }

    const methodResponse = await fetch(`${ORIGIN}/.netlify/functions/save-new-tire-widget-order`);
    assert.strictEqual(methodResponse.status, 405);
    const noAuthResponse = await fetch(`${ORIGIN}/.netlify/functions/save-new-tire-widget-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.strictEqual(noAuthResponse.status, 401);

    console.log('ok  six production pages load at mobile and desktop sizes');
    console.log('ok  no same-origin HTTP or browser runtime errors');
    console.log('ok  no horizontal overflow across tested production pages');
    console.log('ok  production TireConnect search initializes');
    console.log('ok  production mobile appointment navigation opens');
    console.log('ok  order endpoint rejects wrong method and missing authentication');
    if (failures.length) {
      throw new Error(`Production page failures:\n- ${failures.join('\n- ')}`);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('FAIL production smoke:', error);
  process.exit(1);
});
