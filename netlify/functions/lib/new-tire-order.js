const { sendEmail, getEmailConfig, CONTACT_EMAIL } = require('./send-email');

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

function getOrderItems(order) {
  return Array.isArray(order?.items) ? order.items : [];
}

function itemLabel(item) {
  return [item.brand, item.model, item.size].filter(Boolean).join(' ') || 'New tire';
}

function nextStep(fulfillment, orderId) {
  if (fulfillment !== 'Installation') {
    return 'When the tires are in, email or text the customer that the order is ready for pickup. No appointment.';
  }
  const bookingUrl = orderId
    ? `https://eastcordtires.ca/appointment.html?source=new-tires&newTireOrder=${encodeURIComponent(orderId)}#appointment-booking`
    : 'https://eastcordtires.ca/appointment';
  return `Order is confirmed. Customer can book installation now: ${bookingUrl}`;
}

async function notifyPaidNewTireOrder(order) {
  const items = getOrderItems(order);
  const itemLines = items.map((item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const part = item.partNumber ? ` (${item.partNumber})` : '';
    return `${qty} x ${itemLabel(item)}${part} @ ${formatMoney(item.unitPrice || item.price)}`;
  });
  const fulfillment = order.fulfillment_preference === 'Installation' ? 'Installation' : 'Pickup';
  const vehicle = order.vehicle || {};
  const vehicleLine = [vehicle.year, vehicle.make, vehicle.model, vehicle.submodel].filter(Boolean).join(' ');
  const customerName = String(order.customer_name || 'Customer').trim() || 'Customer';
  const config = getEmailConfig();

  const tireconnectNumber = String(order.tireconnect_order_number || '')
    .trim() || String(order.stripe_session_id || '').replace(/^tireconnect:/, '');
  const staffText = [
    'Paid new tire order',
    '',
    `EastCord order: ${order.id}`,
    tireconnectNumber ? `TireConnect order #: ${tireconnectNumber}` : '',
    String(order.stripe_session_id || '').includes('local-') || String(order.stripe_session_id || '').includes('demo-')
      ? 'Recorded from EastCord local/demo checkout (no live card charge required)'
      : 'Paid in the TireConnect widget',
    `Name: ${customerName}`,
    `Email: ${order.customer_email || ''}`,
    `Phone: ${order.customer_phone || ''}`,
    `Fulfillment: ${fulfillment}`,
    vehicleLine ? `Vehicle: ${vehicleLine}` : '',
    order.notes ? `Notes: ${order.notes}` : '',
    '',
    'Tires:',
    ...itemLines,
    '',
    `Total charged: ${formatMoney(order.total_with_hst)}`,
    '',
    nextStep(fulfillment, order.id),
  ].filter((line) => line !== undefined).join('\n');

  const bookingUrl = order.id
    ? `https://eastcordtires.ca/appointment.html?source=new-tires&newTireOrder=${encodeURIComponent(order.id)}#appointment-booking`
    : 'https://eastcordtires.ca/appointment';
  const customerText = fulfillment === 'Installation'
    ? [
      `Hello ${customerName},`,
      '',
      'EastCord Tires received your new tire payment. This order is confirmed.',
      'You can book installation now. You cannot book for the next 4 days after your purchase date. Hours are 8:00 AM to 8:00 PM. Use this link so the appointment stays tied to these new tires:',
      bookingUrl,
      '',
      ...itemLines,
      `Total paid: ${formatMoney(order.total_with_hst)}`,
      '',
      'This purchase is saved to your EastCord account.',
      'info@eastcordtires.ca · 365-822-5553',
    ].join('\n')
    : [
      `Hello ${customerName},`,
      '',
      'EastCord Tires received your new tire payment for store pickup.',
      'We will email you when the tires are ready to pick up. No appointment is needed.',
      '',
      ...itemLines,
      `Total paid: ${formatMoney(order.total_with_hst)}`,
      '',
      'This purchase is saved to your EastCord account.',
      'info@eastcordtires.ca · 365-822-5553',
    ].join('\n');

  await sendEmail({
    to: config.eastcordTo || CONTACT_EMAIL,
    replyTo: order.customer_email || CONTACT_EMAIL,
    subject: `Paid new tire order — ${fulfillment} — ${customerName}`,
    text: staffText,
    html: `<pre style="font: 15px/1.5 sans-serif; white-space: pre-wrap;">${escapeHtml(staffText)}</pre>`,
  });

  if (order.customer_email) {
    await sendEmail({
      to: order.customer_email,
      replyTo: CONTACT_EMAIL,
      subject: fulfillment === 'Installation'
        ? 'EastCord Tires payment received — book installation with this order'
        : 'EastCord Tires payment received — we will confirm pickup',
      text: customerText,
      html: `<pre style="font: 15px/1.5 sans-serif; white-space: pre-wrap;">${escapeHtml(customerText)}</pre>`,
    });
  }
}

