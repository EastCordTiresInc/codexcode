const { requireAdminUser } = require('./lib/admin-auth');
const { sendEmail, CONTACT_EMAIL, getEmailConfig, buildBrandedEmail, ACCOUNT_URL } = require('./lib/send-email');
const { buildArrivalEmail, greetingName } = require('./lib/new-tire-order');

const ORDER_SELECT = [
  'id',
  'customer_id',
  'customer_name',
  'customer_email',
  'customer_phone',
  'fulfillment_preference',
  'fulfillment_status',
  'items',
  'vehicle',
  'notes',
  'total_with_hst',
  'payment_status',
  'paid_at',
  'created_at',
  'updated_at',
  'pickup_ready_at',
  'pickup_ready_emailed_at',
  'picked_up_at',
  'tireconnect_order_number',
].join(',');

const ORDER_SELECT_FALLBACK = [
  'id',
  'customer_id',
  'customer_name',
  'customer_email',
  'customer_phone',
  'fulfillment_preference',
  'fulfillment_status',
  'items',
  'vehicle',
  'notes',
  'total_with_hst',
  'payment_status',
  'paid_at',
  'created_at',
  'updated_at',
].join(',');

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

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return null;
  }
}

const USED_SELECT = [
  'id',
  'customer_id',
  'customer_name',
  'customer_email',
  'customer_phone',
  'fulfillment_preference',
  'fulfillment_status',
  'items',
  'total_with_hst',
  'payment_status',
  'paid_at',
  'created_at',
  'updated_at',
].join(',');

function withKind(order, tireKind) {
  return order ? { ...order, tireKind } : null;
}

function usedItemLines(order) {
  return (Array.isArray(order?.items) ? order.items : []).map((item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const label = [item.brand, item.size || item.tire_size].filter(Boolean).join(' ') || 'Used tire';
    return `${qty} x ${label}`;
  });
}

function buildUsedReadyEmail(order) {
  const name = greetingName(order.customer_name);
  const lines = usedItemLines(order);
  return buildBrandedEmail({
    to: order.customer_email,
    subject: name
      ? `${name}, your EastCord used tires are ready for pickup`
      : 'Your EastCord used tires are ready for pickup',
    heading: 'Your used tires are ready',
    body: [
      name ? `Hello ${name},` : 'Hello,',
      'Your used tires are at EastCord Tires, 600 Harrop Drive in Milton.',
      'Come by during shop hours, 8:00 AM to 8:00 PM. No appointment is needed.',
    ],
    actionUrl: ACCOUNT_URL,
    actionLabel: 'View your account',
    extraText: lines.join('\n'),
    extraHtml: lines.length
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">${lines.map((line) => String(line).replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br />')}</p>`
      : '',
    footer: 'If you have questions, call EastCord Tires at 365-822-5553.',
  });
}

function readyEmailFor(order) {
  return order.tireKind === 'Used' ? buildUsedReadyEmail(order) : buildArrivalEmail(order);
}

function isMissingColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('pickup_ready')
    || message.includes('picked_up_at')
    || message.includes('tireconnect_order_number')
    || (message.includes('column') && message.includes('does not exist'));
}

async function listNewOrders(supabaseAdmin) {
  let { data, error } = await supabaseAdmin
    .from('new_tire_orders')
    .select(ORDER_SELECT)
    .eq('payment_status', 'paid')
    .order('paid_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabaseAdmin
      .from('new_tire_orders')
      .select(ORDER_SELECT_FALLBACK)
      .eq('payment_status', 'paid')
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }));
  }
  return { orders: (data || []).map((order) => withKind(order, 'New')), error };
}

