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

function getSessionBookingIds(session) {
  const ids = [];
  const rawIds = session.metadata?.supabase_booking_ids;

  if (rawIds) {
    try {
      const parsed = JSON.parse(rawIds);
      if (Array.isArray(parsed)) ids.push(...parsed.filter(Boolean));
    } catch (error) {
      console.error('[EastCord appointment automation] Could not parse metadata.supabase_booking_ids.', {
        sessionId: session.id,
        rawIds,
        message: error.message,
      });
    }
  }

  if (session.metadata?.supabase_booking_id) ids.push(session.metadata.supabase_booking_id);
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

function supabaseErrorPayload(error) {
  return {
    code: error?.code || '',
    message: error?.message || '',
    details: error?.details || '',
    hint: error?.hint || '',
  };
}

function buildDiagnostics({ bookingId, sessionId, row, rowFound, error, updatePayload }) {
  return {
    bookingId,
    sessionId,
    rowFound: Boolean(rowFound),
    currentPaymentStatus: row?.payment_status ?? null,
    currentBookingStatus: row?.booking_status ?? null,
    currentStripeSessionId: row?.stripe_session_id ?? null,
    availableColumns: row ? Object.keys(row) : [],
    updatePayload,
    supabaseError: supabaseErrorPayload(error),
  };
}

function buildUpdatePayload(row, session) {
  const columns = new Set(Object.keys(row || {}));
  const payload = {};

  if (columns.has('payment_status')) payload.payment_status = 'paid_deposit';
  if (columns.has('stripe_session_id')) payload.stripe_session_id = session.id;
  if (columns.has('updated_at')) payload.updated_at = new Date().toISOString();
  if (columns.has('booking_status')) payload.booking_status = 'Confirmed';

  return payload;
}

async function updateBookingPaymentStatus({ supabaseAdmin, bookingId, session }) {
  const { data: existingRow, error: readError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();

  if (readError) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: null,
      rowFound: false,
      error: readError,
      updatePayload: null,
    });
    console.error('[EastCord appointment automation] Supabase booking row read failed before webhook update.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  if (!existingRow) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: null,
      rowFound: false,
      error: null,
      updatePayload: null,
    });
    console.error('[EastCord appointment automation] Supabase booking row was not found before webhook update.', diagnostics);
    return { ok: false, statusCode: 404, diagnostics };
  }

  console.log('[EastCord appointment automation] Supabase booking row found before webhook update.', {
    bookingId,
    sessionId: session.id,
    currentPaymentStatus: existingRow.payment_status ?? null,
    currentBookingStatus: existingRow.booking_status ?? null,
    currentStripeSessionId: existingRow.stripe_session_id ?? null,
    availableColumns: Object.keys(existingRow),
  });

  const updatePayload = buildUpdatePayload(existingRow, session);

  if (!Object.keys(updatePayload).length) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: existingRow,
      rowFound: true,
      error: null,
      updatePayload,
    });
    console.error('[EastCord appointment automation] No supported payment columns exist on appointment_bookings.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from('appointment_bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .select(Object.keys(updatePayload).concat('id').join(','))
    .maybeSingle();

  if (updateError) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: existingRow,
      rowFound: true,
      error: updateError,
      updatePayload,
    });
    console.error('[EastCord appointment automation] Supabase payment status update failed.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  if (!updatedRow) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: existingRow,
      rowFound: true,
      error: null,
      updatePayload,
    });
    console.error('[EastCord appointment automation] Supabase payment status update returned no row.', diagnostics);
    return { ok: false, statusCode: 404, diagnostics };
  }

  console.log('[EastCord appointment automation] Supabase payment status update success.', {
    bookingId: updatedRow.id,
    paymentStatus: updatedRow.payment_status ?? null,
    bookingStatus: updatedRow.booking_status ?? null,
    stripeSessionId: updatedRow.stripe_session_id ?? null,
    updatedColumns: Object.keys(updatePayload),
  });

  return {
    ok: true,
    bookingId: updatedRow.id,
    paymentStatus: updatedRow.payment_status ?? null,
    bookingStatus: updatedRow.booking_status ?? null,
    updatedColumns: Object.keys(updatePayload),
  };
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
  const bookingIds = getSessionBookingIds(session);

  console.log('[EastCord appointment automation] Stripe checkout.session.completed received.', {
    sessionId: session.id,
    bookingIdsFound: bookingIds.length,
    paymentStatus: session.payment_status,
  });

  if (!bookingIds.length) {
    console.error('[EastCord appointment automation] Missing Supabase booking id metadata on Stripe session.', {
      sessionId: session.id,
    });
    return json(400, { message: 'Missing Supabase booking id in Stripe metadata.' });
  }

  const results = [];
  for (const bookingId of bookingIds) {
    results.push(await updateBookingPaymentStatus({ supabaseAdmin, bookingId, session }));
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    return json(failed[0].statusCode || 500, {
      message: 'Booking payment status could not be updated.',
      results,
    });
  }

  return json(200, {
    received: true,
    eventType: stripeEvent.type,
    bookingIds: results.map((result) => result.bookingId),
    updatedCount: results.length,
    paymentStatus: 'paid_deposit',
    bookingStatus: 'Confirmed',
  });
};
