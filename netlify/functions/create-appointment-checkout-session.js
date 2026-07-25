const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const STRIPE_KEY_MISSING_MESSAGE = 'Stripe checkout is missing STRIPE_SECRET_KEY in Netlify environment variables.';
const SLOT_UNAVAILABLE_MESSAGE = 'One or more appointment times are no longer available. Please choose another time.';
const MIN_ADVANCE_MINUTES = 120;
const SERVICE_TIME_ZONE = 'America/Toronto';

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

function normalizeBookingItems(payload) {
  if (Array.isArray(payload.items) && payload.items.length) return payload.items;
  return [payload];
}

function getTimeWindowStartMinutes(value) {
  const startText = String(value || '').split('-')[0].trim();
  const match = startText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;

  return (hours * 60) + minutes;
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((values, part) => {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
    return values;
  }, {});

  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUtc - date.getTime();
}

function zonedTimeToDate(dateValue, startMinutes) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  if (!year || !month || !day || startMinutes === null) return null;

  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  const offset = getTimeZoneOffsetMs(utcGuess, SERVICE_TIME_ZONE);
  return new Date(utcGuess.getTime() - offset);
}

function getAppointmentStartDate(booking) {
  const startMinutes = getTimeWindowStartMinutes(booking.preferredTimeWindow);
  return zonedTimeToDate(booking.preferredDate, startMinutes);
}

function isPastAppointmentSlot(booking) {
  const startDate = getAppointmentStartDate(booking);
  if (!startDate || Number.isNaN(startDate.getTime())) return true;
  return startDate.getTime() <= Date.now();
}

function isLessThanMinimumAdvance(booking) {
  const startDate = getAppointmentStartDate(booking);
  if (!startDate || Number.isNaN(startDate.getTime())) return true;
  return startDate.getTime() - Date.now() < MIN_ADVANCE_MINUTES * 60 * 1000;
}

function getSlotKey(date, timeWindow) {
  return `${date || ''}__${timeWindow || ''}`;
}

function validateCartSlotAvailability(bookings) {
  const seenSlots = new Set();

  for (const booking of bookings) {
    if (isPastAppointmentSlot(booking)) {
      return { valid: false, reason: 'past_time', message: SLOT_UNAVAILABLE_MESSAGE };
    }

    if (isLessThanMinimumAdvance(booking)) {
      return { valid: false, reason: 'minimum_advance_time', message: SLOT_UNAVAILABLE_MESSAGE };
    }

    const slotKey = getSlotKey(booking.preferredDate, booking.preferredTimeWindow);
    if (seenSlots.has(slotKey)) {
      return { valid: false, reason: 'duplicate_cart_time', message: SLOT_UNAVAILABLE_MESSAGE };
    }
    seenSlots.add(slotKey);
  }

  return { valid: true };
}

async function findPaidSlotConflicts(supabaseAdmin, preparedItems) {
  if (!supabaseAdmin) return [];

  const dates = Array.from(new Set(preparedItems.map((item) => item.booking.preferredDate).filter(Boolean)));
  const activeBookingIds = new Set(preparedItems.map((item) => item.effectiveBookingId).filter(Boolean));
  const requestedSlots = new Set(preparedItems.map((item) => getSlotKey(item.booking.preferredDate, item.booking.preferredTimeWindow)));
  const conflicts = [];

  for (const date of dates) {
    const { data, error } = await supabaseAdmin
      .from('appointment_bookings')
      .select('id, preferred_date, preferred_time_window, payment_status, booking_status')
      .eq('preferred_date', date)
      .eq('payment_status', 'paid_deposit')
      .eq('booking_status', 'Confirmed');

    if (error) {
      logDeveloperError('Confirmed paid appointment slot lookup failed before Stripe checkout.', {
        date,
        error,
      });
      return [{ reason: 'supabase_slot_lookup_failed', date }];
    }

    (data || []).forEach((row) => {
      const slotKey = getSlotKey(row.preferred_date, row.preferred_time_window);
      if (requestedSlots.has(slotKey) && !activeBookingIds.has(row.id)) {
        conflicts.push({
          reason: 'confirmed_paid_slot_conflict',
          bookingId: row.id,
          date: row.preferred_date,
          timeWindow: row.preferred_time_window,
        });
      }
    });
  }

  return conflicts;
}

function buildLookupDiagnostics({ booking, customer, verifiedUser, supabaseError, rowFound, reason }) {
  return {
    reason,
    bookingIdReceived: booking?.bookingId || '',
    customerIdReceived: customer?.customerId || '',
    verifiedUserId: verifiedUser?.id || '',
    supabaseErrorCode: supabaseError?.code || '',
    supabaseErrorMessage: supabaseError?.message || '',
    rowFound: Boolean(rowFound),
  };
}

