const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const SERVICES = {
  'seasonal-changeover-rims': { name: 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims', startingPrice: 40 },
  'seasonal-swap-not-mounted': { name: 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims', startingPrice: 80 },
  'mount-balance-1': { name: 'Mount & Balance - 1 Tire', startingPrice: 25 },
  'mount-balance-2': { name: 'Mount & Balance - 2 Tires', startingPrice: 50 },
  'mount-balance-3': { name: 'Mount & Balance - 3 Tires', startingPrice: 75 },
  'mount-balance-4': { name: 'Mount & Balance - 4 Tires', startingPrice: 100 },
};

const SERVICE_AREA_CITIES = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload),
  };
}

function getSiteUrl(event) {
  const origin = event.headers.origin || event.headers.Origin;
  const host = event.headers.host || event.headers.Host;
  if (origin) return origin;
  if (host) return `https://${host}`;
  return process.env.URL || 'https://eastcordtires.ca';
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return json(503, {
      message: 'Stripe Checkout is not configured yet. Add STRIPE_SECRET_KEY in Netlify environment variables before accepting online booking deposits.',
    });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return json(503, {
      message: 'Supabase booking backend is not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables.',
    });
  }

  let booking;
  try {
    booking = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid booking request.' });
  }

  const token = getBearerToken(event);
  if (!token) return json(401, { message: 'Please log in before checkout.' });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) return json(401, { message: 'Your login session could not be verified. Please log in again.' });

  const customer = booking.customer || {};
  if (customer.customerId !== authData.user.id) return json(403, { message: 'This booking does not match the logged-in customer.' });

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

  const { data: bookingRow, error: bookingError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id, customer_id, payment_status')
    .eq('id', booking.bookingId)
    .eq('customer_id', authData.user.id)
    .maybeSingle();

  if (bookingError || !bookingRow) {
    return json(400, { message: 'Saved booking could not be found for this customer. Please add the appointment to cart again.' });
  }

  const startingPrice = service.startingPrice;
  const depositAmount = startingPrice * 0.2;
  const remainingBalance = startingPrice - depositAmount;
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
      success_url: `${siteUrl}/appointment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/appointment-cancelled`,
      metadata: {
        supabase_booking_id: booking.bookingId,
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

    const { error: updateError } = await supabaseAdmin
      .from('appointment_bookings')
      .update({
        stripe_session_id: session.id,
        payment_status: 'pending_checkout',
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.bookingId)
      .eq('customer_id', authData.user.id);

    if (updateError) {
      return json(500, { message: 'Stripe Checkout was created, but the booking record could not be updated. Please contact EastCord Tires for help.' });
    }

    // TODO: Add a Stripe webhook to update appointment_bookings.payment_status to paid_deposit after checkout.session.completed.
    return json(200, { id: session.id, url: session.url, payment_status: session.payment_status });
  } catch (error) {
    return json(500, { message: 'Stripe Checkout could not be started. Please try again or contact EastCord Tires for help.' });
  }
};
