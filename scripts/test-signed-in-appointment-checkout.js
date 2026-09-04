#!/usr/bin/env node
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

// Match the local dev runner on Windows networks that intercept HTTPS.
// This process is test-only and never runs in production.
if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SITE = process.env.APPOINTMENT_TEST_URL || 'http://localhost:8888';
const TEST_PASSWORD = `EastCord-Test-${Date.now()}!`;
const TEST_EMAIL = `eastcord-checkout-${Date.now()}@example.com`;
const TEST_PHONE = '9055550199';
const MOBILE = process.env.APPOINTMENT_TEST_MOBILE === '1';
const EXPECT_LIVE_STRIPE = process.env.APPOINTMENT_EXPECT_LIVE_STRIPE === '1';
const TIME_WINDOWS = [
  '8:00 AM - 9:00 AM',
  '9:00 AM - 10:00 AM',
  '10:00 AM - 11:00 AM',
  '11:00 AM - 12:00 PM',
  '12:00 PM - 1:00 PM',
  '1:00 PM - 2:00 PM',
  '2:00 PM - 3:00 PM',
  '3:00 PM - 4:00 PM',
  '4:00 PM - 5:00 PM',
  '5:00 PM - 6:00 PM',
  '6:00 PM - 7:00 PM',
  '7:00 PM - 8:00 PM',
];

function loadProtectedTestEnvironment() {
  function loadFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
      if (!match || process.env[match[1]]) return;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    });
  }

  const root = path.join(__dirname, '..');
  loadFile(path.join(root, '.env'));
  loadFile(path.join(root, '.netlify', '.env'));

  ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'].forEach((name) => {
    if (process.env[name]) return;
    process.env[name] = execFileSync(
      'npx',
      ['netlify', 'env:get', name, '--context', 'dev', '--scope', 'functions'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' },
    ).trim();
  });
}

function isoDate(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  assert.ok(overflow <= 1, `${label} has ${overflow}px horizontal overflow`);
}

async function selectFreeSlot(admin) {
  for (let daysAhead = 21; daysAhead <= 35; daysAhead += 1) {
    const date = isoDate(daysAhead);
    const { data, error } = await admin
      .from('appointment_bookings')
      .select('preferred_time_window')
      .eq('preferred_date', date)
      .eq('payment_status', 'paid_deposit')
      .eq('booking_status', 'Confirmed');
    if (error) throw error;
    const occupied = new Set((data || []).map((row) => row.preferred_time_window));
    const time = TIME_WINDOWS.find((candidate) => !occupied.has(candidate));
    if (time) return { date, time };
  }
  throw new Error('No free appointment test slot was found.');
}

async function cleanupStaleTestData(admin) {
  const { data: staleBookings } = await admin
    .from('appointment_bookings')
    .select('id')
    .like('customer_email', 'eastcord-checkout-%@example.com');
  const staleBookingIds = (staleBookings || []).map((booking) => booking.id);
  if (staleBookingIds.length) {
    await admin.from('appointment_bookings').delete().in('id', staleBookingIds);
  }

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const staleUsers = (users?.users || []).filter((user) => (
    /^eastcord-checkout-\d+@example\.com$/i.test(user.email || '')
  ));
  for (const user of staleUsers) {
    await admin.from('customer_profiles').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
}

async function fillStripeCheckout(page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 });
  assert.ok(!/\/cs_live_/i.test(page.url()), 'Refusing to submit a test card to a live Stripe Checkout session.');
  const email = page.locator('input[type="email"]').first();
  if (await email.isVisible().catch(() => false)) await email.fill(TEST_EMAIL);

  await page.locator('#cardNumber, input[name="cardNumber"]').first().fill('4242424242424242');
  await page.locator('#cardExpiry, input[name="cardExpiry"]').first().fill('1230');
  await page.locator('#cardCvc, input[name="cardCvc"]').first().fill('123');

  const name = page.locator('#billingName, input[name="billingName"]').first();
  if (await name.isVisible().catch(() => false)) await name.fill('EastCord Checkout Test');
  const postal = page.locator('#billingPostalCode, input[name="billingPostalCode"]').first();
  if (await postal.isVisible().catch(() => false)) await postal.fill('L9T2X5');

  const payButton = page.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').last();
  await payButton.click();
}

