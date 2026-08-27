const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { isStripeTestMode } = require('./lib/stripe-mode');
const { roundMoney } = require('./lib/new-tire-order');

const MAX_UNIT_PRICE = 2500;
const MAX_QTY = 8;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function getSiteUrl(event) {
  const origin = event.headers.origin || event.headers.Origin;
  if (origin) return origin.replace(/\/$/, '');

  const host = event.headers.host || event.headers.Host || '';
  const isLocal = /localhost|127\.0\.0\.1/i.test(host);
  if (host) return `${isLocal ? 'http' : 'https'}://${host}`.replace(/\/$/, '');
  return 'http://localhost:8888';
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getVerifiedUser(event, supabaseAdmin) {
  if (!supabaseAdmin) return null;
  const token = getBearerToken(event);
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const qty = Math.max(1, Math.min(MAX_QTY, Number(item.qty) || 1));
      const unitPrice = roundMoney(item.unitPrice ?? item.price ?? 0);
      return {
        kind: 'new_tire',
        brand: String(item.brand || '').trim(),
        model: String(item.model || '').trim(),
        size: String(item.size || '').trim(),
        qty,
        unitPrice,
        price: unitPrice,
        partNumber: String(item.partNumber || item.part_number || '').trim(),
        lineTotal: roundMoney(unitPrice * qty),
      };
    })
    .filter((item) => (item.brand || item.model || item.size) && item.unitPrice > 0 && item.unitPrice <= MAX_UNIT_PRICE);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { message: 'Stripe checkout is missing STRIPE_SECRET_KEY. Add your test secret key to .netlify/.env and restart npm run dev.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Supabase admin configuration is missing.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid checkout request.' });
  }

  const customer = payload.customer || {};
  const preparedItems = normalizeItems(payload.items);
  const fulfillmentPreference = payload.fulfillment === 'Installation' || payload.fulfillmentPreference === 'Installation'
    ? 'Installation'
    : 'Pickup';
  const vehicle = payload.vehicle && typeof payload.vehicle === 'object' ? payload.vehicle : {};

  if (!preparedItems.length) {
    return json(400, { message: 'Tap Add to Cart on a tire with a price before paying.' });
  }
  if (!required(customer.customerId) || !required(customer.email) || !required(customer.name) || !required(customer.phone)) {
    return json(400, { message: 'Please complete your name, email, and phone before checkout.' });
  }

  const verifiedUser = await getVerifiedUser(event, supabaseAdmin);
  if (!verifiedUser || verifiedUser.id !== customer.customerId) {
    return json(401, { message: 'Please log in before buying new tires.' });
  }

  const subtotal = roundMoney(preparedItems.reduce((sum, item) => sum + item.lineTotal, 0));
  if (subtotal <= 0) {
    return json(400, { message: 'The selected tires do not have a price we can charge.' });
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('new_tire_orders')
    .insert({
      customer_id: verifiedUser.id,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone,
      fulfillment_preference: fulfillmentPreference,
      items: preparedItems,
      vehicle,
      notes: String(payload.notes || '').trim(),
      subtotal,
      hst_amount: 0,
      total_with_hst: subtotal,
      tax_rate: 0,
      payment_status: 'pending_checkout',
      fulfillment_status: 'unfulfilled',
    })
    .select('id')
    .single();

  if (orderError || !order) {
    return json(500, { message: orderError?.message || 'The new tire order could not be created. Run supabase/new-tire-orders-schema.sql in Supabase first.' });
  }

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: preparedItems.map((item) => ({
        price_data: {
          currency: 'cad',
          product_data: {
            name: [item.brand, item.model, item.size].filter(Boolean).join(' ') || 'New tire',
            description: `Quantity ${item.qty}${item.partNumber ? ` · ${item.partNumber}` : ''} · ${fulfillmentPreference}`,
          },
          unit_amount: Math.round(item.unitPrice * 100),
        },
        quantity: item.qty,
      })),
      success_url: `${siteUrl}/new-tire-order-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/new-tires.html`,
      metadata: {
        order_type: 'new_tire',
        order_id: order.id,
        customer_id: verifiedUser.id,
      },
    });

    await supabaseAdmin
      .from('new_tire_orders')
      .update({
        stripe_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    return json(200, { url: session.url, testMode: isStripeTestMode() });
  } catch (error) {
    console.error('[EastCord new tires] Stripe Checkout session creation failed.', error);
    return json(500, { message: error.message || 'Secure checkout could not be started.' });
  }
};
