const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { calculateTax, roundMoney } = require('./lib/used-tire-order');
const { getUsedTireUnitPrice, isMarkdownStock } = require('./lib/used-tire-pricing');

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

function normalizeCartItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      inventoryId: String(item.inventoryId || item.id || '').replace(/^used-tire-/i, '').trim(),
      qty: Math.max(1, Math.min(4, Number(item.qty) || 1)),
      brand: String(item.brand || '').trim(),
      size: String(item.size || '').trim(),
    }))
    .filter((item) => item.inventoryId);
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
  const cartItems = normalizeCartItems(payload.items);
  const fulfillmentPreference = payload.fulfillmentPreference === 'Installation' ? 'Installation' : 'Pickup';

  if (!cartItems.length) return json(400, { message: 'Add at least one used tire before checkout.' });
  if (!required(customer.customerId) || !required(customer.email) || !required(customer.name) || !required(customer.phone)) {
    return json(400, { message: 'Please complete your name, email, and phone before checkout.' });
  }

  const verifiedUser = await getVerifiedUser(event, supabaseAdmin);
  if (!verifiedUser || verifiedUser.id !== customer.customerId) {
    return json(401, { message: 'Please log in before buying used tires.' });
  }

  const preparedItems = [];
  for (const item of cartItems) {
    const { data: row, error } = await supabaseAdmin
      .from('usedtireinventory')
      .select('id, brand, tire_size, selling_price, current_stock')
      .eq('id', item.inventoryId)
      .maybeSingle();

    if (error) return json(500, { message: error.message });
    const stock = Math.max(0, Number(row?.current_stock) || 0);
    const listPrice = Number(row?.selling_price);
    const price = getUsedTireUnitPrice(listPrice, stock);
    if (!row || !stock || price === null) {
      return json(409, { message: `${item.brand || 'A selected tire'} is no longer available. Remove it and try again.` });
    }
    if (item.qty > stock) {
      return json(409, { message: `Only ${stock} ${row.brand} ${row.tire_size} tire(s) are left.` });
    }

    const markdown = isMarkdownStock(stock);
    preparedItems.push({
      inventoryId: row.id,
      qty: item.qty,
      brand: row.brand || item.brand,
      size: row.tire_size || item.size,
      listPrice: roundMoney(listPrice),
      unitPrice: price,
      markdown,
      lineTotal: roundMoney(price * item.qty),
    });
  }

  const subtotal = roundMoney(preparedItems.reduce((sum, item) => sum + item.lineTotal, 0));
  const amounts = calculateTax(subtotal);

  const { data: order, error: orderError } = await supabaseAdmin
    .from('used_tire_orders')
    .insert({
      customer_id: verifiedUser.id,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_phone: customer.phone,
      fulfillment_preference: fulfillmentPreference,
      items: preparedItems,
      subtotal: amounts.subtotal,
      hst_amount: amounts.hstAmount,
      total_with_hst: amounts.totalWithHst,
      tax_rate: amounts.taxRate,
      payment_status: 'pending_checkout',
      fulfillment_status: 'unfulfilled',
    })
    .select('id')
    .single();

  if (orderError || !order) {
    return json(500, { message: orderError?.message || 'The used tire order could not be created. Run supabase/used-tire-orders-schema.sql in Supabase first.' });
  }

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: [
        ...preparedItems.map((item) => ({
          price_data: {
            currency: 'cad',
            product_data: {
              name: `${item.brand} ${item.size} used tire${item.markdown ? ' — 20% off' : ''}`,
              description: `Quantity ${item.qty}${item.markdown ? ' · low-stock markdown' : ''}`,
            },
            unit_amount: Math.round(item.unitPrice * 100),
          },
          quantity: item.qty,
        })),
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: 'HST 13%',
            },
            unit_amount: Math.round(amounts.hstAmount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/tire-reservation-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/tire-cart.html`,
      metadata: {
        order_type: 'used_tire',
        order_id: order.id,
        customer_id: verifiedUser.id,
      },
    });

    await supabaseAdmin
      .from('used_tire_orders')
      .update({
        stripe_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    return json(200, { url: session.url });
  } catch (error) {
    console.error('[EastCord used tires] Stripe Checkout session creation failed.', error);
    return json(500, { message: error.message || 'Secure checkout could not be started.' });
  }
};