async function main() {
  loadProtectedTestEnvironment();
  assert.ok(process.env.SUPABASE_URL, 'SUPABASE_URL is missing.');
  assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is missing.');
  assert.ok(process.env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY is missing.');
  assert.ok(process.env.STRIPE_SECRET_KEY.startsWith('sk_test_'), 'Refusing to run against non-test Stripe.');

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await cleanupStaleTestData(admin);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let userId = '';
  let bookingIds = [];

  try {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'EastCord Checkout Test', phone: TEST_PHONE },
    });
    if (createError) throw createError;
    userId = created.user.id;

    const { error: profileError } = await admin.from('customer_profiles').upsert({
      id: userId,
      full_name: 'EastCord Checkout Test',
      email: TEST_EMAIL,
      phone: TEST_PHONE,
      updated_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;

    const slot = await selectFreeSlot(admin);
    const page = await browser.newPage({
      viewport: MOBILE ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    });
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/Failed to load resource.*404/i.test(message.text())) {
        browserErrors.push(message.text());
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && response.status() !== 404) {
        browserErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    await page.goto(`${SITE}/login.html?redirect=%2Fappointment.html`, { waitUntil: 'networkidle' });
    await page.locator('input[name="Email"]').fill(TEST_EMAIL);
    await page.locator('input[name="Password"]').fill(TEST_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => url.pathname.endsWith('/appointment.html'), { timeout: 20000 }),
      page.locator('[data-login-form] button[type="submit"]').click(),
    ]);
    await page.waitForLoadState('networkidle');
    await assertNoHorizontalOverflow(page, 'appointment service step');

    const onRim = page.locator('[data-service-item="on-rim-swap"]');
    await onRim.locator('[data-service-toggle]').check();
    await onRim.locator('[data-service-quantity]').selectOption('4');
    const balancing = page.locator('[data-service-item="balancing"]');
    await balancing.locator('[data-service-toggle]').check();
    await balancing.locator('[data-service-quantity]').selectOption('4');
    await page.locator('[data-service-item="flat-patch-plug"] [data-service-toggle]').check();
    await page.locator('[data-service-item="flat-patch-plug"] [data-service-quantity]').selectOption('1');
    assert.strictEqual(await page.locator('[data-total-price]').textContent(), '$192.10');
    await page.locator('[data-booking-step="0"] [data-next-step]').click();
    await assertNoHorizontalOverflow(page, 'appointment vehicle step');

    await page.locator('input[name="Vehicle Year"]').fill('2022');
    await page.locator('input[name="Vehicle Make"]').fill('Toyota');
    await page.locator('input[name="Vehicle Model"]').fill('Corolla');
    await page.locator('input[name="Vehicle Plate Number"]').fill('TEST123');
    await page.locator('input[name="Vehicle Colour"]').fill('Blue');
    await page.locator('input[name="Tire Size"]').fill('205/55R16');
    await page.locator('textarea[name="Additional Notes"]').fill('AUTOMATED STRIPE TEST - SAFE TO DELETE');
    await page.locator('[data-booking-step="1"] [data-next-step]').click();
    await assertNoHorizontalOverflow(page, 'appointment location step');

    await page.locator('[data-install-location-option="mobile"]').click();
    await page.locator('input[name="Full Service Address"]').fill('123 Main Street');
    await page.locator('select[name="City"]').selectOption('Milton');
    await page.locator('input[name="Postal Code"]').fill('L9T 2X5');
    await page.locator('textarea[name="Parking Driveway Access Notes"]').fill('Vehicle is parked in the driveway.');
    await page.locator('[data-booking-step="2"] [data-next-step]').click();
    await assertNoHorizontalOverflow(page, 'appointment date step');
    await page.locator('input[name="Preferred Date"]').fill(slot.date);
    await page.locator('select[name="Preferred Time Window"]').selectOption({ label: slot.time });
    await page.locator('[data-booking-step="3"] [data-next-step]').click();
    await assertNoHorizontalOverflow(page, 'appointment review step');

    assert.match(await page.locator('[data-review-service]').textContent(), /On-rim swap/);
    assert.match(await page.locator('[data-review-service]').textContent(), /Balancing/);
    assert.match(await page.locator('[data-review-service]').textContent(), /Patch \+ plug/);
    await Promise.all([
      page.waitForURL(/cart(?:\.html)?$/, { timeout: 20000 }),
      page.locator('.appointment-submit').click(),
    ]);
    await assertNoHorizontalOverflow(page, 'appointment cart');

    assert.match(await page.locator('[data-cart-items]').textContent(), /On-rim swap/);
    assert.match(await page.locator('[data-cart-items]').textContent(), /Balancing/);
    assert.match(await page.locator('[data-cart-items]').textContent(), /Service address:\s*123 Main Street, Milton, L9T 2X5/);
    assert.match(await page.locator('[data-cart-total]').textContent(), /\$192\.10/);
    await page.locator('[data-agreement-checkbox]').check();
    await Promise.all([
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 30000 }),
      page.locator('[data-appointment-pay-button]').click(),
    ]);

    if (EXPECT_LIVE_STRIPE) {
      assert.match(page.url(), /\/cs_live_/i, 'Production checkout did not create a live Stripe session.');
      const sessionId = page.url().match(/\/(cs_live_[^/?#]+)/i)?.[1] || '';
      assert.ok(sessionId, 'The live Stripe session ID could not be read.');
      const confirmationResponse = await page.request.post(
        `${SITE}/.netlify/functions/confirm-appointment-payment`,
        { data: { sessionId } },
      );
      assert.strictEqual(confirmationResponse.status(), 202);
      assert.match((await confirmationResponse.json()).message || '', /Payment is not complete yet/i);
      const { data: unpaidBookings, error: unpaidBookingError } = await admin
        .from('appointment_bookings')
        .select('id, payment_status, booking_status, stripe_session_id')
        .eq('customer_id', userId);
      if (unpaidBookingError) throw unpaidBookingError;
      assert.strictEqual(unpaidBookings.length, 1, 'Live checkout did not create exactly one pending appointment booking.');
      assert.strictEqual(unpaidBookings[0].payment_status, 'pending_checkout');
      assert.notStrictEqual(unpaidBookings[0].booking_status, 'Confirmed');
      console.log('ok  production appointment created a live Stripe Checkout session');
      console.log('ok  unpaid live Stripe session remains pending and is not marked confirmed');
      console.log('ok  no card was submitted and temporary booking data will be removed');
      return;
    }

    const confirmationResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/.netlify/functions/confirm-appointment-payment'),
      { timeout: 90000 },
    ).catch((error) => ({ waitError: error }));
    await fillStripeCheckout(page);
    try {
      await page.waitForURL(new RegExp(`${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/appointment-success`), {
        timeout: 60000,
      });
    } catch (error) {
      const screenshot = path.join(os.tmpdir(), 'eastcord-stripe-timeout.png');
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      console.error('Stripe timeout URL:', page.url());
      console.error('Stripe timeout page:', (await page.locator('body').innerText().catch(() => '')).slice(-2500));
      console.error('Stripe timeout screenshot:', screenshot);
      throw error;
    }
    const confirmationResponse = await confirmationResponsePromise;
    if (confirmationResponse.waitError) throw confirmationResponse.waitError;
    if (!confirmationResponse.ok()) {
      throw new Error(`Payment confirmation returned ${confirmationResponse.status()}: ${await confirmationResponse.text()}`);
    }
    await page.waitForSelector('.confirmation-payment-status', { timeout: 30000 });
    await assertNoHorizontalOverflow(page, 'appointment success');
    assert.match(await page.locator('body').textContent(), /Deposit paid/i);

    const { data: bookings, error: bookingError } = await admin
      .from('appointment_bookings')
      .select('*')
      .eq('customer_id', userId)
      .order('created_at', { ascending: false });
    if (bookingError) throw bookingError;
    assert.ok(bookings.length >= 1, 'No appointment booking was saved.');
    bookingIds = bookings.map((booking) => booking.id);
    const paid = bookings.find((booking) => booking.payment_status === 'paid_deposit');
    assert.ok(paid, 'No booking was marked paid_deposit.');
    assert.strictEqual(paid.booking_status, 'Confirmed');
    assert.ok(paid.stripe_session_id, 'The Stripe session id was not saved.');
    assert.strictEqual(Number(paid.total_with_hst), 192.1);

    await page.goto(`${SITE}/account.html`, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(page, 'account appointment history');
    const history = page.locator('[data-booking-history]');
    await history.locator('.appointment-history-item').first().waitFor({ timeout: 20000 });
    assert.match(await history.textContent(), /On-rim swap/);
    assert.match(await history.textContent(), /Deposit paid/);
    assert.match(await history.textContent(), /\$192\.10/);
    assert.deepStrictEqual(browserErrors, []);

    console.log(`ok  signed-in multi-service booking reached Stripe test checkout`);
    console.log(`ok  Stripe test deposit completed for ${slot.date} ${slot.time}`);
    console.log(`ok  Supabase booking is Confirmed with paid_deposit`);
    console.log(`ok  paid appointment appears in account history`);
  } finally {
    await browser.close();
    if (bookingIds.length) {
      await admin.from('appointment_bookings').delete().in('id', bookingIds);
    }
    if (userId) {
      const { error: deleteBookingsError } = await admin.from('appointment_bookings').delete().eq('customer_id', userId);
      if (deleteBookingsError) throw deleteBookingsError;
      const { error: deleteProfileError } = await admin.from('customer_profiles').delete().eq('id', userId);
      if (deleteProfileError) throw deleteProfileError;
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
      if (deleteUserError) throw deleteUserError;

      const { count: bookingCount, error: bookingCleanupError } = await admin
        .from('appointment_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', userId);
      if (bookingCleanupError) throw bookingCleanupError;
      assert.strictEqual(bookingCount, 0, 'Temporary appointment bookings were not removed.');

      const { count: profileCount, error: profileCleanupError } = await admin
        .from('customer_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('id', userId);
      if (profileCleanupError) throw profileCleanupError;
      assert.strictEqual(profileCount, 0, 'Temporary appointment profile was not removed.');
      console.log('ok  temporary appointment bookings, profile, and user were removed');
    }
  }
}

main().catch((error) => {
  console.error(`FAIL signed-in appointment checkout: ${error.stack || error.message}`);
  process.exit(1);
});
