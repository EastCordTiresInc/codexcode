const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { isStripeTestMode } = require('./lib/stripe-mode');
const { isPreferredDateInShippingHold } = require('./lib/new-tire-shipping-hold');

const TAX_RATE = 0.13;
const SERVICE_START_MINUTES = 8 * 60;
const SERVICE_END_MINUTES = 20 * 60;
const SERVICES = {
  'seasonal-changeover-rims': { name: 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims', startingPrice: 40 },
  'seasonal-swap-not-mounted': { name: 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims', startingPrice: 80 },
  'mount-balance-1': { name: 'Mount & Balance - 1 Tire', startingPrice: 25 },
  'mount-balance-2': { name: 'Mount & Balance - 2 Tires', startingPrice: 50 },
  'mount-balance-3': { name: 'Mount & Balance - 3 Tires', startingPrice: 75 },
  'mount-balance-4': { name: 'Mount & Balance - 4 Tires', startingPrice: 100 },
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

function amountsFor(startingPrice) {
  const serviceSubtotal = roundMoney(startingPrice);
  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
  const depositAmount = roundMoney(totalWithHst * 0.2);
  return {
    serviceSubtotal,
    hstAmount,
    totalWithHst,
    depositAmount,
    remainingBalance: roundMoney(totalWithHst - depositAmount),
    taxRate: TAX_RATE,
  };
}

function resolveService(item) {
  if (SERVICES[item.serviceId]) return { id: item.serviceId, ...SERVICES[item.serviceId] };
  const name = text(item.serviceName || item.service_name).toLowerCase();
  const match = Object.entries(SERVICES).find(([, service]) => service.name.toLowerCase() === name);
  return match ? { id: match[0], ...match[1] } : null;
}

function linkedNewTireOrderIds(item) {
  const direct = text(item.newTireOrderId || item.new_tire_order_id);
  const linked = Array.isArray(item.linkedTires) ? item.linkedTires : [];
  return [...new Set([
    direct,
    ...linked
      .filter((tire) => String(tire?.type || '') === 'new_tire' && text(tire.orderId || tire.order_id))
      .map((tire) => text(tire.orderId || tire.order_id)),
  ].filter(Boolean))];
}

async function assertConfirmedNewTireOrders({ supabaseAdmin, userId, items }) {
  const orderIds = [...new Set(items.flatMap(linkedNewTireOrderIds))];
  const ordersById = {};
  if (!orderIds.length) return { ok: true, ordersById };
  for (const orderId of orderIds) {
    const { data: order, error } = await supabaseAdmin
      .from('new_tire_orders')
      .select('id, customer_id, payment_status, paid_at, created_at')
      .eq('id', orderId)
      .maybeSingle();
    if (error || !order) {
      return { ok: false, message: 'This installation booking needs a confirmed new tire order. Finish ORDER on New Tires first.' };
    }
    if (order.customer_id !== userId) {
      return { ok: false, message: 'That new tire order is not on this account.' };
    }
    if (order.payment_status !== 'paid') {
      return { ok: false, message: 'Finish the tire order first. Installation can be booked only after that order is confirmed.' };
    }
    ordersById[orderId] = order;
  }
  return { ok: true, ordersById };
}

function purchaseIsoForItem(item, ordersById = {}) {
  const ids = linkedNewTireOrderIds(item);
  for (const id of ids) {
    const order = ordersById[id];
    if (order?.paid_at || order?.created_at) return order.paid_at || order.created_at;
  }
  const linked = Array.isArray(item.linkedTires) ? item.linkedTires : [];
  const fromTire = linked.find((tire) => String(tire?.type || '') === 'new_tire' && (tire.paidAt || tire.paid_at));
  return text(item.newTirePurchasedAt || item.new_tire_purchased_at || fromTire?.paidAt || fromTire?.paid_at);
}

function isWithinNewTireShippingHold(item, purchaseIso) {
  if (!isNewTireInstallItem(item)) return false;
  const dateValue = text(item.preferredDate || item.preferred_date);
  if (!dateValue) return false;
  return isPreferredDateInShippingHold(dateValue, purchaseIso);
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

function isNewTireInstallItem(item) {
  if (text(item.newTireOrderId || item.new_tire_order_id)) return true;
  if (item.awaitingNewTireOrder || item.source === 'new-tires') return true;
  const linked = Array.isArray(item.linkedTires) ? item.linkedTires : [];
  return linked.some((tire) => String(tire?.type || '') === 'new_tire' && text(tire.orderId || tire.order_id));
}

function isOutsideServiceHours(item) {
  const startMinutes = getTimeWindowStartMinutes(item.preferredTimeWindow || item.preferred_time_window);
  if (startMinutes === null) return false;
  return startMinutes < SERVICE_START_MINUTES || startMinutes >= SERVICE_END_MINUTES;
}

function validateInstallSlots(items, ordersById = {}) {
  for (const item of items) {
    if (isOutsideServiceHours(item)) {
      return 'Installation hours are 8:00 AM to 8:00 PM. Please choose a time in that window.';
    }
    if (isWithinNewTireShippingHold(item, purchaseIsoForItem(item, ordersById))) {
      return 'New tire installation cannot be booked on the purchase date or the following 4 days. Please choose a later date.';
    }
  }
  return '';
}

exports.handler = async (event) => {
  console.log('[EastCord appointment pay] invoked', { method: event.httpMethod });
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { message: 'Stripe checkout is missing STRIPE_SECRET_KEY. Add your test secret key to .netlify/.env and restart npm run dev.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid checkout request.' });
  }

  const customer = payload.customer || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) return json(400, { message: 'Add an appointment before paying.' });
  if (!text(customer.name) || !text(customer.email) || !text(customer.phone)) {
    return json(400, { message: 'Please complete your name, email, and phone before paying.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const token = getBearerToken(event);
  let verifiedUser = null;
  if (supabaseAdmin && token) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error) verifiedUser = data?.user || null;
  }
  if (!verifiedUser) return json(401, { message: 'Please log in before paying the appointment deposit.' });

  if (supabaseAdmin) {
    const orderGate = await assertConfirmedNewTireOrders({
      supabaseAdmin,
      userId: verifiedUser.id,
      items,
    });
    if (!orderGate.ok) return json(400, { message: orderGate.message });
    const slotMessage = validateInstallSlots(items, orderGate.ordersById);
    if (slotMessage) return json(400, { message: slotMessage });
  } else {
    const slotMessage = validateInstallSlots(items);
    if (slotMessage) return json(400, { message: slotMessage });
  }

  const preparedItems = [];
  for (const item of items) {
    const service = resolveService(item);
    if (!service) return json(400, { message: 'Please choose a valid tire service.' });
    const amounts = amountsFor(service.startingPrice);
    if (amounts.depositAmount <= 0) {
      return json(400, { message: 'The booking deposit could not be calculated. Add the appointment again.' });
    }
    preparedItems.push({ item, service, ...amounts });
  }

  const bookingIds = [];
  if (supabaseAdmin) {
    const { data: pendingRows } = await supabaseAdmin
      .from('appointment_bookings')
      .select('id, service_id, preferred_date, preferred_time_window')
      .eq('customer_id', verifiedUser.id)
      .eq('payment_status', 'pending_checkout');

    const unusedPendingIds = new Set((pendingRows || []).map((row) => row.id));

    for (const prepared of preparedItems) {
      const booking = prepared.item;
      const preferredDate = booking.preferredDate || booking.preferred_date || null;
      const preferredTimeWindow = text(booking.preferredTimeWindow || booking.preferred_time_window);
      const existing = (pendingRows || []).find((row) => (
        row.service_id === prepared.service.id
        && String(row.preferred_date || '') === String(preferredDate || '')
        && text(row.preferred_time_window) === preferredTimeWindow
      ));

      if (existing?.id) {
        unusedPendingIds.delete(existing.id);
        bookingIds.push(existing.id);
        continue;
      }

      const bookingRow = {
          customer_id: verifiedUser.id,
          customer_name: text(customer.name),
          customer_email: text(customer.email),
          customer_phone: text(customer.phone),
          service_id: prepared.service.id,
          service_name: prepared.service.name,
          starting_price: prepared.serviceSubtotal,
          service_subtotal: prepared.serviceSubtotal,
          hst_amount: prepared.hstAmount,
          total_with_hst: prepared.totalWithHst,
          deposit_amount: prepared.depositAmount,
          remaining_balance: prepared.remainingBalance,
          tax_rate: prepared.taxRate,
          preferred_date: preferredDate,
          preferred_time_window: preferredTimeWindow,
          vehicle_year: text(booking.vehicleYear || booking.vehicle_year),
          vehicle_make: text(booking.vehicleMake || booking.vehicle_make),
          vehicle_model: text(booking.vehicleModel || booking.vehicle_model),
          vehicle_plate_number: text(booking.vehiclePlateNumber || booking.vehicle_plate_number),
          vehicle_colour: text(booking.vehicleColour || booking.vehicle_colour),
          tire_size: text(booking.tireSize || booking.tire_size),
          tires_already_on_rims: text(booking.tiresAlreadyOnRims || booking.tires_already_on_rims),
          number_of_tires: Number(booking.numberOfTires || booking.number_of_tires || 0),
          full_service_address: text(booking.fullServiceAddress || booking.full_service_address),
          city: text(booking.city),
          postal_code: text(booking.postalCode || booking.postal_code),
          parking_access_notes: text(booking.parkingAccessNotes || booking.parking_access_notes),
          install_location: text(booking.installLocation || booking.install_location) || null,
          additional_notes: text(booking.additionalNotes || booking.additional_notes),
          linked_tires: Array.isArray(booking.linkedTires) ? booking.linkedTires : [],
          new_tire_order_id: text(booking.newTireOrderId || booking.new_tire_order_id) || null,
          new_tire_purchased_at: text(booking.newTirePurchasedAt || booking.new_tire_purchased_at) || null,
          booking_status: 'Pending Confirmation',
          payment_status: 'pending_checkout',
          updated_at: new Date().toISOString(),
      };
      let { data, error } = await supabaseAdmin
        .from('appointment_bookings')
        .insert(bookingRow)
        .select('id')
        .single();
      if (error && /(new_tire_order_id|linked_tires|new_tire_purchased_at|install_location)/i.test(String(error.message || ''))) {
        delete bookingRow.new_tire_order_id;
        delete bookingRow.linked_tires;
        delete bookingRow.new_tire_purchased_at;
        delete bookingRow.install_location;
        ({ data, error } = await supabaseAdmin
          .from('appointment_bookings')
          .insert(bookingRow)
          .select('id')
          .single());
      }
      if (error) {
        console.error('[EastCord appointment pay] Booking insert failed; continuing to Stripe.', error);
      } else if (data?.id) {
        bookingIds.push(data.id);
      }
    }

    if (unusedPendingIds.size) {
      const { error: abandonError } = await supabaseAdmin
        .from('appointment_bookings')
        .update({
          booking_status: 'Abandoned',
          payment_status: 'abandoned',
          updated_at: new Date().toISOString(),
        })
        .eq('customer_id', verifiedUser.id)
        .eq('payment_status', 'pending_checkout')
        .in('id', Array.from(unusedPendingIds));
      if (abandonError) {
        console.error('[EastCord appointment pay] Unused pending bookings could not be abandoned.', abandonError);
      }
    }
  }

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const totalDeposit = roundMoney(preparedItems.reduce((sum, item) => sum + item.depositAmount, 0));

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: text(customer.email),
      line_items: preparedItems.map((prepared, index) => ({
        price_data: {
          currency: 'cad',
          product_data: {
            name: `Vehicle ${index + 1}: ${prepared.service.name} - 20% Booking Deposit`,
            description: '20% booking deposit, including applicable HST. Remaining balance is paid on-site after service.',
          },
          unit_amount: Math.round(prepared.depositAmount * 100),
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
        customer_id: verifiedUser.id,
        customer_name: text(customer.name).slice(0, 500),
        customer_email: text(customer.email).slice(0, 500),
        customer_phone: text(customer.phone).slice(0, 500),
        total_deposit_amount: totalDeposit.toFixed(2),
      },
    });

    console.log('[EastCord appointment pay] Stripe session created', {
      sessionId: session.id,
      hasUrl: Boolean(session.url),
      bookingIds,
    });

    return json(200, { url: session.url, testMode: isStripeTestMode() });
  } catch (error) {
    console.error('[EastCord appointment pay] Stripe session failed.', error);
    return json(500, { message: error.message || 'Secure checkout could not be started.' });
  }
};
