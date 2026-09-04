#!/usr/bin/env node
const assert = require('assert');
const { chromium } = require('playwright');

const SITE = 'https://eastcordtires.ca/appointment.html';

function dateAhead(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function assertStep(page, index) {
  assert.ok(await page.locator(`[data-booking-step="${index}"]`).isVisible(), `Step ${index + 1} is not visible.`);
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  assert.ok(overflow <= 1, `Step ${index + 1} has ${overflow}px horizontal overflow.`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error'
        && !/Failed to load resource: the server responded with a status of 404|favicon|ERR_ABORTED/i.test(message.text())
      ) errors.push(message.text());
    });
    await page.goto(SITE, { waitUntil: 'networkidle', timeout: 60000 });
    await assertStep(page, 0);
    assert.strictEqual(await page.locator('[data-total-price]').textContent(), '$0.00');
    await page.locator('[data-booking-step="0"] [data-next-step]').click();
    await assertStep(page, 0);
    await page.locator('[data-service-item="air-fill"] [data-service-toggle]').check();
    assert.strictEqual(await page.locator('[data-total-price]').textContent(), '$22.60');
    await page.locator('[data-booking-step="0"] [data-next-step]').click();

    await assertStep(page, 1);
    await page.locator('input[name="Vehicle Year"]').fill('2021');
    await page.locator('input[name="Vehicle Make"]').fill('Toyota');
    await page.locator('input[name="Vehicle Model"]').fill('Corolla');
    await page.locator('input[name="Vehicle Plate Number"]').fill('PROD 123');
    await page.locator('input[name="Vehicle Colour"]').fill('Blue');
    await page.locator('input[name="Tire Size"]').fill('205/55R16');
    await page.locator('textarea[name="Additional Notes"]').fill('Automated production UI test; no cart write expected.');
    await page.locator('[data-booking-step="1"] [data-next-step]').click();

    await assertStep(page, 2);
    await page.locator('[data-install-location-option="mobile"]').click();
    await page.locator('input[name="Full Service Address"]').fill('123 Test Street');
    await page.locator('select[name="City"]').selectOption('Other');
    await page.locator('input[name="Postal Code"]').fill('L9T 2X5');
    const parking = page.locator('textarea[name="Parking Driveway Access Notes"]');
    if (await parking.count()) await parking.fill('Driveway access is clear.');
    assert.ok(await page.locator('[data-service-area-warning]').isVisible());
    await page.locator('[data-booking-step="2"] [data-next-step]').click();
    await assertStep(page, 2);

    await page.locator('select[name="City"]').selectOption('Milton');
    assert.ok(await page.locator('[data-service-area-warning]').isHidden());
    await page.locator('[data-booking-step="2"] [data-next-step]').click();

    await assertStep(page, 3);
    await page.locator('input[name="Preferred Date"]').fill(dateAhead(21));
    const firstAvailableTime = await page.locator('select[name="Preferred Time Window"] option:not([disabled])')
      .evaluateAll((options) => options.map((option) => option.value).find(Boolean));
    assert.ok(firstAvailableTime, 'No production appointment time is available.');
    await page.locator('select[name="Preferred Time Window"]').selectOption(firstAvailableTime);
    await page.locator('[data-booking-step="3"] [data-next-step]').click();

    await assertStep(page, 4);
    assert.match(await page.locator('[data-review-service]').innerText(), /Air fill-up/i);
    assert.match(await page.locator('[data-review-vehicle]').innerText(), /Toyota|Corolla/i);
    assert.match(await page.locator('[data-review-location]').innerText(), /123 Test Street|Milton/i);
    assert.match(await page.locator('[data-review-date]').innerText(), /2026|Sep|September/i);
    await page.locator('.appointment-submit').click();
    await page.locator('[data-login-required-block]').waitFor({ state: 'visible' });
    assert.match(page.url(), /appointment/);
    const appointmentCartCount = await page.evaluate(() => (
      window.EastCordAccount?.getCart?.().filter((item) => item.type === 'appointment').length || 0
    ));
    assert.strictEqual(appointmentCartCount, 0);
    assert.deepStrictEqual(errors, []);

    console.log('ok  production mobile wizard advances through all five steps');
    console.log('ok  out-of-area city blocks progression and displays warning');
    console.log('ok  valid mobile address, date, and time reach review');
    console.log('ok  logged-out submit is blocked before any cart write');
    console.log('ok  no overflow or browser errors through the production flow');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('FAIL production appointment edge flow:', error);
  process.exit(1);
});