async function fulfillPaidNewTireOrder({ supabaseAdmin, session }) {
  const sessionId = session?.id || '';
  const orderId = String(session?.metadata?.order_id || '').trim();

  let query = supabaseAdmin.from('new_tire_orders').select('*');
  if (orderId) query = query.eq('id', orderId);
  else query = query.eq('stripe_session_id', sessionId);

  const { data: order, error: loadError } = await query.maybeSingle();
  if (loadError) {
    return { ok: false, statusCode: 500, message: loadError.message, error: loadError };
  }
  if (!order) {
    return { ok: false, statusCode: 404, message: 'New tire order was not found.' };
  }

  if (order.payment_status === 'paid') {
    return { ok: true, alreadyPaid: true, order };
  }

  const { data: paidOrder, error: payError } = await supabaseAdmin
    .from('new_tire_orders')
    .update({
      payment_status: 'paid',
      fulfillment_status: 'paid_ready',
      stripe_session_id: sessionId || order.stripe_session_id,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select('*')
    .single();

  if (payError) {
    return { ok: false, statusCode: 500, message: payError.message, error: payError, order };
  }

  try {
    await notifyPaidNewTireOrder(paidOrder);
  } catch (error) {
    console.error('[EastCord new tires] Paid-order email failed.', error);
  }

  return { ok: true, alreadyPaid: false, order: paidOrder };
}

function cleanWidgetText(value) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/found\s+\d+\s+tires(?:\s+for:?\s*)?/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[:\-–]+\s*/, '')
    .trim();
  if (!text) return '';
  if (/^(tires for:?|price summary|add to cart|see out|revise search|warranty)$/i.test(text)) return '';
  return text.slice(0, 80);
}

function cleanTireSize(value) {
  const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
  const metric = compact.match(/(\d{3}\/\d{2}Z?R\d{2})/);
  if (metric) return metric[1];
  const flotation = compact.match(/(\d{2}X\d{2}(?:\.\d{1,2})?R\d{2})/);
  if (flotation) return flotation[1];
  const text = String(value || '').trim();
  if (!text || /warranty|found\s+\d+\s+tires|tires for/i.test(text)) return '';
  return text.slice(0, 24);
}

function normalizeWidgetItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const qty = Math.max(1, Math.min(8, Number(item.qty ?? item.quantity ?? item.selectedQuantity ?? item.selected_quantity) || 1));
      const unitPrice = Math.max(0, roundMoney(item.unitPrice ?? item.price ?? item.unit_price ?? item.price_per_tire ?? item.retail_price ?? 0));
      return {
        kind: 'new_tire',
        brand: cleanWidgetText(item.brand || item.brand_name || item.manufacturer || item.tire_brand),
        model: cleanWidgetText(item.model || item.model_name || item.product_name || item.tire_model),
        size: cleanTireSize(item.size || item.sizeShort || item.size_short || item.tire_size || item.size_display),
        qty,
        unitPrice,
        price: unitPrice,
        partNumber: String(item.partNumber || item.part_number || '').trim().slice(0, 40),
        lineTotal: roundMoney(unitPrice * qty),
      };
    })
    .filter((item) => item.brand || item.model || item.size);
}

