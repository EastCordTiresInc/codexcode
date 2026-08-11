const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const CONTACT_EMAIL = 'info@eastcordtires.ca';
const CONTACT_PHONE = '365-822-5553';
const SITE_URL = 'eastcordtires.ca';
const MIN_CANCEL_ADVANCE_MINUTES = 120;

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

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function supabaseErrorPayload(error) {
  return {
    code: error?.code || '',
    message: error?.message || '',
    details: error?.details || '',
    hint: error?.hint || '',
  };
}

function valueOrFallback(value, fallback = 'Not provided') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getVehicle(row) {
  return [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details provided';
}

function getLocation(row) {
  return [row.full_service_address, row.city, row.postal_code].filter(Boolean).join(', ') || 'Service location provided';
}

function getStartMinutes(timeWindow) {
  const startText = String(timeWindow || '').split('-')[0].trim();
  const match = startText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();

  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return (hours * 60) + minutes;
}

function getTorontoNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());

  return parts.reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
}

function getLocalComparableMs(dateValue, minutesSinceMidnight) {
  const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return Date.UTC(year, month - 1, day, 0, minutesSinceMidnight, 0, 0);
}

function getMinutesUntilAppointment(row) {
  const startMinutes = getStartMinutes(row.preferred_time_window);
  const appointmentMs = getLocalComparableMs(row.preferred_date, startMinutes);
  if (appointmentMs === null || startMinutes === null) return null;

  const now = getTorontoNowParts();
  const nowMinutes = (Number(now.hour || 0) * 60) + Number(now.minute || 0);
  const nowMs = Date.UTC(now.year, now.month - 1, now.day, 0, nowMinutes, 0, 0);
  return (appointmentMs - nowMs) / 60000;
}

function canCancelOnline(row) {
  return row.booking_status === 'Confirmed'
    && row.payment_status === 'paid_deposit'
    && Number(getMinutesUntilAppointment(row)) > MIN_CANCEL_ADVANCE_MINUTES;
}

function getEmailConfig() {
  return {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || `EastCord Tires <${CONTACT_EMAIL}>`,
    replyTo: process.env.EMAIL_REPLY_TO || CONTACT_EMAIL,
    eastcordTo: process.env.EMAIL_TO_EASTCORD || CONTACT_EMAIL,
  };
}

function postJsonWithHttps({ hostname, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify(body);
    const request = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        let parsed = {};
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch (error) {
          parsed = { raw: responseBody, parseError: error.message };
        }
        resolve({ statusCode: response.statusCode || 0, body: parsed });
      });
    });

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}

