const { requireAdminUser } = require('./lib/admin-auth');

const TIME_WINDOWS = Object.freeze([
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
]);

const APPOINTMENT_SELECT = [
  'id',
  'customer_name',
  'customer_email',
  'customer_phone',
  'service_id',
  'service_name',
  'starting_price',
  'service_subtotal',
  'hst_amount',
  'total_with_hst',
  'deposit_amount',
  'remaining_balance',
  'preferred_date',
  'preferred_time_window',
  'vehicle_year',
  'vehicle_make',
  'vehicle_model',
  'vehicle_plate_number',
  'vehicle_colour',
  'tire_size',
  'number_of_tires',
  'full_service_address',
  'city',
  'postal_code',
  'parking_access_notes',
  'additional_notes',
  'install_location',
  'booking_status',
  'payment_status',
  'linked_tires',
  'new_tire_order_id',
  'created_at',
  'updated_at',
].join(', ');

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

function torontoDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function sortAppointments(a, b) {
  const dateA = String(a.preferred_date || '');
  const dateB = String(b.preferred_date || '');
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  const timeA = String(a.preferred_time_window || '');
  const timeB = String(b.preferred_time_window || '');
  if (timeA !== timeB) return timeA.localeCompare(timeB);
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { message: 'Method not allowed.' });

  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  const params = event.queryStringParameters || {};
  const requestedDate = String(params.date || '').trim();
  const requestedFrom = String(params.from || '').trim();
  const requestedTo = String(params.to || '').trim();

  let query = auth.supabaseAdmin
    .from('appointment_bookings')
    .select(APPOINTMENT_SELECT);

  let date = null;
  let from = null;
  let to = null;

  if (isValidDate(requestedFrom) && isValidDate(requestedTo)) {
    from = requestedFrom;
    to = requestedTo;
    if (from > to) {
      return json(400, { message: 'The calendar start date must be on or before the end date.' });
    }
    query = query.gte('preferred_date', from).lte('preferred_date', to);
  } else {
    date = isValidDate(requestedDate) ? requestedDate : torontoDateString();
    from = date;
    to = date;
    query = query.eq('preferred_date', date);
  }

  const { data, error } = await query.order('preferred_date', { ascending: true });

  if (error) {
    console.error('[EastCord admin] appointment list failed.', error);
    return json(500, { message: 'Appointments could not be loaded right now.' });
  }

  const appointments = (Array.isArray(data) ? data : []).slice().sort(sortAppointments);

  return json(200, {
    date,
    from,
    to,
    count: appointments.length,
    timeWindows: TIME_WINDOWS,
    appointments,
  });
};
