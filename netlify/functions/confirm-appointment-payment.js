const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { fulfillPaidAppointmentCheckout } = require('./stripe-webhook');

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

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { message: 'Stripe secret key is missing.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid confirmation request.' });
  }

  const sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) return json(400, { message: 'Missing Stripe session id.' });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Supabase admin configuration is missing.' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    return json(404, { message: 'Stripe checkout session was not found.' });
  }

  if (session.metadata?.order_type === 'used_tire') {
    return json(400, { message: 'This checkout session is a used tire order.' });
  }
  if (session.payment_status !== 'paid') {
    return json(202, { message: 'Payment is not complete yet.', paymentStatus: session.payment_status });
  }

  const result = await fulfillPaidAppointmentCheckout({ supabaseAdmin, session });
  if (!result.ok) {
    return json(result.statusCode || 500, { message: result.message || 'The paid appointment could not be confirmed.' });
  }

  return json(200, {
    ok: true,
    ignored: Boolean(result.ignored),
    bookingIds: result.bookingIds || [],
  });
};
