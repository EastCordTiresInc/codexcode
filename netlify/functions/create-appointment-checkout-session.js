const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { isStripeTestMode } = require('./lib/stripe-mode');
const { isPreferredDateInShippingHold } = require('./lib/new-tire-shipping-hold');

const STRIPE_KEY_MISSING_MESSAGE = 'Stripe checkout is missing STRIPE_SECRET_KEY in Netlify environment variables.';
const SLOT_UNAVAILABLE_MESSAGE = 'One or more appointment times are no longer available. Please choose another time.';
const MIN_ADVANCE_MINUTES = 120;
const SERVICE_START_MINUTES = 8 * 60;
const SERVICE_END_MINUTES = 20 * 60;
const SERVICE_TIME_ZONE = 'America/Toronto';
const TAX_RATE = 0.13;

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
  if (origin) return origin.replace(/\/$/, '');

  const host = event.headers.host || event.headers.Host || '';
  const isLocal = /localhost|127\.0\.0\.1/i.test(host);
  if (host) return `${isLocal ? 'http' : 'https'}://${host}`.replace(/\/$/, '');

  const configuredUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
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

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function calculateServiceAmounts(subtotal) {
  const serviceSubtotal = roundMoney(subtotal);
  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
  const depositAmount = roundMoney(totalWithHst * 0.20);
  const remainingBalance = roundMoney(totalWithHst - depositAmount);

  return {
    serviceSubtotal,
    hstAmount,
    totalWithHst,
    depositAmount,
    remainingBalance,
    taxRate: TAX_RATE,
  };
}

function normalizeBookingItems(payload) {
  if (Array.isArray(payload.items) && payload.items.length) return payload.items;
  return [payload];
}

function getTimeWindowStartMinutes(value) {
  const startText = String(value || '').split(/\s*[-–—]\s*/)[0].trim();
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
  if (startDate && !Number.isNaN(startDate.getTime())) {
    return startDate.getTime() <= Date.now();
  }
  return false;
}

function isLessThanMinimumAdvance(booking) {
  const startDate = getAppointmentStartDate(booking);
  if (!startDate || Number.isNaN(startDate.getTime())) return false;
  return startDate.getTime() - Date.now() < MIN_ADVANCE_MINUTES * 60 * 1000;
}

function linkedNewTireOrderIds(booking) {
  const direct = String(booking.newTireOrderId || booking.new_tire_order_id || '').trim();
  const linked = Array.isArray(booking.linkedTires) ? booking.linkedTires : [];
  return [...new Set([
    direct,
    ...linked
      .filter((tire) => String(tire?.type || '') === 'new_tire' && String(tire.orderId || tire.order_id || '').trim())
      .map((tire) => String(tire.orderId || tire.order_id || '').trim()),
  ].filter(Boolean))];
}

function purchaseIsoForBooking(booking, ordersById = {}) {
  for (const id of linkedNewTireOrderIds(booking)) {
    const order = ordersById[id];
    if (order?.paid_at || order?.created_at) return order.paid_at || order.created_at;
  }
  const linked = Array.isArray(booking.linkedTires) ? booking.linkedTires : [];
  const fromTire = linked.find((tire) => String(tire?.type || '') === 'new_tire' && (tire.paidAt || tire.paid_at));
  return String(booking.newTirePurchasedAt || booking.new_tire_purchased_at || fromTire?.paidAt || fromTire?.paid_at || '').trim();
}

async function assertConfirmedNewTireOrders({ supabaseAdmin, userId, bookings }) {
  const orderIds = [...new Set(bookings.flatMap(linkedNewTireOrderIds))];
  const ordersById = {};
  if (!orderIds.length) return { ok: true, ordersById };
  if (!supabaseAdmin) return { ok: true, ordersById };
  for (const orderId of orderIds) {
    const { data: order, error } = await supabaseAdmin
      .from('new_tire_orders')
      .select('id, customer_id, payment_status, paid_at, created_at')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !order) {
      return { ok: false, message: 'This installation booking needs a confirmed new tire order. Finish ORDER on New Tires first.' };
    }
    if (userId && order.customer_id !== userId) {
      return { ok: false, message: 'That new tire order is not on this account.' };
    }
    if (order.payment_status !== 'paid') {
      return { ok: false, message: 'Finish the tire order first. Installation can be booked only after that order is confirmed.' };
    }
    ordersById[orderId] = order;
  }
  return { ok: true, ordersById };
}

function isNewTireInstallBooking(booking) {
  if (String(booking.newTireOrderId || booking.new_tire_order_id || '').trim()) return true;
  if (booking.awaitingNewTireOrder || booking.source === 'new-tires') return true;
  const linked = Array.isArray(booking.linkedTires) ? booking.linkedTires : [];
  return linked.some((tire) => String(tire?.type || '') === 'new_tire' && String(tire.orderId || tire.order_id || '').trim());
}

