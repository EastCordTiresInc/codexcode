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

function nextStep(fulfillment) {
  return fulfillment === 'Installation'
    ? 'When the tires are in, email the customer this booking link: https://eastcordtires.ca/appointment'
    : 'When the tires are in, email or text the customer that the order is ready for pickup. No appointment.';
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
    String(order.stripe_session_id || '').includes('local-')
      ? 'Recorded from EastCord ORDER on price summary (no TireConnect card checkout)'
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
    nextStep(fulfillment),
  ].filter((line) => line !== undefined).join('\n');

  const customerText = fulfillment === 'Installation'
    ? [
      `Hello ${customerName},`,
      '',
      'EastCord Tires received your new tire payment.',
      'Do not book an appointment yet. When your tires arrive, we will email you a link to book installation.',
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
        ? 'EastCord Tires payment received — installation booking comes later'
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

function normalizeWidgetItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const qty = Math.max(1, Math.min(8, Number(item.qty) || 1));
      const unitPrice = roundMoney(item.unitPrice ?? item.price ?? 0);
      return {
        kind: 'new_tire',
        brand: String(item.brand || '').trim(),
        model: String(item.model || '').trim(),
        size: String(item.size || '').trim(),
        qty,
        unitPrice,
        price: unitPrice,
        partNumber: String(item.partNumber || item.part_number || '').trim(),
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
}) {
  const preparedItems = normalizeWidgetItems(items);
  const orderKey = String(orderNumber || '').trim() ? `tireconnect:${String(orderNumber).trim()}` : '';

  if (orderKey) {
    const { data: existing } = await supabaseAdmin
      .from('new_tire_orders')
      .select('*')
      .eq('stripe_session_id', orderKey)
      .maybeSingle();
    if (existing) {
      return { ok: true, alreadyPaid: true, order: existing };
    }
  }

  const itemTotal = roundMoney(preparedItems.reduce((sum, item) => sum + (item.lineTotal || 0), 0));
  const subtotal = roundMoney(totals?.subtotal ?? itemTotal);
  const tax = roundMoney(totals?.tax ?? 0);
  const total = roundMoney(totals?.total ?? (subtotal + tax) ?? itemTotal);
  const noteLines = [
    String(notes || '').trim(),
    orderNumber ? `Order #: ${orderNumber}` : '',
    recordedLocally || String(orderNumber || '').startsWith('local-')
      ? 'Recorded from EastCord ORDER on price summary (no TireConnect card checkout)'
      : 'Paid in the TireConnect widget',
  ].filter(Boolean).join('\n');

  if (!preparedItems.length && !noteLines) {
    return { ok: false, statusCode: 400, message: 'The widget order did not include tire details.' };
  }

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

  return { ok: true, alreadyPaid: false, order };
}

module.exports = {
  roundMoney,
  fulfillPaidNewTireOrder,
  recordWidgetNewTireOrder,
};