function buildBookingRecord({ booking, customer, service, startingPrice, depositAmount, remainingBalance, verifiedUser }) {
  return {
    customer_id: verifiedUser.id,
    customer_name: customer.name || booking.customerName || '',
    customer_email: customer.email || booking.customerEmail || '',
    customer_phone: customer.phone || booking.customerPhone || '',
    service_id: booking.serviceId || '',
    service_name: service.name,
    starting_price: startingPrice,
    deposit_amount: depositAmount,
    remaining_balance: remainingBalance,
    preferred_date: booking.preferredDate || null,
    preferred_time_window: booking.preferredTimeWindow || '',
    vehicle_year: booking.vehicleYear || '',
    vehicle_make: booking.vehicleMake || '',
    vehicle_model: booking.vehicleModel || '',
    tire_size: booking.tireSize || '',
    tires_already_on_rims: booking.tiresAlreadyOnRims || '',
    number_of_tires: Number(booking.numberOfTires || 0),
    full_service_address: booking.fullServiceAddress || '',
    city: booking.city || '',
    postal_code: booking.postalCode || '',
    parking_access_notes: booking.parkingAccessNotes || '',
    additional_notes: booking.additionalNotes || '',
    service_area_status: booking.serviceAreaStatus || 'In service area',
    booking_status: 'Pending Confirmation',
    payment_status: 'pending_checkout',
    stripe_session_id: booking.stripeSessionId || '',
    updated_at: new Date().toISOString(),
  };
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

async function findOrRepairBookingRow({ supabaseAdmin, booking, customer, verifiedUser, service, startingPrice, depositAmount, remainingBalance }) {
  if (!supabaseAdmin || !verifiedUser) return { row: null, effectiveBookingId: booking.bookingId };

  const { data: row, error } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id, customer_id, payment_status')
    .eq('id', booking.bookingId)
    .maybeSingle();

  if (error) {
    const diagnostics = buildLookupDiagnostics({ booking, customer, verifiedUser, supabaseError: error, rowFound: false, reason: 'supabase_lookup_error_checkout_allowed' });
    logDeveloperError('Booking lookup by id was blocked before checkout; continuing because the authenticated user matches the checkout customer.', diagnostics);
    return { row: null, effectiveBookingId: booking.bookingId, diagnostics };
  }

  if (row) {
    if (row.customer_id !== verifiedUser.id) {
      const diagnostics = buildLookupDiagnostics({ booking, customer, verifiedUser, rowFound: true, reason: 'customer_mismatch' });
      logDeveloperError('Booking row customer mismatch before checkout.', { ...diagnostics, rowCustomerId: row.customer_id });
      return { errorResponse: json(403, { message: 'This booking does not match the logged-in customer.', diagnostics: { ...diagnostics, rowCustomerId: row.customer_id } }) };
    }

    console.log('[EastCord appointment automation] Booking row found before checkout.', {
      bookingId: row.id,
      customerMatches: true,
      paymentStatus: row.payment_status,
    });

    return { row, effectiveBookingId: row.id };
  }

  const diagnostics = buildLookupDiagnostics({ booking, customer, verifiedUser, rowFound: false, reason: 'booking_id_not_found_repairing' });
  console.warn('[EastCord appointment automation] Booking id was not found; creating repair row before checkout.', diagnostics);

  const { data: repairedRow, error: repairError } = await supabaseAdmin
    .from('appointment_bookings')
    .insert(buildBookingRecord({ booking, customer, service, startingPrice, depositAmount, remainingBalance, verifiedUser }))
    .select('id, customer_id, payment_status')
    .single();

  if (repairError || !repairedRow) {
    const repairDiagnostics = buildLookupDiagnostics({ booking, customer, verifiedUser, supabaseError: repairError, rowFound: false, reason: 'booking_repair_insert_failed_checkout_allowed' });
    logDeveloperError('Booking repair insert failed before checkout; continuing because the authenticated user matches the checkout customer.', repairDiagnostics);
    return { row: null, effectiveBookingId: booking.bookingId, diagnostics: repairDiagnostics };
  }

  console.log('[EastCord appointment automation] Booking repair row created before checkout.', {
    oldBookingId: booking.bookingId,
    repairedBookingId: repairedRow.id,
    customerMatches: repairedRow.customer_id === verifiedUser.id,
  });

  return { row: repairedRow, effectiveBookingId: repairedRow.id };
}

function validateBookingFields(booking, customer) {
  const requiredFields = [
    customer.customerId,
    customer.email,
    customer.phone,
    booking.bookingId,
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

  if (!requiredFields.every((value) => required(String(value || '')))) {
    return 'Please complete all required booking and account fields.';
  }

  if (!SERVICE_AREA_CITIES.has(booking.city)) {
    return 'EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.';
  }

  if (isPastAppointmentSlot(booking) || isLessThanMinimumAdvance(booking)) {
    return 'Please choose a valid future appointment date and time window.';
  }

  return '';
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

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    logDeveloperError('Invalid checkout request body.', error);
    return json(400, { message: 'Invalid booking request.' });
  }

  const bookingItems = normalizeBookingItems(payload);
  const customer = payload.customer || bookingItems[0]?.customer || {};

  console.info('[EastCord appointment automation] Checkout request diagnostics', {
    appointmentCount: bookingItems.length,
    bookingIds: bookingItems.map((item) => item.bookingId || ''),
    customerProfileId: customer.customerId || '',
    depositAmounts: bookingItems.map((item) => item.depositAmount || ''),
  });

  if (!bookingItems.length) return json(400, { message: 'Add an appointment service before checkout.' });
  if (!required(customer.customerId) || !required(customer.email)) {
    return json(401, { message: 'Please log in before checkout.' });
  }

  const cartSlotValidation = validateCartSlotAvailability(bookingItems);
  if (!cartSlotValidation.valid) {
    logDeveloperError('Checkout stopped because cart slot validation failed.', cartSlotValidation);
    return json(409, { message: SLOT_UNAVAILABLE_MESSAGE, reason: cartSlotValidation.reason });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const verifiedUser = await getVerifiedUser(event, supabaseAdmin);

  if (verifiedUser && verifiedUser.id !== customer.customerId) {
    return json(403, { message: 'This cart does not match the logged-in customer.' });
  }

  const preparedItems = [];

  for (const booking of bookingItems) {
    const service = SERVICES[booking.serviceId];
    if (!service) return json(400, { message: 'Please choose a valid tire service.' });

    const validationMessage = validateBookingFields(booking, customer);
    if (validationMessage) return json(400, { message: validationMessage });

    const startingPrice = moneyAmount(booking.startingPrice || service.startingPrice);
    const depositAmount = moneyAmount(booking.depositAmount);
    const remainingBalance = moneyAmount(booking.remainingBalance || startingPrice - depositAmount);

    if (depositAmount <= 0) {
      return json(400, { message: 'The booking deposit amount is missing. Please return to the appointment page and add the service again.' });
    }

    const lookupResult = await findOrRepairBookingRow({ supabaseAdmin, booking, customer, verifiedUser, service, startingPrice, depositAmount, remainingBalance });
    if (lookupResult?.errorResponse) return lookupResult.errorResponse;

    preparedItems.push({
      booking,
      service,
      startingPrice,
      depositAmount,
      remainingBalance,
      effectiveBookingId: lookupResult?.effectiveBookingId || booking.bookingId,
      lookupDiagnostics: lookupResult?.diagnostics || null,
    });
  }

  const paidSlotConflicts = await findPaidSlotConflicts(supabaseAdmin, preparedItems);
  if (paidSlotConflicts.length) {
    logDeveloperError('Checkout stopped because one or more slots are already confirmed and paid.', paidSlotConflicts);
    return json(409, { message: SLOT_UNAVAILABLE_MESSAGE, conflicts: paidSlotConflicts });
  }

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const bookingIds = preparedItems.map((item) => item.effectiveBookingId).filter(Boolean);
  const totalDeposit = preparedItems.reduce((sum, item) => sum + item.depositAmount, 0);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: preparedItems.map((item, index) => ({
        price_data: {
          currency: 'cad',
          product_data: {
            name: `Vehicle ${index + 1}: ${item.service.name} - 20% Booking Deposit`,
            description: '20% booking deposit based on the selected starting price. Remaining balance is paid on-site after service.',
          },
          unit_amount: Math.round(item.depositAmount * 100),
        },
        quantity: 1,
      })),
      success_url: `${siteUrl}/appointment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart.html`,
      metadata: {
        supabase_booking_id: String(bookingIds[0] || '').slice(0, 500),
        supabase_booking_ids: JSON.stringify(bookingIds).slice(0, 500),
        appointment_count: String(preparedItems.length),
        customer_id: String(customer.customerId).slice(0, 500),
        customer_name: String(customer.name || '').slice(0, 500),
        customer_email: String(customer.email).slice(0, 500),
        customer_phone: String(customer.phone).slice(0, 500),
        booking_status: 'Confirmed After Payment',
        payment_status: 'pending_checkout',
        total_deposit_amount: totalDeposit.toFixed(2),
      },
    });

    if (supabaseAdmin && verifiedUser) {
      for (const item of preparedItems) {
        const { error: updateError } = await supabaseAdmin
          .from('appointment_bookings')
          .update({
            stripe_session_id: session.id,
            payment_status: 'pending_checkout',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.effectiveBookingId)
          .eq('customer_id', verifiedUser.id);

        if (updateError) {
          logDeveloperError('Booking row could not be updated with Stripe session ID.', {
            bookingId: item.effectiveBookingId,
            updateError,
          });
        }
      }
    }

    console.log('[EastCord appointment automation] Stripe Checkout session created.', {
      sessionId: session.id,
      hasUrl: Boolean(session.url),
      appointmentCount: preparedItems.length,
      bookingIds,
      totalDeposit,
    });

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
