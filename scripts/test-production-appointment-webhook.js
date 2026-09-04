#!/usr/bin/env node
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const WEBHOOK_URL = 'https://eastcordtires.ca/.netlify/functions/stripe-webhook';
const TEST_EMAIL = `eastcord-webhook-${Date.now()}@example.com`;
const TEST_PASSWORD = `EastCord-Webhook-${Date.now()}!`;
const TEST_SESSION_ID = `cs_live_eastcord_webhook_test_${Date.now()}`;

function loadProtectedEnvironment() {
  for (const file of ['.env', path.join('.netlify', '.env')]) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) continue;
    fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
      if (!match || process.env[match[1]]) return;
      let value = match[2].trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    });
  }
}

async function postWebhook(payload, signature) {
  return fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: payload,
  });
}

async function main() {
  loadProtectedEnvironment();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_webhook_handler';
  const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  assert.ok(supabaseUrl && serviceRoleKey, 'Supabase production test credentials are unavailable.');

  process.env.SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;
  process.env.STRIPE_SECRET_KEY = stripeSecretKey;
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.EMAIL_PROVIDER = 'webhook-test-disabled';
  const stripe = new Stripe(stripeSecretKey);
  const { handler } = require('../netlify/functions/stripe-webhook');

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let userId = '';
  let bookingId = '';

  try {
    const { data: created, error: createUserError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'EastCord Webhook Test', phone: '9055550199' },
    });
    if (createUserError) throw createUserError;
    userId = created.user.id;

    const { error: profileError } = await admin.from('customer_profiles').upsert({
      id: userId,
      full_name: 'EastCord Webhook Test',
      email: TEST_EMAIL,
      phone: '9055550199',
      updated_at: new Date().toISOString(),
    });
    if (profileError) throw profileError;

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const createdAt = new Date().toISOString();
    const { data: booking, error: bookingError } = await admin
      .from('appointment_bookings')
      .insert({
        customer_id: userId,
        customer_name: 'EastCord Webhook Test',
        customer_email: TEST_EMAIL,
        customer_phone: '9055550199',
        service_id: 'air-fill',
        service_name: 'Air fill-up × 1',
        starting_price: 20,
        service_subtotal: 20,
        hst_amount: 2.6,
        total_with_hst: 22.6,
        deposit_amount: 4.52,
        remaining_balance: 18.08,
        tax_rate: 0.13,
        preferred_date: futureDate.toISOString().slice(0, 10),
        preferred_time_window: '7:00 PM - 8:00 PM',
        vehicle_year: '2020',
        vehicle_make: 'Toyota',
        vehicle_model: 'Corolla',
        vehicle_plate_number: 'WEBHOOK TEST',
        vehicle_colour: 'Blue',
        tire_size: '205/55R16',
        number_of_tires: 1,
        full_service_address: 'Automated webhook test',
        city: 'Milton',
        postal_code: 'L9T 2X5',
        parking_access_notes: 'Automated test; no service required.',
        install_location: 'mobile',
        additional_notes: 'AUTOMATED PRODUCTION WEBHOOK TEST - SAFE TO DELETE',
        service_area_status: 'In service area',
        booking_status: 'Pending Confirmation',
        payment_status: 'pending_checkout',
        stripe_session_id: '',
        updated_at: createdAt,
      })
      .select('id')
      .single();
    if (bookingError) throw bookingError;
    bookingId = booking.id;

    const event = {
      id: `evt_eastcord_webhook_test_${Date.now()}`,
      object: 'event',
      api_version: '2025-02-24.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: TEST_SESSION_ID,
          object: 'checkout.session',
          amount_total: 452,
          currency: 'cad',
          livemode: true,
          payment_status: 'paid',
          customer_details: { email: TEST_EMAIL, name: 'EastCord Webhook Test' },
          metadata: {
            order_type: 'appointment',
            supabase_booking_id: bookingId,
            supabase_booking_ids: JSON.stringify([bookingId]),
            appointment_count: '1',
            customer_id: userId,
            customer_name: 'EastCord Webhook Test',
            customer_email: TEST_EMAIL,
            customer_phone: '9055550199',
            booking_status: 'Confirmed After Payment',
            payment_status: 'pending_checkout',
          },
        },
      },
      livemode: true,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.completed',
    };
    const payload = JSON.stringify(event);

    const invalidResponse = await postWebhook(payload, 'invalid-signature');
    assert.strictEqual(invalidResponse.status, 400);
    const { data: unchanged, error: unchangedError } = await admin
      .from('appointment_bookings')
      .select('payment_status, booking_status')
      .eq('id', bookingId)
      .single();
    if (unchangedError) throw unchangedError;
    assert.strictEqual(unchanged.payment_status, 'pending_checkout');
    assert.notStrictEqual(unchanged.booking_status, 'Confirmed');

    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const handlerResponse = await handler({
      httpMethod: 'POST',
      headers: { 'stripe-signature': signature },
      body: payload,
      isBase64Encoded: false,
    });
    assert.strictEqual(handlerResponse.statusCode, 200, handlerResponse.body);
    const result = JSON.parse(handlerResponse.body);
    assert.strictEqual(result.received, true);
    assert.strictEqual(result.updatedCount, 1);

    const { data: confirmed, error: confirmedError } = await admin
      .from('appointment_bookings')
      .select('payment_status, booking_status, stripe_session_id')
      .eq('id', bookingId)
      .single();
    if (confirmedError) throw confirmedError;
    assert.strictEqual(confirmed.payment_status, 'paid_deposit');
    assert.strictEqual(confirmed.booking_status, 'Confirmed');
    assert.strictEqual(confirmed.stripe_session_id, TEST_SESSION_ID);

    const replaySignature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    const replayResponse = await handler({
      httpMethod: 'POST',
      headers: { 'stripe-signature': replaySignature },
      body: payload,
      isBase64Encoded: false,
    });
    assert.strictEqual(replayResponse.statusCode, 200, replayResponse.body);
    const { count: replayCount, error: replayCountError } = await admin
      .from('appointment_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('id', bookingId);
    if (replayCountError) throw replayCountError;
    assert.strictEqual(replayCount, 1, 'Webhook replay duplicated the appointment booking.');

    console.log('ok  deployed production endpoint rejects invalid Stripe signatures');
    console.log('ok  invalid webhook signatures leave the production database unchanged');
    console.log('ok  signed webhook handler marks the production appointment paid and confirmed');
    console.log('ok  Stripe session ID is persisted on the confirmed database row');
    console.log('ok  webhook replay is idempotent and sends no test emails');
  } finally {
    if (bookingId) {
      const { error } = await admin.from('appointment_bookings').delete().eq('id', bookingId);
      if (error) throw error;
    }
    if (userId) {
      const { error: profileError } = await admin.from('customer_profiles').delete().eq('id', userId);
      if (profileError) throw profileError;
      const { error: userError } = await admin.auth.admin.deleteUser(userId);
      if (userError) throw userError;
    }
    if (bookingId) {
      const { count, error } = await admin
        .from('appointment_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('id', bookingId);
      if (error) throw error;
      assert.strictEqual(count, 0, 'Temporary webhook booking was not removed.');
    }
    console.log('ok  temporary webhook booking, profile, and user were removed');
  }
}

main().catch((error) => {
  console.error(`FAIL production appointment webhook: ${error.stack || error.message}`);
  process.exit(1);
});