function isOutsideServiceHours(booking) {
  const startMinutes = getTimeWindowStartMinutes(booking.preferredTimeWindow);
  if (startMinutes === null) return false;
  return startMinutes < SERVICE_START_MINUTES || startMinutes >= SERVICE_END_MINUTES;
}

function isWithinNewTireShippingHold(booking, purchaseIso) {
  if (!isNewTireInstallBooking(booking) || !booking.preferredDate) return false;
  return isPreferredDateInShippingHold(booking.preferredDate, purchaseIso);
}

function getSlotKey(date, timeWindow) {
  return `${date || ''}__${timeWindow || ''}`;
}

function validateCartSlotAvailability(bookings, ordersById = {}) {
  const seenSlots = new Set();

  for (const booking of bookings) {
    if (isPastAppointmentSlot(booking)) {
      return { valid: false, reason: 'past_time', message: SLOT_UNAVAILABLE_MESSAGE };
    }

    if (isOutsideServiceHours(booking)) {
      return { valid: false, reason: 'outside_service_hours', message: 'Installation hours are 8:00 AM to 8:00 PM. Please choose a time in that window.' };
    }

    if (isWithinNewTireShippingHold(booking, purchaseIsoForBooking(booking, ordersById))) {
      return { valid: false, reason: 'shipping_hold', message: 'New tire installation cannot be booked on the purchase date or the following 4 days. Please choose a later date.' };
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

function buildBookingRecord({ booking, customer, service, amounts, verifiedUser }) {
  return {
    customer_id: verifiedUser.id,
    customer_name: customer.name || booking.customerName || '',
    customer_email: customer.email || booking.customerEmail || '',
    customer_phone: customer.phone || booking.customerPhone || '',
    service_id: booking.serviceId || '',
    service_name: service.name,
    starting_price: amounts.serviceSubtotal,
    service_subtotal: amounts.serviceSubtotal,
    hst_amount: amounts.hstAmount,
    total_with_hst: amounts.totalWithHst,
    deposit_amount: amounts.depositAmount,
    remaining_balance: amounts.remainingBalance,
    tax_rate: amounts.taxRate,
    preferred_date: booking.preferredDate || null,
    preferred_time_window: booking.preferredTimeWindow || '',
    vehicle_year: booking.vehicleYear || '',
    vehicle_make: booking.vehicleMake || '',
    vehicle_model: booking.vehicleModel || '',
    vehicle_plate_number: booking.vehiclePlateNumber || '',
    vehicle_colour: booking.vehicleColour || '',
    tire_size: booking.tireSize || '',
    tires_already_on_rims: booking.tiresAlreadyOnRims || '',
    number_of_tires: Number(booking.numberOfTires || 0),
    full_service_address: booking.fullServiceAddress || '',
    city: booking.city || '',
    postal_code: booking.postalCode || '',
    parking_access_notes: booking.parkingAccessNotes || '',
    install_location: booking.installLocation || booking.install_location || '',
    additional_notes: booking.additionalNotes || '',
    linked_tires: Array.isArray(booking.linkedTires) ? booking.linkedTires : [],
    new_tire_order_id: booking.newTireOrderId || booking.new_tire_order_id || null,
    new_tire_purchased_at: booking.newTirePurchasedAt || booking.new_tire_purchased_at || null,
    service_area_status: booking.serviceAreaStatus || 'In service area',
    booking_status: 'Pending Confirmation',
    payment_status: 'pending_checkout',
    stripe_session_id: booking.stripeSessionId || '',
    updated_at: new Date().toISOString(),
  };
}

function extractMissingColumnName(error) {
  const message = String(error?.message || error?.details || '');
  const schemaCacheMatch = message.match(/could not find the '([^']+)' column/i);
  if (schemaCacheMatch) return schemaCacheMatch[1];
  const postgresMatch = message.match(/column "([^"]+)" of relation/i);
  if (postgresMatch) return postgresMatch[1];
  return '';
}

async function insertBookingRecord(supabaseAdmin, record, selectColumns) {
  const row = { ...record };
  const strippedColumns = new Set();

  while (Object.keys(row).length) {
    const result = await supabaseAdmin
      .from('appointment_bookings')
      .insert(row)
      .select(selectColumns)
      .single();

    if (!result.error) return result;

    const missingColumn = extractMissingColumnName(result.error);
    if (!missingColumn || !(missingColumn in row) || strippedColumns.has(missingColumn)) {
      return result;
    }

    delete row[missingColumn];
    strippedColumns.add(missingColumn);
    console.warn('[EastCord appointment automation] appointment_bookings missing column; retrying without it.', missingColumn);
  }

  return { data: null, error: { message: 'No remaining booking columns to save.' } };
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

async function findOrRepairBookingRow({ supabaseAdmin, booking, customer, verifiedUser, service, amounts }) {
  if (!supabaseAdmin || !verifiedUser) return { row: null, effectiveBookingId: booking.bookingId || '' };

  const existingBookingId = String(booking.bookingId || '').trim();
  const canLookupExisting = existingBookingId && !existingBookingId.startsWith('pending-') && !existingBookingId.startsWith('appointment-') && !existingBookingId.startsWith('cart-item-');

  if (canLookupExisting) {
    const { data: row, error } = await supabaseAdmin
      .from('appointment_bookings')
      .select('id, customer_id, payment_status')
      .eq('id', existingBookingId)
      .maybeSingle();

    if (error) {
      const diagnostics = buildLookupDiagnostics({ booking, customer, verifiedUser, supabaseError: error, rowFound: false, reason: 'supabase_lookup_error_checkout_allowed' });
      logDeveloperError('Booking lookup by id was blocked before checkout; continuing because the authenticated user matches the checkout customer.', diagnostics);
      return { row: null, effectiveBookingId: existingBookingId, diagnostics };
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
  }

  const diagnostics = buildLookupDiagnostics({ booking, customer, verifiedUser, rowFound: false, reason: 'booking_id_not_found_repairing' });
  console.warn('[EastCord appointment automation] Booking id was not found; creating repair row before checkout.', diagnostics);

  const { data: repairedRow, error: repairError } = await insertBookingRecord(
    supabaseAdmin,
    buildBookingRecord({ booking, customer, service, amounts, verifiedUser }),
    'id, customer_id, payment_status'
  );

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

function fieldValue(value) {
  return String(value ?? '').trim();
}

function isShopInstall(booking) {
  const location = fieldValue(booking.installLocation || booking.install_location);
  if (location === 'shop') return true;
  const address = fieldValue(booking.fullServiceAddress || booking.full_service_address).toLowerCase();
  const city = fieldValue(booking.city).toLowerCase();
  return address === 'eastcord tires shop' || city === 'eastcord shop';
}

function validateBookingFields(booking, customer, ordersById = {}) {
  const city = fieldValue(booking.city);
  const shop = isShopInstall(booking);
  const requiredFields = {
    'account email': fieldValue(customer.email),
    'phone number': fieldValue(customer.phone || booking.customerPhone),
    'appointment date': fieldValue(booking.preferredDate),
    'appointment time': fieldValue(booking.preferredTimeWindow),
    'vehicle year': fieldValue(booking.vehicleYear),
    'vehicle make': fieldValue(booking.vehicleMake),
    'vehicle model': fieldValue(booking.vehicleModel),
    'plate number': fieldValue(booking.vehiclePlateNumber),
    'vehicle colour': fieldValue(booking.vehicleColour),
    'tire size': fieldValue(booking.tireSize),
    'tires on rims': fieldValue(booking.tiresAlreadyOnRims),
    'number of tires': fieldValue(booking.numberOfTires),
  };
  if (!shop) {
    requiredFields['service address'] = fieldValue(booking.fullServiceAddress);
    requiredFields.city = city;
    requiredFields['postal code'] = fieldValue(booking.postalCode);
  }

  const missing = Object.entries(requiredFields)
    .filter(([, value]) => !value)
    .map(([label]) => label);
  if (missing.length) {
    return `Please complete all required booking and account fields (${missing.join(', ')}).`;
  }

  if (!shop && !SERVICE_AREA_CITIES.has(city)) {
    return 'EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.';
  }

  if (isPastAppointmentSlot(booking) || isLessThanMinimumAdvance(booking)) {
    return 'Please choose a valid future appointment date and time window at least 2 hours from now.';
  }

  if (isOutsideServiceHours(booking)) {
    return 'Installation hours are 8:00 AM to 8:00 PM. Please choose a time in that window.';
  }

  if (isWithinNewTireShippingHold(booking, purchaseIsoForBooking(booking, ordersById))) {
    return 'New tire installation cannot be booked on the purchase date or the following 4 days. Please choose a later date.';
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
  customer.customerId = fieldValue(customer.customerId || customer.id);
  customer.email = fieldValue(customer.email);
  customer.phone = fieldValue(customer.phone || bookingItems[0]?.customerPhone);
  customer.name = fieldValue(customer.name || bookingItems[0]?.customerName);

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

  const supabaseAdmin = getSupabaseAdmin();
  const verifiedUser = await getVerifiedUser(event, supabaseAdmin);

  if (verifiedUser && verifiedUser.id !== customer.customerId) {
    return json(403, { message: 'This cart does not match the logged-in customer.' });
  }

  const orderGate = await assertConfirmedNewTireOrders({
    supabaseAdmin,
    userId: verifiedUser?.id || customer.customerId,
    bookings: bookingItems,
  });
  if (!orderGate.ok) return json(400, { message: orderGate.message });

  const cartSlotValidation = validateCartSlotAvailability(bookingItems, orderGate.ordersById);
  if (!cartSlotValidation.valid) {
    logDeveloperError('Checkout stopped because cart slot validation failed.', cartSlotValidation);
    return json(409, {
      message: cartSlotValidation.message || SLOT_UNAVAILABLE_MESSAGE,
      reason: cartSlotValidation.reason,
    });
  }

  const preparedItems = [];

  for (const booking of bookingItems) {
    const service = SERVICES[booking.serviceId];
    if (!service) return json(400, { message: 'Please choose a valid tire service.' });

    const validationMessage = validateBookingFields(booking, customer, orderGate.ordersById);
    if (validationMessage) return json(400, { message: validationMessage });

    const amounts = calculateServiceAmounts(service.startingPrice);

    if (amounts.depositAmount <= 0) {
      return json(400, { message: 'The booking deposit amount is missing. Please return to the appointment page and add the service again.' });
    }

    const lookupResult = await findOrRepairBookingRow({ supabaseAdmin, booking, customer, verifiedUser, service, amounts });
    if (lookupResult?.errorResponse) return lookupResult.errorResponse;

    preparedItems.push({
      booking,
      service,
      ...amounts,
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
  const totalSubtotal = roundMoney(preparedItems.reduce((sum, item) => sum + item.serviceSubtotal, 0));
  const totalHst = roundMoney(preparedItems.reduce((sum, item) => sum + item.hstAmount, 0));
  const totalWithHst = roundMoney(preparedItems.reduce((sum, item) => sum + item.totalWithHst, 0));
  const totalDeposit = roundMoney(preparedItems.reduce((sum, item) => sum + item.depositAmount, 0));
  const totalRemaining = roundMoney(preparedItems.reduce((sum, item) => sum + item.remainingBalance, 0));

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
            description: '20% booking deposit, including applicable HST. Remaining balance, including applicable HST, is paid on-site after service.',
          },
          unit_amount: Math.round(item.depositAmount * 100),
        },
        quantity: 1,
      })),
      success_url: `${siteUrl}/appointment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/cart.html`,
      metadata: {
        order_type: 'appointment',
        supabase_booking_id: String(bookingIds[0] || '').slice(0, 500),
        supabase_booking_ids: JSON.stringify(bookingIds).slice(0, 500),
        appointment_count: String(preparedItems.length),
        customer_id: String(customer.customerId).slice(0, 500),
        customer_name: String(customer.name || '').slice(0, 500),
        customer_email: String(customer.email).slice(0, 500),
        customer_phone: String(customer.phone).slice(0, 500),
        booking_status: 'Confirmed After Payment',
        payment_status: 'pending_checkout',
        tax_rate: TAX_RATE.toFixed(2),
        total_service_subtotal: totalSubtotal.toFixed(2),
        total_hst_amount: totalHst.toFixed(2),
        total_with_hst: totalWithHst.toFixed(2),
        total_deposit_amount: totalDeposit.toFixed(2),
        total_remaining_balance: totalRemaining.toFixed(2),
      },
    });

    if (supabaseAdmin && verifiedUser) {
      for (const item of preparedItems) {
        const { error: updateError } = await supabaseAdmin
          .from('appointment_bookings')
          .update({
            starting_price: item.serviceSubtotal,
            service_subtotal: item.serviceSubtotal,
            hst_amount: item.hstAmount,
            total_with_hst: item.totalWithHst,
            deposit_amount: item.depositAmount,
            remaining_balance: item.remainingBalance,
            tax_rate: item.taxRate,
            stripe_session_id: session.id,
            payment_status: 'pending_checkout',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.effectiveBookingId)
          .eq('customer_id', verifiedUser.id);

        if (updateError) {
          logDeveloperError('Booking row could not be updated with Stripe session ID and HST totals.', {
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
      totalSubtotal,
      totalHst,
      totalWithHst,
      totalDeposit,
      totalRemaining,
    });

    return json(200, { url: session.url, testMode: isStripeTestMode() });
  } catch (error) {
    logDeveloperError('Stripe Checkout session creation failed.', {
      message: error.message,
      type: error.type,
      code: error.code,
    });
    return json(500, { message: error.message || 'Secure checkout could not be started. Please try again or contact EastCord Tires for help.' });
  }
};
