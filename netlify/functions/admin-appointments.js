const { requireAdminUser } = require('./lib/admin-auth');

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
  const timeA = String(a.preferred_time_window || '');
  const timeB = String(b.preferred_time_window || '');
  if (timeA !== timeB) return timeA.localeCompare(timeB);
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { message: 'Method not allowed.' });

  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  const requestedDate = String(event.queryStringParameters?.date || '').trim();
  const date = isValidDate(requestedDate) ? requestedDate : torontoDateString();

  const { data, error } = await auth.supabaseAdmin
    .from('appointment_bookings')
    .select([
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
    ].join(', '))
    .eq('preferred_date', date)
    .order('preferred_time_window', { ascending: true });

  if (error) {
    console.error('[EastCord admin] appointment list failed.', error);
    return json(500, { message: 'Appointments could not be loaded right now.' });
  }

  const appointments = (Array.isArray(data) ? data : []).slice().sort(sortAppointments);

  return json(200, {
    date,
    count: appointments.length,
    appointments,
  });
};
