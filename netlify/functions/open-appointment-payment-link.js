const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { fulfillPaidAppointmentCheckout } = require('./stripe-webhook');
const {
  LINK_EXPIRED_MESSAGE,
  SLOT_REFUNDED_MESSAGE,
  SLOT_TAKEN_MESSAGE,
  expireCheckoutSession,
  linkStillOpen,
  paymentDeadlineMs,
  slotTakenBySomeoneElse,
  stripeExpiresAt,
} = require('./lib/payment-window');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function siteUrl(event) {
  const origin = event.headers.origin || event.headers.Origin;
  if (origin) return origin.replace(/\/$/, '');
  const host = event.headers.host || event.headers.Host || '';
  const local = /localhost|127\.0\.0\.1/i.test(host);
  if (host) return `${local ? 'http' : 'https'}://${host}`.replace(/\/$/, '');
  return String(process.env.URL || 'https://eastcordtires.ca').replace(/\/$/, '');
}

function supabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { message: 'Card payment is not available right now.' });

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid payment link.' });
  }

  const bookingId = String(payload.bookingId || '').trim();
  if (!UUID.test(bookingId)) return json(400, { message: 'This payment link is not valid.' });

  const db = supabaseAdmin();
  if (!db) return json(500, { message: 'The appointment could not be opened.' });

  const { data: row, error } = await db
    .from('appointment_bookings')
    .select('id, customer_name, customer_email, customer_phone, customer_id, service_name, preferred_date, preferred_time_window, vehicle_plate_number, full_service_address, city, install_location, total_with_hst, deposit_amount, remaining_balance, payment_status, booking_status, stripe_session_id, additional_notes, created_at')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    console.error('[EastCord appointment automation] Payment link lookup failed.', error.message);
    return json(500, { message: 'The appointment could not be opened.' });
  }
  const { data: phoneRow, error: phoneError } = await db
    .from('phone_appointments')
    .select('booking_id')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (phoneError) {
    console.warn('[EastCord appointment automation] Phone appointment lookup failed.', phoneError.message);
  }
  if (!row) return json(404, { message: 'This payment link is not valid.' });
  const bookedByPhone = Boolean(phoneRow) || /phone appointment/i.test(String(row.additional_notes || ''));
  if (!bookedByPhone) return json(404, { message: 'This payment link is not valid.' });
  if (String(row.booking_status || '') === 'Cancelled') {
    return json(409, { message: 'This appointment was cancelled.' });
  }

  const status = String(row.payment_status || '');
  const total = roundMoney(row.total_with_hst);
  if (status === 'paid_in_full' || (status === 'paid_deposit' && roundMoney(row.remaining_balance) <= 0)) {
    return json(200, {
      alreadyPaid: true,
      appointment: publicAppointment(row, total),
    });
  }
  if (!(total > 0 && total <= 20000)) {
    return json(400, { message: 'This appointment does not have a payable amount.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const deadline = paymentDeadlineMs(row.created_at);
  let openSession = null;
  if (row.stripe_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(row.stripe_session_id);
      if (existing.payment_status === 'paid') {
        const recorded = await fulfillPaidAppointmentCheckout({ supabaseAdmin: db, session: existing }).catch((recordError) => {
          console.error('[EastCord appointment automation] Paid payment link could not be recorded.', recordError.message || recordError);
          return null;
        });
        if (recorded && recorded.ok === false) {
          return json(recorded.statusCode || 409, { message: recorded.message || SLOT_REFUNDED_MESSAGE });
        }
        return json(200, { alreadyPaid: true, appointment: publicAppointment(row, total) });
      }
      const sessionEnd = Number(existing.expires_at || 0) * 1000;
      const endsOnTime = sessionEnd > 0 && sessionEnd <= deadline + 60000;
      if (existing.status === 'open' && existing.url && endsOnTime) openSession = existing;
      else if (existing.status === 'open') await expireCheckoutSession(stripe, existing.id);
    } catch (lookupError) {
      console.warn('[EastCord appointment automation] Saved payment session could not be reused.', lookupError.message || lookupError);
    }
  }
  if (!linkStillOpen(row.created_at)) {
    await expireCheckoutSession(stripe, row.stripe_session_id);
    return json(409, { message: LINK_EXPIRED_MESSAGE });
  }
  if (await slotTakenBySomeoneElse(db, row)) {
    await expireCheckoutSession(stripe, openSession?.id || row.stripe_session_id);
    return json(409, { message: SLOT_TAKEN_MESSAGE });
  }
  if (openSession) {
    return json(200, { url: openSession.url, appointment: publicAppointment(row, total) });
  }
  const expiresAt = stripeExpiresAt(row.created_at);
  if (!expiresAt) {
    return json(409, { message: LINK_EXPIRED_MESSAGE });
  }

  const origin = siteUrl(event);
  try {
    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: row.customer_email || undefined,
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: {
            name: `EastCord Tires: ${row.service_name || 'Appointment'}`,
            description: 'Full appointment payment, including applicable HST.',
          },
          unit_amount: Math.round(total * 100),
        },
        quantity: 1,
      }],
      branding_settings: {
        display_name: 'EastCord Tires',
        button_color: '#df1f2d',
      },
      custom_text: {
        submit: {
          message: 'This payment is for your EastCord Tires appointment.',
        },
      },
      expires_at: expiresAt,
      success_url: `${origin}/appointment-success.html?session_id={CHECKOUT_SESSION_ID}&paid=full`,
      cancel_url: `${origin}/pay/${bookingId}`,
      metadata: {
        order_type: 'appointment',
        payment_choice: 'full',
        supabase_booking_id: bookingId,
        supabase_booking_ids: JSON.stringify([bookingId]),
        appointment_count: '1',
        customer_id: String(row.customer_id || '').slice(0, 500),
        customer_name: String(row.customer_name || '').slice(0, 500),
        customer_email: String(row.customer_email || '').slice(0, 500),
        customer_phone: String(row.customer_phone || '').slice(0, 500),
        booking_status: 'Confirmed After Payment',
        payment_status: 'pending_checkout',
        total_with_hst: total.toFixed(2),
        total_deposit_amount: total.toFixed(2),
        total_remaining_balance: '0.00',
      },
    };
    let session;
    try {
      session = await stripe.checkout.sessions.create(sessionParams);
    } catch (checkoutError) {
      const rejectedBranding = /branding_settings|button_color|display_name/i.test(String(checkoutError?.message || ''));
      if (!rejectedBranding) throw checkoutError;
      const { branding_settings, ...withoutBranding } = sessionParams;
      session = await stripe.checkout.sessions.create(withoutBranding);
    }

    await db
      .from('appointment_bookings')
      .update({
        stripe_session_id: session.id,
        deposit_amount: total,
        remaining_balance: 0,
        payment_status: 'pending_checkout',
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId);

    return json(200, { url: session.url, appointment: publicAppointment(row, total) });
  } catch (stripeError) {
    console.error('[EastCord appointment automation] Payment link checkout failed.', stripeError.message || stripeError);
    return json(500, { message: 'Card payment could not be opened. Please try the link again.' });
  }
};

function publicAppointment(row, total) {
  const shop = String(row.install_location || '').toLowerCase() === 'shop';
  return {
    service: row.service_name || 'Appointment',
    date: row.preferred_date || '',
    time: row.preferred_time_window || '',
    place: shop
      ? 'EastCord shop, 600 Harrop Drive, Milton'
      : [row.full_service_address, row.city].filter(Boolean).join(', '),
    plate: row.vehicle_plate_number || '',
    total,
  };
}
