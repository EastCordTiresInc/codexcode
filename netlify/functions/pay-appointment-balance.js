const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { isStripeTestMode } = require('./lib/stripe-mode');

const CLOSED_STATUSES = new Set(['Cancelled', 'Abandoned', 'No-show']);

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

function text(value) {
  return String(value ?? '').trim();
}

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
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

async function openBalanceSession(stripe, params, bookingId) {
  const idempotencyKey = `appointment-balance-${bookingId}`;
  try {
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
    if ((session.status === 'open' && session.url) || session.payment_status === 'paid') return session;
  } catch (error) {
    console.error('[EastCord appointment balance] Existing checkout could not be reused.', error.message);
  }
  return stripe.checkout.sessions.create(params);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { message: 'Stripe checkout is missing STRIPE_SECRET_KEY.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid checkout request.' });
  }

  const bookingId = text(payload.bookingId);
  if (!bookingId) return json(400, { message: 'Choose the appointment you want to finish paying.' });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Supabase admin configuration is missing.' });

  const token = getBearerToken(event);
  if (!token) return json(401, { message: 'Please log in before paying the remaining balance.' });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userError ? null : userData?.user;
  if (!user) return json(401, { message: 'Please log in before paying the remaining balance.' });

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id, customer_id, customer_email, service_name, deposit_amount, remaining_balance, payment_status, booking_status')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error('[EastCord appointment balance] Booking lookup failed.', bookingError.message);
    return json(500, { message: 'The appointment could not be loaded.' });
  }
  if (!booking || booking.customer_id !== user.id) {
    return json(404, { message: 'That appointment is not on this account.' });
  }
  if (CLOSED_STATUSES.has(booking.booking_status)) {
    return json(400, { message: 'This appointment is no longer open for online payment.' });
  }
  if (booking.payment_status !== 'paid_deposit') {
    return json(400, { message: 'Pay the deposit from your cart before paying the rest.' });
  }

  const remaining = roundMoney(booking.remaining_balance);
  if (remaining <= 0) return json(400, { message: 'This appointment is already paid in full.' });

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const unitAmount = Math.round(remaining * 100);
  const params = {
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: text(booking.customer_email || user.email),
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: `${text(booking.service_name) || 'Appointment'} - Remaining balance`,
          description: 'Remaining appointment balance, including applicable HST.',
        },
        unit_amount: unitAmount,
      },
      quantity: 1,
    }],
    success_url: `${siteUrl}/appointment-success.html?session_id={CHECKOUT_SESSION_ID}&paid=balance`,
    cancel_url: `${siteUrl}/account.html`,
    metadata: {
      order_type: 'appointment_balance',
      supabase_booking_id: booking.id,
      customer_id: user.id,
      balance_amount: remaining.toFixed(2),
    },
  };

  try {
    const session = await openBalanceSession(stripe, params, booking.id);
    if (session.payment_status === 'paid') {
      return json(409, { message: 'A payment for this balance is already complete. Refresh your account.' });
    }
    if (!session.url) return json(500, { message: 'Secure checkout could not be started.' });
    return json(200, { url: session.url, testMode: isStripeTestMode() });
  } catch (error) {
    console.error('[EastCord appointment balance] Stripe session failed.', error.message);
    return json(500, { message: error.message || 'Secure checkout could not be started.' });
  }
};
