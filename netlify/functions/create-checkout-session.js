const Stripe = require('stripe');

const SERVICES = {
  'seasonal-changeover-rims': {
    name: 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims',
    startingPrice: 40,
  },
  'seasonal-swap-not-mounted': {
    name: 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims',
    startingPrice: 80,
  },
  'mount-balance-1': {
    name: 'Mount & Balance - 1 Tire',
    startingPrice: 25,
  },
  'mount-balance-2': {
    name: 'Mount & Balance - 2 Tires',
    startingPrice: 50,
  },
  'mount-balance-3': {
    name: 'Mount & Balance - 3 Tires',
    startingPrice: 75,
  },
  'mount-balance-4': {
    name: 'Mount & Balance - 4 Tires',
    startingPrice: 100,
  },
};

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

  if (origin) return origin;
  if (host) return `https://${host}`;
  return process.env.URL || 'https://eastcordtires.ca';
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  // TODO: Add STRIPE_SECRET_KEY in Netlify environment variables before enabling live deposit payment.
  // TODO: If Stripe.js is added later, expose STRIPE_PUBLIC_KEY or VITE_STRIPE_PUBLIC_KEY only as a public key.
  // TODO: This function creates the Stripe Checkout session for the 20% booking deposit.
  // TODO: Confirm success URL and cancel URL after the production domain and Stripe mode are finalized.
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(503, {
      message:
        'Stripe Checkout is not configured yet. Add STRIPE_SECRET_KEY in Netlify environment variables before accepting online booking deposits.',
    });
  }

  let booking;
  try {
    booking = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid booking request.' });
  }

  const service = SERVICES[booking.serviceId];
  if (!service) {
    return json(400, { message: 'Please choose a valid tire service.' });
  }

  const requiredFields = [
    booking.fullName,
    booking.email,
    booking.phone,
    booking.preferredDate,
    booking.preferredTimeWindow,
    booking.vehicleDetails,
    booking.tireSize,
    booking.serviceLocation,
    booking.city,
    booking.postalCode,
  ];

  if (!requiredFields.every(required)) {
    return json(400, { message: 'Please complete all required booking fields.' });
  }

  const selectedDate = new Date(`${booking.preferredDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (Number.isNaN(selectedDate.getTime()) || selectedDate < today) {
    return json(400, { message: 'Please choose today or a future appointment date.' });
  }

  if (selectedDate.getDay() === 0) {
    return json(400, { message: 'Sundays are not available for online appointment requests.' });
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
      customer_email: booking.email,
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `${service.name} - 20% Booking Deposit`,
              description:
                '20% booking deposit based on the selected starting price. Remaining balance is paid on-site after service.',
            },
            unit_amount: Math.round(depositAmount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/appointment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/appointment-cancelled`,
      metadata: {
        form_name: 'eastcord-changeover-appointment',
        booking_status: 'Pending Confirmation',
        service_id: booking.serviceId,
        service_name: service.name,
        starting_price: startingPrice.toFixed(2),
        deposit_amount: depositAmount.toFixed(2),
        remaining_balance: remainingBalance.toFixed(2),
        full_name: String(booking.fullName).slice(0, 500),
        phone: String(booking.phone).slice(0, 500),
        preferred_date: String(booking.preferredDate).slice(0, 500),
        preferred_time_window: String(booking.preferredTimeWindow).slice(0, 500),
        tire_size: String(booking.tireSize).slice(0, 500),
        city: String(booking.city).slice(0, 500),
        postal_code: String(booking.postalCode).slice(0, 500),
      },
    });

    return json(200, {
      id: session.id,
      url: session.url,
      payment_status: session.payment_status,
    });
  } catch (error) {
    return json(500, {
      message: 'Stripe Checkout could not be started. Please try again or contact EastCord Tires for help.',
    });
  }
};
