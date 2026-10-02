const { createClient } = require('@supabase/supabase-js');

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

function isYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function getSlotKey(date, timeWindow) {
  return `${date || ''}__${timeWindow || ''}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { message: 'Method not allowed.' });

  const date = String(event.queryStringParameters?.date || '').trim();
  if (!isYmd(date)) return json(400, { message: 'A valid date is required.' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json(200, { slots: [] });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('appointment_bookings')
    .select('preferred_date, preferred_time_window')
    .eq('preferred_date', date)
    .eq('payment_status', 'paid_deposit')
    .eq('booking_status', 'Confirmed');

  if (error) {
    console.error('[EastCord appointment automation] Confirmed paid slots could not be loaded.', error);
    return json(200, { slots: [] });
  }

  const slots = [...new Set((data || [])
    .map((row) => getSlotKey(row.preferred_date, row.preferred_time_window))
    .filter(Boolean))];

  return json(200, { slots });
};
