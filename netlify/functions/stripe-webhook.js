const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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

function getRawBody(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || '', 'base64').toString('utf8');
  }
  return event.body || '';
}

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  console.log('[EastCord appointment automation] Stripe webhook received.', {
    method: event.httpMethod,
    hasStripeSecret: Boolean(process.env.STRIPE_SECRET_KEY),
    hasWebhookSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });

  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[EastCord appointment automation] STRIPE_SECRET_KEY is missing for Stripe webhook.');
    return json(500, { message: 'Stripe secret key is missing.' });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[EastCord appointment automation] STRIPE_WEBHOOK_SECRET is missing for Stripe webhook signature verification.');
    return json(500, { message: 'Stripe webhook secret is missing.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error('[EastCord appointment automation] Supabase admin variables are missing for Stripe webhook update.');
    return json(500, { message: 'Supabase admin configuration is missing.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = getRawBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('[EastCord appointment automation] Stripe webhook signature verification failed.', {
      message: error.message,
    });
    return json(400, { message: 'Invalid Stripe webhook signature.' });
  }

  console.log('[EastCord appointment automation] Stripe webhook event type.', {
    eventType: stripeEvent.type,
  });

  if (stripeEvent.type !== 'checkout.session.completed') {
    return json(200, { received: true, ignored: true, eventType: stripeEvent.type });
  }

  const session = stripeEvent.data.object;
  const bookingId = session.metadata?.supabase_booking_id;

  console.log('[EastCord appointment automation] Stripe checkout.session.completed received.', {
    sessionId: session.id,
    bookingIdFound: Boolean(bookingId),
    paymentStatus: session.payment_status,
  });

  if (!bookingId) {
    console.error('[EastCord appointment automation] Missing metadata.supabase_booking_id on Stripe session.', {
      sessionId: session.id,
    });
    return json(400, { message: 'Missing Supabase booking id in Stripe metadata.' });
  }

  const { data, error } = await supabaseAdmin
    .from('appointment_bookings')
    .update({
      payment_status: 'paid_deposit',
      booking_status: 'Pending Confirmation',
      stripe_session_id: session.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select('id, payment_status, booking_status, stripe_session_id')
    .maybeSingle();

  if (error) {
    console.error('[EastCord appointment automation] Supabase payment status update failed.', {
      bookingId,
      sessionId: session.id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return json(500, { message: 'Booking payment status could not be updated.' });
  }

  if (!data) {
    console.error('[EastCord appointment automation] Supabase payment status update found no booking row.', {
      bookingId,
      sessionId: session.id,
    });
    return json(404, { message: 'Booking row was not found for Stripe session.' });
  }

  console.log('[EastCord appointment automation] Supabase payment status update success.', {
    bookingId: data.id,
    paymentStatus: data.payment_status,
    bookingStatus: data.booking_status,
    stripeSessionId: data.stripe_session_id,
  });

  return json(200, {
    received: true,
    eventType: stripeEvent.type,
    bookingId: data.id,
    paymentStatus: data.payment_status,
  });
};
