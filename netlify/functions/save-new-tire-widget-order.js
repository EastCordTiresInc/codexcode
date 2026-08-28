const { createClient } = require('@supabase/supabase-js');
const { recordWidgetNewTireOrder } = require('./lib/new-tire-order');

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
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Supabase admin configuration is missing.' });

  const token = getBearerToken(event);
  if (!token) return json(401, { message: 'Please log in before placing this order.' });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return json(401, { message: 'Please log in before placing this order.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid order request.' });
  }

  const customer = payload.customer || {};
  if (!required(customer.name) || !required(customer.email) || !required(customer.phone)) {
    return json(400, { message: 'Name, email, and phone are required.' });
  }

  console.log('[EastCord new tires] save-new-tire-widget-order', {
    userId: authData.user.id,
    orderNumber: payload.orderNumber || '',
    recordedLocally: Boolean(payload.recordedLocally),
    fulfillment: payload.fulfillment || '',
    itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
  });

  const result = await recordWidgetNewTireOrder({
    supabaseAdmin,
    userId: authData.user.id,
    customer,
    items: payload.items,
    fulfillment: payload.fulfillment,
    vehicle: payload.vehicle,
    notes: payload.notes,
    orderNumber: payload.orderNumber,
    recordedLocally: Boolean(payload.recordedLocally),
    totals: payload.totals,
    appointments: payload.appointments,
  });

  if (!result.ok) {
    return json(result.statusCode || 500, { message: result.message || 'The order could not be saved.' });
  }

  return json(200, {
    ok: true,
    saved: true,
    alreadySaved: Boolean(result.alreadyPaid),
    orderId: result.order?.id || '',
    appointmentIds: result.appointmentIds || [],
    appointmentCount: result.appointmentCount || 0,
  });
};
