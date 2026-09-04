#!/usr/bin/env node
const assert = require('assert');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const SITE = process.env.APPOINTMENT_TEST_URL || 'http://localhost:8888/appointment.html';

async function selectService(page, id, options = {}) {
  const item = page.locator(`[data-service-item="${id}"]`);
  await item.locator('[data-service-toggle]').check();
  if (options.quantity) await item.locator('[data-service-quantity]').selectOption(String(options.quantity));
  if (options.sizeBand) await item.locator('[data-service-size-band]').selectOption(options.sizeBand);
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of 404/.test(message.text())) {
      errors.push(message.text());
    }
  });

  await page.goto(SITE, { waitUntil: 'networkidle' });
  assert.strictEqual(await page.locator('[data-total-price]').textContent(), '$0.00');
  const shopLocation = page.locator('[data-install-location-option="shop"]');
  assert.strictEqual(await shopLocation.isDisabled(), true);
  assert.match(await shopLocation.textContent(), /Coming soon/);

  const offRim = page.locator('[data-service-item="off-rim-swap"]');
  await offRim.locator('[data-service-toggle]').check();
  assert.ok(await offRim.evaluate((element) => element.classList.contains('needs-details')));
  assert.match(await offRim.evaluate((element) => getComputedStyle(element, '::after').content), /Choose details/);
  assert.strictEqual(await page.locator('[data-total-price]').textContent(), '$0.00');
  await offRim.locator('[data-service-quantity]').selectOption('2');
  await offRim.locator('[data-service-size-band]').selectOption('20-22');
  await selectService(page, 'balancing', { quantity: 4 });
  await selectService(page, 'flat-patch-plug', { quantity: 1 });
  await selectService(page, 'air-fill');
  await selectService(page, 'tire-replacement');

  assert.strictEqual(await page.locator('[data-starting-price]').textContent(), '$192.50');
  assert.strictEqual(await page.locator('[data-hst-price]').textContent(), '$25.03');
  assert.strictEqual(await page.locator('[data-total-price]').textContent(), '$217.53');
  assert.strictEqual(await page.locator('[data-deposit-price]').textContent(), '$43.51');
  assert.strictEqual(await page.locator('[data-balance-price]').textContent(), '$174.02');
  assert.match(await page.locator('[data-selected-services]').textContent(), /5 services selected/);
  assert.match(await page.locator('[data-selected-services]').textContent(), /Air fill-up/);
  assert.match(await page.locator('[data-selected-services]').textContent(), /Tire retorque/);
  assert.match(await page.locator('[data-selected-services]').textContent(), /\$20\.00/);

  const screenshot = path.join(os.tmpdir(), 'eastcord-multi-service-builder.png');
  await page.locator('.site-header').evaluate((element) => { element.style.display = 'none'; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.appointment-form-card').screenshot({ path: screenshot });

  await selectService(page, 'on-rim-swap', { quantity: 4 });
  assert.strictEqual(
    await page.locator('[data-service-item="off-rim-swap"] [data-service-toggle]').isChecked(),
    false,
    'on-rim and off-rim swaps must remain mutually exclusive',
  );
  await offRim.locator('[data-service-toggle]').check();
  assert.strictEqual(await offRim.locator('[data-service-quantity]').inputValue(), '');
  assert.strictEqual(await offRim.locator('[data-service-size-band]').inputValue(), '');
  assert.ok(await offRim.evaluate((element) => element.classList.contains('needs-details')));

  const linkedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await linkedContext.addInitScript(() => {
    localStorage.setItem('eastcord_used_tire_cart_v1', JSON.stringify([{
      type: 'used_tire',
      inventoryId: 'auto-size-test',
      brand: 'Michelin',
      model: 'Defender',
      size: '2055516',
      qty: 2,
      unitPrice: 100,
    }, {
      type: 'used_tire',
      inventoryId: 'auto-size-same-band',
      brand: 'Michelin',
      model: 'Defender',
      size: '215/60R16',
      qty: 1,
      unitPrice: 100,
    }, {
      type: 'used_tire',
      inventoryId: 'auto-size-mixed-band',
      brand: 'Michelin',
      model: 'Defender',
      size: '225/45R17',
      qty: 1,
      unitPrice: 100,
    }]));
  });
  const linkedPage = await linkedContext.newPage();
  await linkedPage.goto(SITE, { waitUntil: 'networkidle' });
  await selectService(linkedPage, 'off-rim-swap', { quantity: 4 });
  await linkedPage.locator('[data-appointment-tire-id]').first().check();
  assert.strictEqual(
    await linkedPage.locator('[data-service-item="off-rim-swap"] [data-service-size-band]').inputValue(),
    '14-16',
  );
  assert.strictEqual(await linkedPage.locator('[data-starting-price]').textContent(), '$65.00');
  await linkedPage.locator('[data-appointment-tire-id]').nth(1).check();
  assert.strictEqual(
    await linkedPage.locator('[data-service-item="off-rim-swap"] [data-service-size-band]').inputValue(),
    '14-16',
  );
  await linkedPage.locator('[data-appointment-tire-id]').nth(2).check();
  assert.strictEqual(
    await linkedPage.locator('[data-service-item="off-rim-swap"] [data-service-size-band]').inputValue(),
    '',
    'mixed linked tire size bands must require a manual size choice',
  );
  assert.ok(await linkedPage.locator('[data-service-item="off-rim-swap"]').evaluate((element) => (
    element.classList.contains('needs-details')
  )));
  await linkedContext.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(SITE, { waitUntil: 'networkidle' });
  await selectService(mobile, 'off-rim-swap', { quantity: 4, sizeBand: '23-24' });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `mobile page has ${overflow}px horizontal overflow`);
  const mobileScreenshot = path.join(os.tmpdir(), 'eastcord-appointment-mobile.png');
  await mobile.locator('.appointment-form-card').screenshot({ path: mobileScreenshot });

  const cartContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await cartContext.addInitScript(() => {
    localStorage.setItem('eastcord_cart_v1', JSON.stringify([{
      id: 'numbered-services-test',
      type: 'appointment',
      serviceId: 'multi-service-v1',
      serviceName: 'Off-rim swap × 2, 17–19 inches + Balancing × 2 + Air fill-up × 1',
      serviceSelections: [
        { id: 'off-rim-swap', quantity: 2, sizeBand: '17-19' },
        { id: 'balancing', quantity: 2 },
        { id: 'air-fill', quantity: 1 },
      ],
      serviceSubtotal: 87.5,
      vehicleYear: '2014',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      preferredDate: '2026-09-11',
      preferredTimeWindow: '1:00 PM - 2:00 PM',
      fullServiceAddress: '1390 Weir Chase',
      city: 'Mississauga',
      postalCode: 'L5V 2W9',
    }]));
  });
  const cartPage = await cartContext.newPage();
  await cartPage.goto(new URL('/cart.html', SITE).toString(), { waitUntil: 'networkidle' });
  assert.strictEqual(await cartPage.locator('.cart-line-services li').count(), 3);
  assert.deepStrictEqual(await cartPage.locator('.cart-line-service-number').allTextContents(), ['1', '2', '3']);
  assert.match(await cartPage.locator('.cart-line-services').innerText(), /Off-rim swap × 2/);
  assert.match(await cartPage.locator('.cart-line-services').innerText(), /Balancing × 2/);
  assert.match(await cartPage.locator('.cart-line-services').innerText(), /Air fill-up × 1/);
  assert.deepStrictEqual(
    await cartPage.locator('.cart-line-service-price').allTextContents(),
    ['$37.50', '$30.00', '$20.00'],
  );
  assert.match(await cartPage.locator('.cart-line-total').innerText(), /Appointment total\s*\$87\.50/i);
  const lastServiceBox = await cartPage.locator('.cart-line-services li').last().boundingBox();
  const totalBox = await cartPage.locator('.cart-line-total').boundingBox();
  assert.ok(totalBox.y > lastServiceBox.y + lastServiceBox.height, 'appointment total must appear below the service list');
  const removeBox = await cartPage.locator('.cart-line-remove').boundingBox();
  assert.ok(removeBox.y > totalBox.y, 'remove action must appear below the appointment total');
  const cartLineBox = await cartPage.locator('.cart-line').first().boundingBox();
  const removeBottomGap = (cartLineBox.y + cartLineBox.height) - (removeBox.y + removeBox.height);
  assert.ok(removeBottomGap <= 10, `remove action is ${removeBottomGap}px above the card bottom`);
  const cartOverflow = await cartPage.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  assert.ok(cartOverflow <= 1, `mobile appointment cart has ${cartOverflow}px horizontal overflow`);
  const cartScreenshot = path.join(os.tmpdir(), 'eastcord-appointment-cart-mobile.png');
  await cartPage.locator('.cart-panel').screenshot({ path: cartScreenshot });
  await cartContext.close();

  const anonymous = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await anonymous.goto(SITE, { waitUntil: 'networkidle' });
  await selectService(anonymous, 'on-rim-swap', { quantity: 4 });
  await anonymous.locator('[data-booking-step="0"] [data-next-step]').click();
  await anonymous.locator('input[name="Vehicle Year"]').fill('2022');
  await anonymous.locator('input[name="Vehicle Make"]').fill('Toyota');
  await anonymous.locator('input[name="Vehicle Model"]').fill('Corolla');
  await anonymous.locator('input[name="Vehicle Plate Number"]').fill('TEST123');
  await anonymous.locator('input[name="Vehicle Colour"]').fill('Blue');
  await anonymous.locator('input[name="Tire Size"]').fill('205/55R16');
  await anonymous.locator('[data-booking-step="1"] [data-next-step]').click();
  await anonymous.locator('[data-install-location-option="mobile"]').click();
  await anonymous.locator('input[name="Full Service Address"]').fill('123 Main Street');
  await anonymous.locator('select[name="City"]').selectOption('Milton');
  await anonymous.locator('input[name="Postal Code"]').fill('L9T 2X5');
  await anonymous.locator('textarea[name="Parking Driveway Access Notes"]').fill('Driveway');
  await anonymous.locator('[data-booking-step="2"] [data-next-step]').click();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await anonymous.locator('input[name="Preferred Date"]').fill(tomorrow);
  await anonymous.locator('select[name="Preferred Time Window"]').selectOption('10:00 AM - 11:00 AM');
  await anonymous.locator('[data-booking-step="3"] [data-next-step]').click();
  await anonymous.locator('.appointment-submit').click();
  await anonymous.locator('[data-login-required-block]').waitFor({ state: 'visible' });
  assert.match(anonymous.url(), /appointment(?:\.html)?/);
  assert.strictEqual(
    await anonymous.evaluate(() => window.EastCordAccount?.getCart?.().length || 0),
    0,
    'logged-out appointment must not be added to cart',
  );

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('ok  multiple services update one combined total');
  console.log('ok  logged-out customers can fill the form but cannot add to cart');
  console.log('ok  mutually exclusive service choices stay organized');
  console.log('ok  linked tire size automatically selects off-rim pricing');
  console.log('ok  fixed-price quick services are included in totals');
  console.log('ok  EastCord shop location is disabled as coming soon');
  console.log('ok  mobile service builder has no horizontal overflow');
  console.log('ok  appointment cart shows numbered service lines and prices');
  console.log(`screenshot  ${screenshot}`);
  console.log(`screenshot  ${mobileScreenshot}`);
  console.log(`screenshot  ${cartScreenshot}`);
}

main().catch((error) => {
  console.error(`FAIL appointment multi-service flow: ${error.stack || error.message}`);
  process.exit(1);
});
