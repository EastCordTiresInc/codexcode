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

const BOOKING_STATUSES = Object.freeze([
  'Pending Confirmation',
  'Confirmed',
  'Completed',
  'No-Show',
  'Cancelled',
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

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return null;
  }
}

function torontoStamp() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date());
}

async function listAppointments(supabaseAdmin, event) {
  const params = event.queryStringParameters || {};
  const requestedDate = String(params.date || '').trim();
  const requestedFrom = String(params.from || '').trim();
  const requestedTo = String(params.to || '').trim();

  let query = supabaseAdmin
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
    bookingStatuses: BOOKING_STATUSES,
    appointments,
  });
}

function torontoDateTimeParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute),
  };
}

function windowStartMinutes(windowLabel) {
  const start = String(windowLabel || '').split(' - ')[0]?.trim() || '';
  const match = start.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridian = match[3].toUpperCase();
  if (meridian === 'PM' && hour < 12) hour += 12;
  if (meridian === 'AM' && hour === 12) hour = 0;
  return (hour * 60) + minute;
}

function hasAppointmentStarted(dateValue, windowLabel) {
  const date = String(dateValue || '');
  const startMinutes = windowStartMinutes(windowLabel);
  if (!isValidDate(date) || startMinutes == null) return false;

  const now = torontoDateTimeParts();
  if (now.date > date) return true;
  if (now.date < date) return false;
  return now.minutes >= startMinutes;
}

async function updateAppointment(supabaseAdmin, event, staffEmail) {
  const body = parseBody(event);
  if (body === null) return json(400, { message: 'Request body must be valid JSON.' });

  const id = String(body.id || '').trim();
  if (!id) return json(400, { message: 'A valid appointment id is required.' });

  const bookingStatus = body.booking_status !== undefined
    ? String(body.booking_status || '').trim()
    : undefined;
  const preferredDate = body.preferred_date !== undefined
    ? String(body.preferred_date || '').trim()
    : undefined;
  const preferredTimeWindow = body.preferred_time_window !== undefined
    ? String(body.preferred_time_window || '').trim()
    : undefined;
  const staffNote = body.staff_note !== undefined
    ? String(body.staff_note || '').trim()
    : undefined;

  if (
    bookingStatus === undefined
    && preferredDate === undefined
    && preferredTimeWindow === undefined
    && staffNote === undefined
  ) {
    return json(400, { message: 'Provide a status, schedule, or staff note to update.' });
  }

  if (bookingStatus !== undefined && !BOOKING_STATUSES.includes(bookingStatus)) {
    return json(400, {
      message: `booking_status must be one of: ${BOOKING_STATUSES.join(', ')}.`,
    });
  }

  if (preferredDate !== undefined && !isValidDate(preferredDate)) {
    return json(400, { message: 'preferred_date must use YYYY-MM-DD.' });
  }

  if (preferredTimeWindow !== undefined && !TIME_WINDOWS.includes(preferredTimeWindow)) {
    return json(400, { message: 'preferred_time_window is not a valid shop time slot.' });
  }

  if ((preferredDate && !preferredTimeWindow) || (!preferredDate && preferredTimeWindow)) {
    // Allow updating only one schedule field when the other already exists on the row.
    // Validated after load.
  }

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('appointment_bookings')
    .select(APPOINTMENT_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (loadError) {
    console.error('[EastCord admin] appointment load failed.', loadError);
    return json(500, { message: 'Appointment could not be loaded.' });
  }
  if (!existing) {
    return json(404, { message: 'Appointment was not found.' });
  }

  if (
    bookingStatus === 'No-Show'
    && !hasAppointmentStarted(existing.preferred_date, existing.preferred_time_window)
  ) {
    return json(400, {
      message: 'No-show can only be set after the appointment time has begun.',
    });
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (bookingStatus !== undefined) payload.booking_status = bookingStatus;

  if (preferredDate !== undefined) payload.preferred_date = preferredDate;
  if (preferredTimeWindow !== undefined) payload.preferred_time_window = preferredTimeWindow;

  const nextDate = payload.preferred_date || existing.preferred_date;
  const nextWindow = payload.preferred_time_window || existing.preferred_time_window;
  if (!isValidDate(nextDate) || !TIME_WINDOWS.includes(String(nextWindow || ''))) {
    return json(400, { message: 'Appointment must keep a valid date and time window.' });
  }

  if (staffNote) {
    const line = `[Staff ${torontoStamp()} · ${staffEmail}] ${staffNote}`;
    const previous = String(existing.additional_notes || '').trim();
    payload.additional_notes = previous ? `${previous}\n${line}` : line;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('appointment_bookings')
    .update(payload)
    .eq('id', id)
    .select(APPOINTMENT_SELECT)
    .maybeSingle();

  if (updateError) {
    console.error('[EastCord admin] appointment update failed.', updateError);
    return json(500, { message: 'Appointment could not be updated right now.' });
  }

  return json(200, {
    message: 'Appointment updated.',
    appointment: updated,
    timeWindows: TIME_WINDOWS,
    bookingStatuses: BOOKING_STATUSES,
  });
}

exports.handler = async (event) => {
  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  if (event.httpMethod === 'GET') {
    return listAppointments(auth.supabaseAdmin, event);
  }

  if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
    return updateAppointment(auth.supabaseAdmin, event, auth.email);
  }

  return json(405, { message: 'Method not allowed.' });
};
