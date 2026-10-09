const { createClient } = require('@supabase/supabase-js');
const { listCalendarSlots, slotKey } = require('./lib/appointment-calendars');

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

function bookingLocation(row) {
  const explicit = String(row?.install_location || row?.installLocation || '').trim().toLowerCase();
  if (explicit === 'shop') return 'shop';
  if (explicit === 'mobile') return 'mobile';
  if (String(row?.city || '').trim().toLowerCase() === 'eastcord shop') return 'shop';
  return 'mobile';
}

function getSlotKey(date, timeWindow, location) {
  return `${date || ''}__${timeWindow || ''}__${location === 'shop' ? 'shop' : 'mobile'}`;
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

  const calendarSlots = await listCalendarSlots(supabase, [date]);
  if (!calendarSlots.missing && !calendarSlots.error) {
    const slots = calendarSlots.slots.map((row) => slotKey(row.slot_date, row.time_window, row.calendar));
    const shop = slots.filter((key) => key.endsWith('__shop'));
    const mobile = slots.filter((key) => key.endsWith('__mobile'));
    return json(200, { slots, shop, mobile });
  }
  if (calendarSlots.error) {
    console.error('[EastCord appointment automation] Calendar tables could not be read.', calendarSlots.error);
  }

  const { data, error } = await supabase
    .from('appointment_bookings')
    .select('preferred_date, preferred_time_window, install_location, city')
    .eq('preferred_date', date)
    .eq('payment_status', 'paid_deposit')
    .eq('booking_status', 'Confirmed');

  if (error) {
    console.error('[EastCord appointment automation] Confirmed paid slots could not be loaded.', error);
    return json(200, { slots: [], shop: [], mobile: [] });
  }

  const slots = [...new Set((data || [])
    .map((row) => getSlotKey(row.preferred_date, row.preferred_time_window, bookingLocation(row)))
    .filter(Boolean))];
  const shop = slots.filter((slot) => slot.endsWith('__shop'));
  const mobile = slots.filter((slot) => slot.endsWith('__mobile'));

  return json(200, { slots, shop, mobile });
};