async function listUsedOrders(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
    .from('used_tire_orders')
    .select(USED_SELECT)
    .eq('payment_status', 'paid')
    .order('paid_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  return { orders: (data || []).map((order) => withKind(order, 'Used')), error };
}

async function listOrders(supabaseAdmin) {
  const [neu, used] = await Promise.all([
    listNewOrders(supabaseAdmin),
    listUsedOrders(supabaseAdmin),
  ]);
  if (neu.error) return { error: neu.error };
  if (used.error) return { error: used.error };
  const orders = [...neu.orders, ...used.orders].sort((a, b) => {
    const aDate = new Date(a.paid_at || a.created_at || 0).getTime();
    const bDate = new Date(b.paid_at || b.created_at || 0).getTime();
    return bDate - aDate;
  });
  return { orders };
}

async function loadOrder(supabaseAdmin, orderId, tireKind) {
  const preferUsed = String(tireKind || '').toLowerCase() === 'used';
  const tables = preferUsed
    ? [['used_tire_orders', 'Used'], ['new_tire_orders', 'New']]
    : [['new_tire_orders', 'New'], ['used_tire_orders', 'Used']];

  for (const [table, kind] of tables) {
    const select = table === 'used_tire_orders' ? USED_SELECT : ORDER_SELECT;
    let { data, error } = await supabaseAdmin
      .from(table)
      .select(select)
      .eq('id', orderId)
      .maybeSingle();
    if (error && table === 'new_tire_orders' && isMissingColumnError(error)) {
      ({ data, error } = await supabaseAdmin
        .from(table)
        .select(ORDER_SELECT_FALLBACK)
        .eq('id', orderId)
        .maybeSingle());
    }
    if (error) return { order: null, error };
    if (data) return { order: withKind(data, kind), error: null };
  }
  return { order: null, error: null };
}

async function updateOrder(supabaseAdmin, order, fields) {
  const table = order.tireKind === 'Used' ? 'used_tire_orders' : 'new_tire_orders';
  const withTracking = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  const select = table === 'used_tire_orders' ? USED_SELECT : ORDER_SELECT;
  let { data, error } = await supabaseAdmin
    .from(table)
    .update(withTracking)
    .eq('id', order.id)
    .select(select)
    .maybeSingle();

  if (error && isMissingColumnError(error)) {
    const fallbackFields = { fulfillment_status: fields.fulfillment_status, updated_at: withTracking.updated_at };
    ({ data, error } = await supabaseAdmin
      .from(table)
      .update(fallbackFields)
      .eq('id', order.id)
      .select(table === 'used_tire_orders' ? USED_SELECT : ORDER_SELECT_FALLBACK)
      .maybeSingle());
  }

  return { order: data ? withKind(data, order.tireKind) : null, error };
}

async function markReady(supabaseAdmin, order, { resend = false } = {}) {
  if (String(order.payment_status || '') !== 'paid') {
    return json(409, { message: 'Only paid orders can be marked ready.' });
  }

  const alreadyEmailed = Boolean(order.pickup_ready_emailed_at);
  if (alreadyEmailed && !resend) {
    return json(200, {
      ok: true,
      emailed: false,
      alreadyReady: true,
      order,
      message: 'This customer was already emailed. Use Send again if you need another copy.',
    });
  }

  if (!order.customer_email) {
    return json(400, { message: 'This order has no customer email, so the ready notice cannot be sent.' });
  }

  const emailConfig = getEmailConfig();
  if (!emailConfig.apiKey) {
    console.error('[EastCord orders] RESEND_API_KEY is missing; cannot email customer.');
    return json(503, {
      message: 'Email is not configured on this computer. Add RESEND_API_KEY to .netlify/.env and restart the admin server (port 8888).',
      reason: 'missing_resend_api_key',
    });
  }

  const email = readyEmailFor(order);
  const sent = await sendEmail({
    to: order.customer_email,
    replyTo: CONTACT_EMAIL,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  if (!sent.ok) {
    console.error('[EastCord orders] Ready email failed.', {
      reason: sent.reason || 'send_failed',
      status: sent.status || '',
    });
    return json(502, {
      message: sent.reason === 'missing_resend_api_key'
        ? 'Email is not configured on this computer. Add RESEND_API_KEY to .netlify/.env and restart the admin server (port 8888).'
        : sent.resendMessage
          ? `The customer email could not be sent: ${sent.resendMessage}`
          : 'The customer email could not be sent. Try again in a moment.',
      reason: sent.reason || 'send_failed',
    });
  }

  const now = new Date().toISOString();
  const fulfillment = order.fulfillment_preference === 'Installation' ? 'Installation' : 'Pickup';
  const { order: updated, error } = await updateOrder(supabaseAdmin, order, {
    fulfillment_status: fulfillment === 'Installation' ? 'arrived' : 'ready_for_pickup',
    pickup_ready_at: order.pickup_ready_at || now,
    pickup_ready_emailed_at: now,
  });
  if (error) {
    console.error('[EastCord orders] Ready email sent but status update failed.', error.message);
    return json(502, { message: 'The email was sent, but the order status could not be saved.' });
  }

  return json(200, {
    ok: true,
    emailed: true,
    order: updated || order,
    message: fulfillment === 'Installation'
      ? 'Customer emailed to book installation.'
      : 'Customer emailed that the tires are ready for pickup.',
  });
}

async function markPickedUp(supabaseAdmin, order) {
  if (String(order.payment_status || '') !== 'paid') {
    return json(409, { message: 'Only paid orders can be marked picked up.' });
  }

  const now = new Date().toISOString();
  const { order: updated, error } = await updateOrder(supabaseAdmin, order, {
    fulfillment_status: 'picked_up',
    picked_up_at: now,
  });
  if (error) {
    return json(502, { message: 'The order could not be marked picked up.' });
  }

  return json(200, {
    ok: true,
    order: updated || order,
    message: 'Order marked as picked up.',
  });
}

exports.handler = async (event) => {
  const emailConfig = getEmailConfig();
  console.log('[EastCord orders] email config', {
    hasApiKey: Boolean(emailConfig.apiKey),
    apiKeyLength: emailConfig.apiKey ? emailConfig.apiKey.length : 0,
    netlifyDev: String(process.env.NETLIFY_DEV || ''),
    method: event.httpMethod,
  });

  const auth = await requireAdminUser(event);
  if (auth.error) {
    return json(auth.error.statusCode, { message: auth.error.message });
  }

  if (event.httpMethod === 'GET') {
    const { orders, error } = await listOrders(auth.supabaseAdmin);
    if (error) {
      console.error('[EastCord orders] List failed.', error.message);
      return json(500, { message: 'Orders could not be loaded.' });
    }
    return json(200, { orders });
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  const body = parseBody(event);
  if (!body) {
    return json(400, { message: 'Request body must be valid JSON.' });
  }

  const orderId = String(body.orderId || body.id || '').trim();
  const action = String(body.action || '').trim();
  if (!orderId) {
    return json(400, { message: 'Order id is required.' });
  }

  const { order, error } = await loadOrder(auth.supabaseAdmin, orderId, body.tireKind);
  if (error) {
    console.error('[EastCord orders] Load failed.', error.message);
    return json(500, { message: 'That order could not be loaded.' });
  }
  if (!order) {
    return json(404, { message: 'Order not found.' });
  }

  if (action === 'markReady') {
    return markReady(auth.supabaseAdmin, order, { resend: false });
  }
  if (action === 'resendReady') {
    return markReady(auth.supabaseAdmin, order, { resend: true });
  }
  if (action === 'markPickedUp') {
    return markPickedUp(auth.supabaseAdmin, order);
  }

  return json(400, { message: 'Unknown order action.' });
};