async function recordWidgetNewTireOrder({
  supabaseAdmin,
  userId,
  customer,
  items,
  fulfillment,
  vehicle,
  notes,
  orderNumber,
  recordedLocally,
  totals,
  appointments,
}) {
  const preparedItems = normalizeWidgetItems(items);
  const orderKey = String(orderNumber || '').trim() ? `tireconnect:${String(orderNumber).trim()}` : '';

  const attach = async (order) => {
    const appointmentIds = await attachAppointmentsToNewTireOrder({
      supabaseAdmin,
      userId,
      customer,
      order,
      appointments,
    });
    return { appointmentIds, appointmentCount: appointmentIds.length };
  };

  if (orderKey) {
    const { data: existing } = await supabaseAdmin
      .from('new_tire_orders')
      .select('*')
      .eq('stripe_session_id', orderKey)
      .maybeSingle();
    if (existing) {
      const linked = await attach(existing);
      return { ok: true, alreadyPaid: true, order: existing, ...linked };
    }
  }

  const itemTotal = roundMoney(preparedItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0));
  const subtotal = roundMoney(totals?.subtotal ?? itemTotal);
  const tax = roundMoney(totals?.tax ?? 0);
  const total = roundMoney(totals?.total ?? (subtotal + tax) ?? itemTotal);
  const noteLines = [
    String(notes || '').trim(),
    orderNumber ? `Order #: ${orderNumber}` : '',
    recordedLocally || /^(local-|demo-)/.test(String(orderNumber || ''))
      ? 'Recorded from EastCord local/demo checkout (no live card charge required)'
      : 'Paid in the TireConnect widget',
  ].filter(Boolean).join('\n');

  if (!preparedItems.length) {
    return { ok: false, statusCode: 400, message: 'The widget order did not include tire details.' };
  }

  console.log('[EastCord new tires] recordWidgetNewTireOrder', {
    userId,
    orderNumber: orderNumber || '',
    recordedLocally: Boolean(recordedLocally),
    itemCount: preparedItems.length,
    total,
  });

  const { data: order, error } = await supabaseAdmin
    .from('new_tire_orders')
    .insert({
      customer_id: userId,
      customer_name: String(customer?.name || '').trim(),
      customer_email: String(customer?.email || '').trim().toLowerCase(),
      customer_phone: String(customer?.phone || '').trim(),
      fulfillment_preference: fulfillment === 'Installation' ? 'Installation' : 'Pickup',
      items: preparedItems,
      vehicle: vehicle && typeof vehicle === 'object' ? vehicle : {},
      notes: noteLines,
      subtotal,
      hst_amount: tax,
      total_with_hst: total || subtotal,
      tax_rate: subtotal > 0 ? roundMoney(tax / subtotal) : 0,
      payment_status: 'paid',
      fulfillment_status: 'paid_ready',
      stripe_session_id: orderKey || null,
      paid_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error || !order) {
    return {
      ok: false,
      statusCode: 500,
      message: error?.message || 'The widget order could not be saved. Run supabase/new-tire-orders-schema.sql in Supabase first.',
      error,
    };
  }

  try {
    await notifyPaidNewTireOrder({ ...order, tireconnect_order_number: String(orderNumber || '').trim() });
  } catch (emailError) {
    console.error('[EastCord new tires] Widget-order email failed.', emailError);
  }

  const linked = await attach(order);
  return { ok: true, alreadyPaid: false, order, ...linked };
}

