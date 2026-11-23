const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { calculateTax, roundMoney } = require('./lib/used-tire-order');
const appointmentServices = require('../../appointment-services');
const { slotTakenBySomeoneElse, SLOT_TAKEN_MESSAGE } = require('./lib/payment-window');
const { isStripeTestMode } = require('./lib/stripe-mode');
const { getUsedTireUnitPrice, isMarkdownStock, listedSetCount, priceForSetQuantity, MARKDOWN_PERCENT } = require('./lib/used-tire-pricing');
const { inventoryTableName, isDevInventoryTable } = require('./lib/inventory-table');

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

async function getVerifiedUser(event, supabaseAdmin) {
  if (!supabaseAdmin) return null;
  const token = getBearerToken(event);
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

const INSTALL_TIME_WINDOWS = [
  '8:00 AM - 9:00 AM',
  '9:00 AM - 10:00 AM',
  '10:00 AM - 11:00 AM',
  '11:00 AM - 12:00 PM',
  '12:00 PM - 1:00 PM',
  '1:00 PM - 2:00 PM',
  '2:00 PM - 3:00 PM',
  '3:00 PM - 4:00 PM',
  '4:00 PM - 5:00 PM',
  '5:00 PM - 6:00 PM',
  '6:00 PM - 7:00 PM',
  '7:00 PM - 8:00 PM',
];

function torontoDate(offsetDays = 0) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

function timeWindowStartMinutes(value) {
  const match = String(value || '').split('-')[0].trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return (hours * 60) + minutes;
}

function installQuote(items) {
  const groups = new Map();
  for (const item of items) {
    const bandId = appointmentServices.sizeBandFromTireSize(item.size);
    const band = appointmentServices.SIZE_BANDS[bandId];
    if (!band) {
      return { ok: false, message: `Off-rim swap prices cover 14 to 24 inch rims. The selected size is ${item.size}.` };
    }
    const current = groups.get(bandId) || { band, qty: 0, sizes: [] };
    current.qty += item.qty;
    if (!current.sizes.includes(item.size)) current.sizes.push(item.size);
    groups.set(bandId, current);
  }
  const lines = [...groups.values()].map((group) => ({
    band: group.band,
    sizes: group.sizes,
    qty: group.qty,
    unitPrice: group.band.unitPrice,
    subtotal: roundMoney(group.band.unitPrice * group.qty),
  }));
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const hst = roundMoney(subtotal * appointmentServices.TAX_RATE);
  return { ok: true, lines, subtotal, hst, total: roundMoney(subtotal + hst), qty: lines.reduce((sum, line) => sum + line.qty, 0) };
}

function readInstallation(payload) {
  const installation = payload?.installation || {};
  const plate = String(installation.plate || '').trim().toUpperCase();
  const date = String(installation.date || '').trim();
  const time = String(installation.time || '').trim();
  const tomorrow = torontoDate(1);
  if (installation.location !== 'shop') return { ok: false, message: 'Choose the EastCord shop before ordering installation.' };
  if (plate.length < 2) return { ok: false, message: 'Enter the license plate for this installation.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < tomorrow) {
    return { ok: false, message: 'Choose an appointment date and time before payment.' };
  }
  const start = timeWindowStartMinutes(time);
  const tooEarly = date === tomorrow && start !== null && start < (13 * 60);
  if (!INSTALL_TIME_WINDOWS.includes(time) || tooEarly) {
    return { ok: false, message: 'The first installation day starts at 1:00 PM. Choose a later time.' };
  }
  return { ok: true, plate, date, time, contact: installation.contact === 'phone' ? 'phone' : 'email' };
}

async function insertInstallBooking(supabaseAdmin, row) {
  const payload = { ...row };
  if (!payload.customer_id) delete payload.customer_id;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabaseAdmin.from('appointment_bookings').insert(payload).select('id').single();
    if (!error) return data?.id || '';
    const missing = String(error.message || '').match(/Could not find the '([^']+)' column/i)?.[1];
    if (missing && missing in payload) {
      delete payload[missing];
      continue;
    }
    console.error('[EastCord used tires] Installation booking could not be saved.', error.message || error);
    return '';
  }
  return '';
}

async function insertUsedTireOrder(supabaseAdmin, row) {
  const payload = { ...row };
  if (!payload.customer_id) delete payload.customer_id;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabaseAdmin.from('used_tire_orders').insert(payload).select('id').single();
    if (!error) return { order: data };
    const missing = String(error.message || '').match(/Could not find the '([^']+)' column/i)?.[1];
    if (missing && Object.prototype.hasOwnProperty.call(payload, missing)) {
      delete payload[missing];
      continue;
    }
    return { error };
  }
  return { error: { message: 'The used tire order could not be created.' } };
}

function normalizeCartItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      inventoryId: String(item.inventoryId || item.id || '').replace(/^used-tire-/i, '').trim(),
      qty: Math.max(1, Math.min(4, Number(item.qty) || 1)),
      brand: String(item.brand || '').trim(),
      size: String(item.size || '').trim(),
    }))
    .filter((item) => item.inventoryId);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) {
    return json(500, { message: 'Stripe checkout is missing STRIPE_SECRET_KEY. Add your test secret key to .netlify/.env and restart npm run dev.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Supabase admin configuration is missing.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid checkout request.' });
  }

  const customer = payload.customer || {};
  const cartItems = normalizeCartItems(payload.items);
  const fulfillmentPreference = payload.fulfillmentPreference === 'Installation' ? 'Installation' : 'Pickup';

  if (!cartItems.length) return json(400, { message: 'Add at least one used tire before checkout.' });
  const customerName = String(customer.name || '').trim();
  const customerEmail = String(customer.email || '').trim();
  const customerPhone = String(customer.phone || '').trim();
  const preferredContact = customer.contact === 'phone' ? 'phone' : 'email';
  if (customerName.split(/\s+/).filter(Boolean).length < 2) {
    return json(400, { message: 'Enter your first and last name before checkout.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    return json(400, { message: 'Enter a valid email address before checkout.' });
  }
  if (customerPhone.replace(/\D/g, '').length < 10) {
    return json(400, { message: 'Enter a phone number with at least 10 digits before checkout.' });
  }

  const verifiedUser = await getVerifiedUser(event, supabaseAdmin);

  const preparedItems = [];
  for (const item of cartItems) {
    const devInventory = isDevInventoryTable();
    const { data: row, error } = await supabaseAdmin
      .from(inventoryTableName())
      .select(devInventory
        ? 'id, brand, model, tire_size, selling_price, current_stock, price_is_final, note'
        : 'id, brand, tire_size, selling_price, current_stock')
      .eq('id', item.inventoryId)
      .maybeSingle();

    if (error) return json(500, { message: error.message });
    const stock = Math.max(0, Number(row?.current_stock) || 0);
    const listPrice = Number(row?.selling_price);
    const priceIsFinal = devInventory && row?.price_is_final === true;
    const price = getUsedTireUnitPrice(listPrice, stock, { priceIsFinal });
    if (!row || !stock || price === null) {
      return json(409, { message: `${item.brand || 'A selected tire'} is no longer available. Remove it and try again.` });
    }
    if (item.qty > stock) {
      return json(409, { message: `Only ${stock} ${row.brand} ${row.tire_size} tire(s) are left.` });
    }

    const markdown = priceIsFinal ? false : isMarkdownStock(stock);
    preparedItems.push({
      inventoryId: row.id,
      qty: item.qty,
      brand: row.brand || item.brand,
      model: row.model || item.model || '',
      note: row.note || item.note || '',
      size: row.tire_size || item.size,
      listPrice: roundMoney(listPrice),
      unitPrice: price,
      markdown,
      lineTotal: priceIsFinal
        ? priceForSetQuantity(listPrice, listedSetCount(stock), item.qty)
        : roundMoney(price * item.qty),
    });
  }

  const tireSubtotal = roundMoney(preparedItems.reduce((sum, item) => sum + item.lineTotal, 0));
  let install = null;
  let installation = null;
  if (fulfillmentPreference === 'Installation') {
    installation = readInstallation(payload);
    if (!installation.ok) return json(400, { message: installation.message });
    install = installQuote(preparedItems);
    if (!install.ok) return json(400, { message: install.message });
    const taken = await slotTakenBySomeoneElse(supabaseAdmin, {
      id: 'used-tire-install',
      preferred_date: installation.date,
      preferred_time_window: installation.time,
      install_location: 'shop',
    });
    if (taken) return json(409, { message: SLOT_TAKEN_MESSAGE });
  }
  const amounts = calculateTax(tireSubtotal);
  if (install) {
    amounts.subtotal = roundMoney(tireSubtotal + install.subtotal);
    amounts.hstAmount = install.hst;
    amounts.totalWithHst = roundMoney(amounts.subtotal + amounts.hstAmount);
    amounts.taxRate = appointmentServices.TAX_RATE;
  }
  const orderItems = install
    ? preparedItems.concat(install.lines.map((line) => ({
      brand: 'Off-rim swap + balance',
      size: line.sizes.join(', '),
      qty: line.qty,
      unitPrice: line.unitPrice,
      lineTotal: line.subtotal,
      installation: {
        plate: installation.plate,
        date: installation.date,
        time: installation.time,
        location: 'shop',
      },
    })), [{
      brand: 'HST (13%) on off-rim swap',
      size: '',
      qty: 1,
      unitPrice: install.hst,
      lineTotal: install.hst,
    }])
    : preparedItems;

  const orderInsert = await insertUsedTireOrder(supabaseAdmin, {
    customer_id: verifiedUser?.id || '',
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    preferred_contact: preferredContact,
    fulfillment_preference: fulfillmentPreference,
    items: orderItems,
    subtotal: amounts.subtotal,
    hst_amount: amounts.hstAmount,
    total_with_hst: amounts.totalWithHst,
    tax_rate: amounts.taxRate,
    payment_status: 'pending_checkout',
    fulfillment_status: 'unfulfilled',
  });
  const order = orderInsert.order;
  const orderError = orderInsert.error;

  if (orderError || !order) {
    const detail = orderError?.message || 'The used tire order could not be created.';
    const needsGuestColumn = /customer_id/i.test(detail) && /null|not-null/i.test(detail);
    return json(500, {
      message: needsGuestColumn
        ? 'Used tire orders still require an account in the database. Run supabase/used-tire-guest-checkout.sql in the Supabase SQL editor, then try again.'
        : detail,
    });
  }

  let appointmentId = '';
  if (install) {
    appointmentId = await insertInstallBooking(supabaseAdmin, {
      customer_id: verifiedUser?.id || '',
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      service_id: 'off-rim-swap',
      service_name: 'Off-rim swap + balance',
      starting_price: install.subtotal,
      service_subtotal: install.subtotal,
      hst_amount: install.hst,
      total_with_hst: install.total,
      deposit_amount: 0,
      remaining_balance: install.total,
      tax_rate: appointmentServices.TAX_RATE,
      preferred_date: installation.date,
      preferred_time_window: installation.time,
      vehicle_year: '',
      vehicle_make: '',
      vehicle_model: '',
      vehicle_plate_number: installation.plate,
      vehicle_colour: '',
      tire_size: install.lines.flatMap((line) => line.sizes).join(', '),
      tires_already_on_rims: '',
      number_of_tires: install.qty,
      full_service_address: '600 Harrop Drive, Milton, Ontario',
      city: 'Milton',
      postal_code: '',
      parking_access_notes: '',
      install_location: 'shop',
      additional_notes: `Linked used tire order ${order.id}`,
      linked_tires: preparedItems.map((item) => ({
        inventoryId: item.inventoryId,
        brand: item.brand,
        size: item.size,
        qty: item.qty,
      })),
      service_area_status: 'In service area',
      booking_status: 'Pending Confirmation',
      payment_status: 'pending_checkout',
      updated_at: new Date().toISOString(),
    });
  }

  const siteUrl = getSiteUrl(event);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const installDescription = install
    ? `License plate ${installation.plate}. Appointment ${installation.date} ${installation.time}. EastCord shop, 600 Harrop Drive, Milton.`
    : '';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail,
      line_items: [
        ...preparedItems.map((item) => ({
          price_data: {
            currency: 'cad',
            product_data: {
              name: `${item.brand} ${item.size} used tire${item.markdown ? ` — ${MARKDOWN_PERCENT}% off` : ''}`,
              description: `Quantity ${item.qty}${item.markdown ? ' · low-stock markdown' : ''}`,
            },
            unit_amount: Math.round(item.unitPrice * 100),
          },
          quantity: item.qty,
        })),
        ...(install ? install.lines.map((line) => ({
          price_data: {
            currency: 'cad',
            product_data: {
              name: `Off-rim swap + balance — ${line.band.label}`,
              description: installDescription,
            },
            unit_amount: Math.round(line.unitPrice * 100),
          },
          quantity: line.qty,
        })) : []),
        ...(install ? [{
          price_data: {
            currency: 'cad',
            product_data: {
              name: 'HST (13%) on off-rim swap',
              description: installDescription,
            },
            unit_amount: Math.round(install.hst * 100),
          },
          quantity: 1,
        }] : []),
      ],
      success_url: `${siteUrl}/tire-reservation-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/tire-cart.html`,
      metadata: {
        order_type: 'used_tire',
        order_id: order.id,
        customer_id: verifiedUser?.id || '',
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        preferred_contact: preferredContact,
        appointment_id: appointmentId,
      },
    });

    await supabaseAdmin
      .from('used_tire_orders')
      .update({
        stripe_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    return json(200, { url: session.url, testMode: isStripeTestMode() });
  } catch (error) {
    console.error('[EastCord used tires] Stripe Checkout session creation failed.', error);
    return json(500, { message: error.message || 'Secure checkout could not be started.' });
  }
};
