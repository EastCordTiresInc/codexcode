const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const STRIPE_KEY_MISSING_MESSAGE = 'Stripe checkout is missing STRIPE_SECRET_KEY in Netlify environment variables.';

const SERVICES = {
  'seasonal-changeover-rims': { name: 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims', startingPrice: 40 },
  'seasonal-swap-not-mounted': { name: 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims', startingPrice: 80 },
  'mount-balance-1': { name: 'Mount & Balance - 1 Tire', startingPrice: 25 },
  'mount-balance-2': { name: 'Mount & Balance - 2 Tires', startingPrice: 50 },
  'mount-balance-3': { name: 'Mount & Balance - 3 Tires', startingPrice: 75 },
  'mount-balance-4': { name: 'Mount & Balance - 4 Tires', startingPrice: 100 },
};

const SERVICE_AREA_CITIES = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);

function logDeveloperError(context, details) {
  console.error(`[EastCord appointment automation] ${context}`, details);
}

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

function getSiteUrl(event) {
  const origin = event.headers.origin || event.headers.Origin;
  const host = event.headers.host || event.headers.Host;
  const configuredUrl = process.env.DEPLOY_PRIME_URL || process.env.URL;
  if (origin) return origin.replace(/\/$/, '');
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
  if (host) return `https://${host}`.replace(/\/$/, '');
  return 'https://eastcordtires.ca';
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[EastCord appointment automation] Supabase admin variables are missing; checkout will continue without server-side booking update.', {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function moneyAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

async function getVerifiedUser(event, supabaseAdmin) {
  if (!supabaseAdmin) return null;

  const token = getBearerToken(event);
  if (!token) return null;

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    logDeveloperError('Supabase token verification failed.', authError);
    return null;
  }

  return authData.user;
}

exports.handler = async (event) => {
  console.log('[EastCord appointment automation] create-appointment-checkout-session invoked.', {
    method: event.httpMethod,
    hasStripeSecret: Boolean(process.env.STRIPE_SECRET_KEY),
  });

  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });

  if (!process.env.STRIPE_SECRET_KEY) {
    logDeveloperError('STRIPE_SECRET_KEY is missing in Netlify environment variables.', { hasStripeSecret: false });
    return json(500, { message: STRIPE_KEY_MISSING_MESSAGE });
  }

  let booking;
  try {
    booking = JSON.parse(event.body || '{}');
  } catch (error) {
    logDeveloperError('Invalid checkout request body.', error);
    return json(400, { message: 'Invalid booking request.' });
  }

  const customer = booking.customer || {};
  if (!required(customer.customerId) || !required(customer.email)) {
    return json(401, { message: 'Please log in before checkout.' });
  }

  const service = SERVICES[booking.serviceId];
  if (!service) return json(400, { message: 'Please choose a valid tire service.' });
  if (!required(booking.bookingId)) return json(400, { message: 'Booking details must be saved before checkout can start.' });

  const requiredFields = [
    customer.customerId,
    customer.email,
    customer.phone,
    booking.preferredDate,
    booking.preferredTimeWindow,
    booking.vehicleYear,
    booking.vehicleMake,
    booking.vehicleModel,
    booking.tireSize,
    booking.tiresAlreadyOnRims,
    booking.numberOfTires,
    booking.fullServiceAddress,
    booking.city,
    booking.postalCode,
    booking.parkingAccessNotes,
  ];

  if (!requiredFields.every(required)) return json(400, { message: 'Please complete all required booking and account fields.' });

  if (!SERVICE_AREA_CITIES.has(booking.city)) {
    return json(400, { message: 'EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.' });
  }

  const selectedDate = new Date(`${booking.preferredDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
    return json(400, { message: 'Please choose today or a future appointment date.' });
  }

  const startingPrice = moneyAmount(booking.startingPrice || service.startingPrice);
  const depositAmount = moneyAmount(booking.depositAmount);
  const remainingBalance = moneyAmount(booking.remainingBalance || startingPrice - depositAmount);

  if (depositAmount <= 0) {
    return json(400, { message: 'The booking deposit amount is missing. Please return to the appointment page and add the service again.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const verifiedUser = await getVerifiedUser(event, supabaseAdmin);

  if (verifiedUser && verifiedUser.id !== customer.customerId) {
    return json(403, { message: 'This booking does not match the logged-in customer.' });
  }

  if (supabaseAdmin && verifiedUser) {
    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from('appointment_bookings')
      .select('id, customer_id, payment_status')
      .eq('id', booking.bookingId)
      .eq('customer_id', verifiedUser.id)
      .maybeSingle();

    if (bookingError || !bookingRow) {
      logDeveloperError('Saved booking row could not be found before checkout.', bookingError || { bookingId: booking.bookingId });
      return json(400, { message: 'Saved booking could not be found. Please add the appointment to cart again.' });
    }
  }

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `${service.name} - 20% Booking Deposit`,
              description: '20% booking deposit based on the selected starting price. Remaining balance is paid on-site after service.',
            },
            unit_amount: Math.round(depositAmount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/appointment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart.html`,
      metadata: {
        supabase_booking_id: String(booking.bookingId).slice(0, 500),
        customer_id: String(customer.customerId).slice(0, 500),
        customer_name: String(customer.name || '').slice(0, 500),
        customer_email: String(customer.email).slice(0, 500),
        customer_phone: String(customer.phone).slice(0, 500),
        booking_status: 'Pending Confirmation',
        payment_status: 'pending_checkout',
        service_area_status: 'In service area',
        service_id: booking.serviceId,
        service_name: service.name,
        starting_price: startingPrice.toFixed(2),
        deposit_amount: depositAmount.toFixed(2),
        remaining_balance: remainingBalance.toFixed(2),
        preferred_date: String(booking.preferredDate).slice(0, 500),
        preferred_time_window: String(booking.preferredTimeWindow).slice(0, 500),
        vehicle_year: String(booking.vehicleYear).slice(0, 500),
        vehicle_make: String(booking.vehicleMake).slice(0, 500),
        vehicle_model: String(booking.vehicleModel).slice(0, 500),
        tire_size: String(booking.tireSize).slice(0, 500),
        tires_already_on_rims: String(booking.tiresAlreadyOnRims).slice(0, 500),
        number_of_tires: String(booking.numberOfTires).slice(0, 500),
        city: String(booking.city).slice(0, 500),
        postal_code: String(booking.postalCode).slice(0, 500),
      },
    });

    if (supabaseAdmin && verifiedUser) {
      const { error: updateError } = await supabaseAdmin
        .from('appointment_bookings')
        .update({
          stripe_session_id: session.id,
          payment_status: 'pending_checkout',
          updated_at: new Date().toISOString(),
        })
        .eq('id', booking.bookingId)
        .eq('customer_id', verifiedUser.id);

      if (updateError) {
        logDeveloperError('Booking row could not be updated with Stripe session ID.', updateError);
      }
    }

    console.log('[EastCord appointment automation] Stripe Checkout session created.', {
      sessionId: session.id,
      hasUrl: Boolean(session.url),
      depositAmount,
    });

    // TODO: Add a Stripe webhook to update appointment_bookings.payment_status to paid_deposit after checkout.session.completed.
    return json(200, { url: session.url });
  } catch (error) {
    logDeveloperError('Stripe Checkout session creation failed.', {
      message: error.message,
      type: error.type,
      code: error.code,
    });
    return json(500, { message: error.message || 'Stripe Checkout could not be started. Please try again or contact EastCord Tires for help.' });
  }
};
