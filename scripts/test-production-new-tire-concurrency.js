#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ENDPOINT = 'https://eastcordtires.ca/.netlify/functions/save-new-tire-widget-order';
const TEST_EMAIL = `eastcord-production-concurrency-${Date.now()}@example.com`;
const TEST_PASSWORD = `EastCord-Production-Test-${Date.now()}!`;
const ORDER_NUMBER = `production-concurrency-${Date.now()}`;

function loadEnvironment() {
  for (const file of ['.env', path.join('.netlify', '.env')]) {
    const fullPath = path.join(__dirname, '..', file);
    if (!fs.existsSync(fullPath)) continue;
    fs.readFileSync(fullPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
      if (!match || process.env[match[1]]) return;
      let value = match[2].trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    });
  }
}

async function request(body, token = '') {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  return {
    status: response.status,
    json: await response.json().catch(() => ({})),
  };
}

async function main() {
  loadEnvironment();
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authConfig = fs.readFileSync(path.join(__dirname, '..', 'auth-config.js'), 'utf8');
  const anonKey = authConfig.match(/"supabaseAnonKey":\s*"([^"]+)"/)?.[1];
  assert.ok(url && serviceKey && anonKey, 'Supabase production test credentials are unavailable.');

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let userId = '';
  let orderId = '';

  try {
    const noAuth = await request('{}');
    assert.strictEqual(noAuth.status, 401);

    const badToken = await request('{}', 'not-a-valid-jwt');
    assert.strictEqual(badToken.status, 401);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'EastCord Production Concurrency Test' },
    });
    if (createError) throw createError;
    userId = created.user.id;

    const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (signInError) throw signInError;
    const token = signedIn.session.access_token;

    const malformed = await request('{', token);
    assert.strictEqual(malformed.status, 400);

    const missingCustomer = await request(JSON.stringify({ items: [] }), token);
    assert.strictEqual(missingCustomer.status, 400);

    const payload = JSON.stringify({
      customer: {
        name: 'EastCord Production Concurrency Test',
        email: TEST_EMAIL,
        phone: '905-555-0199',
      },
      items: [{
        brand: 'Mirage',
        model: 'MR-182',
        size: '225/45R18',
        qty: 4,
        unitPrice: 95.40,
      }],
      fulfillment: 'Pickup',
      vehicle: {},
      notes: 'AUTOMATED PRODUCTION CONCURRENCY TEST - SAFE TO DELETE',
      orderNumber: ORDER_NUMBER,
      recordedLocally: true,
      totals: { subtotal: 381.60, tax: 49.61, total: 431.21 },
      appointments: [],
    });

    const responses = await Promise.all(
      Array.from({ length: 40 }, () => request(payload, token)),
    );
    assert.ok(responses.every((result) => result.status === 200), JSON.stringify(responses));
    const orderIds = new Set(responses.map((result) => result.json.orderId).filter(Boolean));
    assert.strictEqual(orderIds.size, 1, 'Concurrent requests returned different order IDs.');
    orderId = [...orderIds][0];
    assert.strictEqual(responses.filter((result) => result.json.alreadySaved === false).length, 1);
    assert.strictEqual(responses.filter((result) => result.json.alreadySaved === true).length, 39);

    const { data: rows, error: rowError } = await admin
      .from('new_tire_orders')
      .select('id, customer_id, stripe_session_id, items, total_with_hst')
      .eq('stripe_session_id', `tireconnect:${ORDER_NUMBER}`);
    if (rowError) throw rowError;
    assert.strictEqual(rows.length, 1, 'Production database contains more than one test order.');
    assert.strictEqual(rows[0].customer_id, userId);
    assert.strictEqual(Number(rows[0].total_with_hst), 431.21);
    assert.strictEqual(rows[0].items?.[0]?.model, 'MR-182');

    console.log('ok  unauthenticated and invalid-token requests return 401');
    console.log('ok  malformed and incomplete authenticated requests return 400');
    console.log('ok  40 concurrent production submissions created exactly one order');
    console.log('ok  all duplicate responses returned the same production order ID');
    console.log('ok  production database persisted normalized tire and total data');
  } finally {
    if (orderId) {
      const { error: deleteOrderError } = await admin.from('new_tire_orders').delete().eq('id', orderId);
      if (deleteOrderError) throw deleteOrderError;
    }
    if (userId) {
      const { error: deleteProfileError } = await admin.from('customer_profiles').delete().eq('id', userId);
      if (deleteProfileError) throw deleteProfileError;
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
      if (deleteUserError) throw deleteUserError;
    }
    const { count, error: cleanupCheckError } = await admin
      .from('new_tire_orders')
      .select('id', { count: 'exact', head: true })
      .eq('stripe_session_id', `tireconnect:${ORDER_NUMBER}`);
    if (cleanupCheckError) throw cleanupCheckError;
    assert.strictEqual(count, 0, 'Temporary production order was not removed.');
    console.log('ok  temporary production order, profile, and user were removed');
  }
}

main().catch((error) => {
  console.error('FAIL production concurrency:', error);
  process.exit(1);
});