async function sendEmail(email) {
  const config = getEmailConfig();
  const provider = String(config.provider || '').toLowerCase();

  console.log('[EastCord appointment automation] Cancellation email send requested.', {
    provider,
    hasResendApiKey: Boolean(config.apiKey),
    emailFrom: config.from,
    emailToEastcord: config.eastcordTo,
    to: email.to || '',
    subject: email.subject,
  });

  if (provider !== 'resend') return { ok: false, skipped: true, reason: 'unsupported_email_provider' };
  if (!config.apiKey) return { ok: false, skipped: true, reason: 'missing_resend_api_key' };
  if (!email.to) return { ok: false, skipped: true, reason: 'missing_recipient' };

  const response = await postJsonWithHttps({
    hostname: 'api.resend.com',
    path: '/emails',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: {
      from: config.from,
      to: email.to,
      reply_to: config.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    console.error('[EastCord appointment automation] Cancellation email send failed.', {
      to: email.to,
      subject: email.subject,
      status: response.statusCode,
      response: response.body,
    });
    return { ok: false, reason: 'send_failed', status: response.statusCode, response: response.body };
  }

  return { ok: true, id: response.body?.id || '' };
}

function buildCustomerCancellationEmail(row, cancellationTimestamp) {
  return {
    to: row.customer_email || '',
    subject: 'Your EastCord Tires Appointment Has Been Cancelled',
    text: `Hello ${valueOrFallback(row.customer_name, 'Customer')},\n\nYour EastCord Tires appointment has been cancelled.\n\nAppointment Details:\nService: ${valueOrFallback(row.service_name)}\nVehicle: ${getVehicle(row)}\nPlate Number: ${valueOrFallback(row.vehicle_plate_number, 'Not provided')}\nVehicle Colour: ${valueOrFallback(row.vehicle_colour, 'Not provided')}\nDate: ${valueOrFallback(row.preferred_date)}\nTime: ${valueOrFallback(row.preferred_time_window)}\nService Location: ${getLocation(row)}\nDeposit Paid: ${formatMoney(row.deposit_amount)}\nCancellation Timestamp: ${cancellationTimestamp}\n\nDeposit refund decisions are subject to EastCord Tires' Mobile Service Agreement.\n\nEastCord Tires\n${CONTACT_EMAIL}\n${CONTACT_PHONE}\n${SITE_URL}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111317;line-height:1.6;max-width:720px;margin:0 auto;">
        <h2>Your EastCord Tires appointment has been cancelled.</h2>
        <p>Hello ${escapeHtml(valueOrFallback(row.customer_name, 'Customer'))},</p>
        <p>Your EastCord Tires appointment has been cancelled.</p>
        <p><strong>Service:</strong> ${escapeHtml(valueOrFallback(row.service_name))}<br />
        <strong>Vehicle:</strong> ${escapeHtml(getVehicle(row))}<br />
        <strong>Plate Number:</strong> ${escapeHtml(valueOrFallback(row.vehicle_plate_number, 'Not provided'))}<br />
        <strong>Vehicle Colour:</strong> ${escapeHtml(valueOrFallback(row.vehicle_colour, 'Not provided'))}<br />
        <strong>Date:</strong> ${escapeHtml(valueOrFallback(row.preferred_date))}<br />
        <strong>Time:</strong> ${escapeHtml(valueOrFallback(row.preferred_time_window))}<br />
        <strong>Service Location:</strong> ${escapeHtml(getLocation(row))}<br />
        <strong>Deposit Paid:</strong> ${escapeHtml(formatMoney(row.deposit_amount))}<br />
        <strong>Cancellation Timestamp:</strong> ${escapeHtml(cancellationTimestamp)}</p>
        <p>Deposit refund decisions are subject to EastCord Tires' Mobile Service Agreement.</p>
        <p><strong>EastCord Tires</strong><br />${CONTACT_EMAIL}<br />${CONTACT_PHONE}<br />${SITE_URL}</p>
      </div>
    `,
  };
}

function buildInternalCancellationEmail(row, cancellationTimestamp, reason) {
  return {
    to: process.env.EMAIL_TO_EASTCORD || CONTACT_EMAIL,
    subject: 'Appointment Cancelled - EastCord Tires',
    text: `Appointment cancelled.\n\nCustomer Details:\nName: ${valueOrFallback(row.customer_name)}\nPhone: ${valueOrFallback(row.customer_phone)}\nEmail: ${valueOrFallback(row.customer_email)}\n\nAppointment Details:\nService: ${valueOrFallback(row.service_name)}\nVehicle: ${getVehicle(row)}\nPlate Number: ${valueOrFallback(row.vehicle_plate_number, 'Not provided')}\nVehicle Colour: ${valueOrFallback(row.vehicle_colour, 'Not provided')}\nDate: ${valueOrFallback(row.preferred_date)}\nTime: ${valueOrFallback(row.preferred_time_window)}\nLocation: ${getLocation(row)}\nDeposit Paid: ${formatMoney(row.deposit_amount)}\nStripe Session ID: ${valueOrFallback(row.stripe_session_id)}\nBooking ID: ${row.id}\nCancellation Reason: ${valueOrFallback(reason, 'None provided')}\nCancellation Timestamp: ${cancellationTimestamp}`,
    html: `
      <div style="font-family:Arial,sans-serif;color:#111317;line-height:1.6;max-width:760px;margin:0 auto;">
        <h2>Appointment cancelled.</h2>
        <h3>Customer Details</h3>
        <p><strong>Name:</strong> ${escapeHtml(valueOrFallback(row.customer_name))}<br />
        <strong>Phone:</strong> ${escapeHtml(valueOrFallback(row.customer_phone))}<br />
        <strong>Email:</strong> ${escapeHtml(valueOrFallback(row.customer_email))}</p>
        <h3>Appointment Details</h3>
        <p><strong>Service:</strong> ${escapeHtml(valueOrFallback(row.service_name))}<br />
        <strong>Vehicle:</strong> ${escapeHtml(getVehicle(row))}<br />
        <strong>Plate Number:</strong> ${escapeHtml(valueOrFallback(row.vehicle_plate_number, 'Not provided'))}<br />
        <strong>Vehicle Colour:</strong> ${escapeHtml(valueOrFallback(row.vehicle_colour, 'Not provided'))}<br />
        <strong>Date:</strong> ${escapeHtml(valueOrFallback(row.preferred_date))}<br />
        <strong>Time:</strong> ${escapeHtml(valueOrFallback(row.preferred_time_window))}<br />
        <strong>Location:</strong> ${escapeHtml(getLocation(row))}<br />
        <strong>Deposit Paid:</strong> ${escapeHtml(formatMoney(row.deposit_amount))}</p>
        <h3>System Details</h3>
        <p><strong>Stripe Session ID:</strong> ${escapeHtml(valueOrFallback(row.stripe_session_id))}<br />
        <strong>Booking ID:</strong> ${escapeHtml(row.id)}<br />
        <strong>Cancellation Reason:</strong> ${escapeHtml(valueOrFallback(reason, 'None provided'))}<br />
        <strong>Cancellation Timestamp:</strong> ${escapeHtml(cancellationTimestamp)}</p>
      </div>
    `,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Cancellation setup is missing Supabase configuration.' });

  const token = getBearerToken(event);
  if (!token) return json(401, { message: 'Please log in before cancelling an appointment.' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Cancellation details could not be read.' });
  }

  const bookingId = String(body.bookingId || '').trim();
  const cancellationReason = String(body.cancellationReason || '').trim();
  if (!bookingId) return json(400, { message: 'Booking could not be found.' });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    console.error('[EastCord appointment automation] Cancellation auth check failed.', { error: supabaseErrorPayload(userError) });
    return json(401, { message: 'Please log in again before cancelling this appointment.' });
  }

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error('[EastCord appointment automation] Cancellation booking lookup failed.', { bookingId, error: supabaseErrorPayload(bookingError) });
    return json(500, { message: 'Appointment could not be loaded for cancellation.' });
  }

  if (!booking) return json(404, { message: 'Appointment could not be found.' });
  if (booking.customer_id !== userData.user.id) return json(403, { message: 'This appointment is connected to a different customer account.' });

  if (booking.booking_status === 'Cancelled') {
    return json(200, { ok: true, message: 'Appointment is already cancelled.', bookingStatus: 'Cancelled' });
  }

  if (booking.booking_status !== 'Confirmed' || booking.payment_status !== 'paid_deposit') {
    return json(400, { message: 'Only confirmed paid appointments can be cancelled online from My Account.' });
  }

  if (!canCancelOnline(booking)) {
    return json(400, {
      message: 'Online cancellation is no longer available because this appointment is less than 2 hours away. Please contact EastCord Tires at info@eastcordtires.ca or 365-822-5553.',
    });
  }

  const timestamp = new Date().toISOString();
  const updatePayload = {
    booking_status: 'Cancelled',
    cancelled_at: timestamp,
    cancellation_requested_at: timestamp,
    cancellation_reason: cancellationReason || null,
    cancelled_by: 'customer',
  };

  const { data: cancelledBooking, error: updateError } = await supabaseAdmin
    .from('appointment_bookings')
    .update(updatePayload)
    .eq('id', booking.id)
    .select('*')
    .maybeSingle();

  if (updateError) {
    console.error('[EastCord appointment automation] Cancellation update failed.', {
      bookingId,
      updatePayload,
      error: supabaseErrorPayload(updateError),
    });
    return json(500, {
      message: 'Appointment could not be cancelled right now. Please contact EastCord Tires for help.',
      supabaseErrorCode: updateError.code || '',
      supabaseErrorMessage: updateError.message || '',
    });
  }

  const row = cancelledBooking || { ...booking, ...updatePayload };
  const emailResults = { customer: null, eastcord: null };

  try {
    emailResults.customer = await sendEmail(buildCustomerCancellationEmail(row, timestamp));
    emailResults.eastcord = await sendEmail(buildInternalCancellationEmail(row, timestamp, cancellationReason));
  } catch (error) {
    console.error('[EastCord appointment automation] Cancellation email step failed after booking cancellation.', {
      bookingId,
      message: error.message,
      stack: error.stack,
    });
    emailResults.error = error.message || 'email_step_failed';
  }

  return json(200, {
    ok: true,
    bookingId: row.id,
    bookingStatus: row.booking_status,
    paymentStatus: row.payment_status,
    cancelledAt: row.cancelled_at,
    emailResults,
  });
};