function textValue(value) {
  return String(value ?? '').trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function bookingRowFromAppointment({ userId, customer, item, orderId }) {
  const notes = [
    textValue(item.additionalNotes || item.additional_notes),
    orderId ? `Linked new tire order ${orderId}` : '',
  ].filter(Boolean).join('\n');
  return {
    customer_id: userId,
    customer_name: textValue(customer?.name || item.customerName || item.customer_name),
    customer_email: textValue(customer?.email || item.customerEmail || item.customer_email),
    customer_phone: textValue(customer?.phone || item.customerPhone || item.customer_phone),
    service_id: textValue(item.serviceId || item.service_id),
    service_name: textValue(item.serviceName || item.service_name),
    starting_price: roundMoney(item.startingPrice || item.starting_price || item.serviceSubtotal || 0),
    service_subtotal: roundMoney(item.serviceSubtotal || item.service_subtotal || item.startingPrice || 0),
    hst_amount: roundMoney(item.hstAmount || item.hst_amount || 0),
    total_with_hst: roundMoney(item.totalWithHst || item.total_with_hst || 0),
    deposit_amount: roundMoney(item.depositAmount || item.deposit_amount || 0),
    remaining_balance: roundMoney(item.remainingBalance || item.remaining_balance || 0),
    tax_rate: Number(item.taxRate || item.tax_rate || 0.13),
    preferred_date: textValue(item.preferredDate || item.preferred_date) || null,
    preferred_time_window: textValue(item.preferredTimeWindow || item.preferred_time_window),
    vehicle_year: textValue(item.vehicleYear || item.vehicle_year),
    vehicle_make: textValue(item.vehicleMake || item.vehicle_make),
    vehicle_model: textValue(item.vehicleModel || item.vehicle_model),
    vehicle_plate_number: textValue(item.vehiclePlateNumber || item.vehicle_plate_number),
    vehicle_colour: textValue(item.vehicleColour || item.vehicle_colour),
    tire_size: textValue(item.tireSize || item.tire_size),
    tires_already_on_rims: textValue(item.tiresAlreadyOnRims || item.tires_already_on_rims),
    number_of_tires: Number(item.numberOfTires || item.number_of_tires || 0),
    full_service_address: textValue(item.fullServiceAddress || item.full_service_address),
    city: textValue(item.city),
    postal_code: textValue(item.postalCode || item.postal_code),
    parking_access_notes: textValue(item.parkingAccessNotes || item.parking_access_notes),
    additional_notes: notes,
    new_tire_order_id: orderId || null,
    service_area_status: textValue(item.serviceAreaStatus || item.service_area_status) || 'In service area',
    booking_status: textValue(item.bookingStatus || item.booking_status) || 'Pending Confirmation',
    payment_status: textValue(item.paymentStatus || item.payment_status) || 'pending_checkout',
    updated_at: new Date().toISOString(),
  };
}

async function insertBookingRow(supabaseAdmin, row) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabaseAdmin
      .from('appointment_bookings')
      .insert(payload)
      .select('id')
      .single();
    if (!error) return data?.id || '';
    const missing = String(error.message || '').match(/Could not find the '([^']+)' column/i)?.[1]
      || (/new_tire_order_id/i.test(error.message || '') ? 'new_tire_order_id' : '');
    if (missing && missing in payload) {
      delete payload[missing];
      continue;
    }
    console.error('[EastCord new tires] Appointment insert failed.', error);
    return '';
  }
  return '';
}

async function attachAppointmentsToNewTireOrder({
  supabaseAdmin,
  userId,
  customer,
  order,
  appointments,
}) {
  if (!order?.id || !Array.isArray(appointments) || !appointments.length) return [];
  const savedIds = [];

  for (const item of appointments) {
    if (!item || !(item.serviceId || item.service_id || item.preferredDate || item.preferred_date)) continue;
    const bookingId = String(item.bookingId || '').trim();
    if (isUuid(bookingId)) {
      const update = {
        new_tire_order_id: order.id,
        additional_notes: [
          textValue(item.additionalNotes || item.additional_notes),
          `Linked new tire order ${order.id}`,
        ].filter(Boolean).join('\n'),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseAdmin
        .from('appointment_bookings')
        .update(update)
        .eq('id', bookingId)
        .eq('customer_id', userId)
        .select('id')
        .maybeSingle();
      if (!error && data?.id) {
        savedIds.push(data.id);
        continue;
      }
      if (error && /new_tire_order_id/i.test(String(error.message || ''))) {
        delete update.new_tire_order_id;
        const { data: retry } = await supabaseAdmin
          .from('appointment_bookings')
          .update(update)
          .eq('id', bookingId)
          .eq('customer_id', userId)
          .select('id')
          .maybeSingle();
        if (retry?.id) savedIds.push(retry.id);
        continue;
      }
    }

    const inserted = await insertBookingRow(
      supabaseAdmin,
      bookingRowFromAppointment({ userId, customer, item, orderId: order.id }),
    );
    if (inserted) savedIds.push(inserted);
  }

  return savedIds;
}

module.exports = {
  roundMoney,
  cleanWidgetText,
  cleanTireSize,
  normalizeWidgetItems,
  fulfillPaidNewTireOrder,
  recordWidgetNewTireOrder,
  attachAppointmentsToNewTireOrder,
};
