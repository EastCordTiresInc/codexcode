const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const CONTACT_EMAIL = 'info@eastcordtires.ca';
const CONTACT_PHONE = '365-822-5553';
const SITE_URL = 'eastcordtires.ca';

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

function getRawBody(event) {
  if (event.isBase64Encoded) {
    return Buffer.from(event.body || '', 'base64').toString('utf8');
  }
  return event.body || '';
}

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getSessionBookingIds(session) {
  const ids = [];
  const rawIds = session.metadata?.supabase_booking_ids;

  if (rawIds) {
    try {
      const parsed = JSON.parse(rawIds);
      if (Array.isArray(parsed)) ids.push(...parsed.filter(Boolean));
    } catch (error) {
      console.error('[EastCord appointment automation] Could not parse metadata.supabase_booking_ids.', {
        sessionId: session.id,
        rawIds,
        message: error.message,
      });
    }
  }

  if (session.metadata?.supabase_booking_id) ids.push(session.metadata.supabase_booking_id);
  return Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
}

function supabaseErrorPayload(error) {
  return {
    code: error?.code || '',
    message: error?.message || '',
    details: error?.details || '',
    hint: error?.hint || '',
  };
}

function buildDiagnostics({ bookingId, sessionId, row, rowFound, error, updatePayload }) {
  return {
    bookingId,
    sessionId,
    rowFound: Boolean(rowFound),
    currentPaymentStatus: row?.payment_status ?? null,
    currentBookingStatus: row?.booking_status ?? null,
    currentStripeSessionId: row?.stripe_session_id ?? null,
    availableColumns: row ? Object.keys(row) : [],
    updatePayload,
    supabaseError: supabaseErrorPayload(error),
  };
}

function buildUpdatePayload(row, session) {
  const columns = new Set(Object.keys(row || {}));
  const payload = {};

  if (columns.has('payment_status')) payload.payment_status = 'paid_deposit';
  if (columns.has('stripe_session_id')) payload.stripe_session_id = session.id;
  if (columns.has('updated_at')) payload.updated_at = new Date().toISOString();
  if (columns.has('booking_status')) payload.booking_status = 'Confirmed';

  return payload;
}

function wasAlreadyConfirmed(row) {
  return row?.payment_status === 'paid_deposit' && row?.booking_status === 'Confirmed';
}

async function updateBookingPaymentStatus({ supabaseAdmin, bookingId, session }) {
  const { data: existingRow, error: readError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();

  if (readError) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: null,
      rowFound: false,
      error: readError,
      updatePayload: null,
    });
    console.error('[EastCord appointment automation] Supabase booking row read failed before webhook update.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  if (!existingRow) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: null,
      rowFound: false,
      error: null,
      updatePayload: null,
    });
    console.error('[EastCord appointment automation] Supabase booking row was not found before webhook update.', diagnostics);
    return { ok: false, statusCode: 404, diagnostics };
  }

  console.log('[EastCord appointment automation] Supabase booking row found before webhook update.', {
    bookingId,
    sessionId: session.id,
    currentPaymentStatus: existingRow.payment_status ?? null,
    currentBookingStatus: existingRow.booking_status ?? null,
    currentStripeSessionId: existingRow.stripe_session_id ?? null,
    alreadyConfirmed: wasAlreadyConfirmed(existingRow),
    availableColumns: Object.keys(existingRow),
  });

  const updatePayload = buildUpdatePayload(existingRow, session);

  if (!Object.keys(updatePayload).length) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: existingRow,
      rowFound: true,
      error: null,
      updatePayload,
    });
    console.error('[EastCord appointment automation] No supported payment columns exist on appointment_bookings.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from('appointment_bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .select('*')
    .maybeSingle();

  if (updateError) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: existingRow,
      rowFound: true,
      error: updateError,
      updatePayload,
    });
    console.error('[EastCord appointment automation] Supabase payment status update failed.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  if (!updatedRow) {
    const diagnostics = buildDiagnostics({
      bookingId,
      sessionId: session.id,
      row: existingRow,
      rowFound: true,
      error: null,
      updatePayload,
    });
    console.error('[EastCord appointment automation] Supabase payment status update returned no row.', diagnostics);
    return { ok: false, statusCode: 404, diagnostics };
  }

  console.log('[EastCord appointment automation] Supabase payment status update success.', {
    bookingId: updatedRow.id,
    paymentStatus: updatedRow.payment_status ?? null,
    bookingStatus: updatedRow.booking_status ?? null,
    stripeSessionId: updatedRow.stripe_session_id ?? null,
    updatedColumns: Object.keys(updatePayload),
  });

  return {
    ok: true,
    bookingId: updatedRow.id,
    paymentStatus: updatedRow.payment_status ?? null,
    bookingStatus: updatedRow.booking_status ?? null,
    updatedColumns: Object.keys(updatePayload),
    row: updatedRow,
    wasAlreadyConfirmed: wasAlreadyConfirmed(existingRow),
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
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

function valueOrFallback(value, fallback = 'Not provided') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function getVehicle(row) {
  return [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details provided';
}

function getLocation(row) {
  return [row.full_service_address, row.city, row.postal_code].filter(Boolean).join(', ') || 'Service location provided';
}

function getCustomerName(rows, session) {
  return valueOrFallback(rows.find((row) => row.customer_name)?.customer_name || session.metadata?.customer_name, 'Customer');
}

function getCustomerEmail(rows, session) {
  return valueOrFallback(rows.find((row) => row.customer_email)?.customer_email || session.customer_details?.email || session.customer_email || session.metadata?.customer_email, '');
}

function getCustomerPhone(rows, session) {
  return valueOrFallback(rows.find((row) => row.customer_phone)?.customer_phone || session.metadata?.customer_phone, 'Not provided');
}

function buildAppointmentText(row, index) {
  return [
    `Appointment ${index + 1}:`,
    `Service: ${valueOrFallback(row.service_name)}`,
    `Vehicle: ${getVehicle(row)}`,
    `Tire Size: ${valueOrFallback(row.tire_size, 'Not provided')}`,
    `Date: ${valueOrFallback(row.preferred_date)}`,
    `Time: ${valueOrFallback(row.preferred_time_window)}`,
    `Service Location: ${getLocation(row)}`,
    `Deposit Paid: ${formatMoney(row.deposit_amount)}`,
    `Remaining Balance Due at Service: ${formatMoney(row.remaining_balance)}`,
  ].join('\n');
}

function buildAppointmentHtml(row, index) {
  return `
    <h3>Appointment ${index + 1}</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
      <tr><td style="padding:6px 0;font-weight:700;">Service:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.service_name))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Vehicle:</td><td style="padding:6px 0;">${escapeHtml(getVehicle(row))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Tire Size:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.tire_size, 'Not provided'))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Date:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.preferred_date))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Time:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.preferred_time_window))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Service Location:</td><td style="padding:6px 0;">${escapeHtml(getLocation(row))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Deposit Paid:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(row.deposit_amount))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Remaining Balance:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(row.remaining_balance))}</td></tr>
    </table>
  `;
}

function buildCustomerEmail({ rows, session }) {
  const customerName = getCustomerName(rows, session);
  const appointmentText = rows.map(buildAppointmentText).join('\n\n');
  const appointmentHtml = rows.map(buildAppointmentHtml).join('');
  const totalDeposit = rows.reduce((sum, row) => sum + Number(row.deposit_amount || 0), 0);
  const totalRemaining = rows.reduce((sum, row) => sum + Number(row.remaining_balance || 0), 0);

  const text = `Hello ${customerName},

Your EastCord Tires appointment is confirmed.

We have received your deposit and your appointment has been booked successfully.

Appointment Details:
${appointmentText}

Payment Details:
Total Deposit Paid: ${formatMoney(totalDeposit)}
Total Remaining Balance Due at Service: ${formatMoney(totalRemaining)}
Booking Status: Confirmed
Payment Status: Deposit Paid

Important Safety Reminder:
Wheel nuts/bolts must be re-torqued after approximately 100 km of driving following tire service. This is the customer's responsibility and is an important safety requirement.

Your appointment is subject to EastCord Tires' Mobile Service Agreement. If used tires are purchased, the Used Tire Warranty Policy also applies.

If you need to change or cancel your appointment, please contact EastCord Tires as soon as possible.

EastCord Tires
${CONTACT_EMAIL}
${CONTACT_PHONE}
${SITE_URL}`;

  const html = `
    <div style="font-family:Arial,sans-serif;color:#111317;line-height:1.6;max-width:720px;margin:0 auto;">
      <h2 style="color:#111317;">Your EastCord Tires appointment is confirmed.</h2>
      <p>Hello ${escapeHtml(customerName)},</p>
      <p>We have received your deposit and your appointment has been booked successfully.</p>
      ${appointmentHtml}
      <h3>Payment Details</h3>
      <p><strong>Total Deposit Paid:</strong> ${escapeHtml(formatMoney(totalDeposit))}<br />
      <strong>Total Remaining Balance Due at Service:</strong> ${escapeHtml(formatMoney(totalRemaining))}<br />
      <strong>Booking Status:</strong> Confirmed<br />
      <strong>Payment Status:</strong> Deposit Paid</p>
      <h3>Important Safety Reminder</h3>
      <p>Wheel nuts/bolts must be re-torqued after approximately 100 km of driving following tire service. This is the customer's responsibility and is an important safety requirement.</p>
      <p>Your appointment is subject to EastCord Tires' Mobile Service Agreement. If used tires are purchased, the Used Tire Warranty Policy also applies.</p>
      <p>If you need to change or cancel your appointment, please contact EastCord Tires as soon as possible.</p>
      <p><strong>EastCord Tires</strong><br />${CONTACT_EMAIL}<br />${CONTACT_PHONE}<br />${SITE_URL}</p>
    </div>
  `;

  return {
    to: getCustomerEmail(rows, session),
    subject: 'Your EastCord Tires Appointment Is Confirmed',
    text,
    html,
  };
}

function buildInternalEmail({ rows, session }) {
  const customerName = getCustomerName(rows, session);
  const customerEmail = getCustomerEmail(rows, session);
  const customerPhone = getCustomerPhone(rows, session);
  const totalDeposit = rows.reduce((sum, row) => sum + Number(row.deposit_amount || 0), 0);
  const totalRemaining = rows.reduce((sum, row) => sum + Number(row.remaining_balance || 0), 0);

  const appointmentBlocks = rows.map((row, index) => [
    buildAppointmentText(row, index),
    `Booking ID: ${row.id}`,
    `Customer Notes: ${valueOrFallback(row.additional_notes, 'None')}`,
    `Parking/Access Notes: ${valueOrFallback(row.parking_access_notes, 'None')}`,
  ].join('\n')).join('\n\n');

  const text = `New confirmed appointment received.

Customer Details:
Name: ${customerName}
Phone: ${customerPhone}
Email: ${customerEmail}

Appointment Details:
${appointmentBlocks}

Payment Details:
Total Deposit Paid: ${formatMoney(totalDeposit)}
Total Remaining Balance Due at Service: ${formatMoney(totalRemaining)}
Payment Status: Deposit Paid
Booking Status: Confirmed

System Details:
Stripe Session ID: ${session.id}`;

  const appointmentHtml = rows.map((row, index) => `${buildAppointmentHtml(row, index)}
    <p><strong>Booking ID:</strong> ${escapeHtml(row.id)}<br />
    <strong>Customer Notes:</strong> ${escapeHtml(valueOrFallback(row.additional_notes, 'None'))}<br />
    <strong>Parking/Access Notes:</strong> ${escapeHtml(valueOrFallback(row.parking_access_notes, 'None'))}</p>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#111317;line-height:1.6;max-width:760px;margin:0 auto;">
      <h2>New confirmed appointment received.</h2>
      <h3>Customer Details</h3>
      <p><strong>Name:</strong> ${escapeHtml(customerName)}<br />
      <strong>Phone:</strong> ${escapeHtml(customerPhone)}<br />
      <strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
      ${appointmentHtml}
      <h3>Payment Details</h3>
      <p><strong>Total Deposit Paid:</strong> ${escapeHtml(formatMoney(totalDeposit))}<br />
      <strong>Total Remaining Balance Due at Service:</strong> ${escapeHtml(formatMoney(totalRemaining))}<br />
      <strong>Payment Status:</strong> Deposit Paid<br />
      <strong>Booking Status:</strong> Confirmed</p>
      <h3>System Details</h3>
      <p><strong>Stripe Session ID:</strong> ${escapeHtml(session.id)}</p>
    </div>
  `;

  return {
    to: process.env.EMAIL_TO_EASTCORD || CONTACT_EMAIL,
    subject: 'New Confirmed Appointment - EastCord Tires',
    text,
    html,
  };
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

async function sendEmail(email) {
  const config = getEmailConfig();

  if (config.provider.toLowerCase() !== 'resend') {
    console.warn('[EastCord appointment automation] Email provider is not supported by this function.', {
      provider: config.provider,
    });
    return { ok: false, skipped: true, reason: 'unsupported_email_provider' };
  }

  if (!config.apiKey) {
    console.warn('[EastCord appointment automation] RESEND_API_KEY is missing; email was not sent.', {
      to: email.to,
      subject: email.subject,
    });
    return { ok: false, skipped: true, reason: 'missing_resend_api_key' };
  }

  if (!email.to) {
    console.warn('[EastCord appointment automation] Email recipient is missing; email was not sent.', {
      subject: email.subject,
    });
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.from,
      to: email.to,
      reply_to: config.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[EastCord appointment automation] Email send failed.', {
      to: email.to,
      subject: email.subject,
      status: response.status,
      response: body,
    });
    return { ok: false, skipped: false, reason: 'send_failed', status: response.status, response: body };
  }

  console.log('[EastCord appointment automation] Email sent.', {
    to: email.to,
    subject: email.subject,
    resendId: body.id || '',
  });

  return { ok: true, id: body.id || '' };
}

function hasColumn(rows, columnName) {
  return rows.some((row) => Object.prototype.hasOwnProperty.call(row, columnName));
}

function shouldSendCustomerEmail(rows, allRowsAlreadyConfirmed) {
  if (hasColumn(rows, 'customer_confirmation_sent_at')) {
    return rows.some((row) => !row.customer_confirmation_sent_at);
  }
  return !allRowsAlreadyConfirmed;
}

function shouldSendEastcordEmail(rows, allRowsAlreadyConfirmed) {
  if (hasColumn(rows, 'eastcord_notification_sent_at')) {
    return rows.some((row) => !row.eastcord_notification_sent_at);
  }
  return !allRowsAlreadyConfirmed;
}

async function markEmailSent({ supabaseAdmin, rows, columnName }) {
  if (!hasColumn(rows, columnName)) {
    console.warn('[EastCord appointment automation] Email sent marker column is missing. Add the recommended SQL columns to improve duplicate email protection.', {
      columnName,
    });
    return { ok: false, skipped: true, reason: 'missing_sent_marker_column' };
  }

  const bookingIds = rows.map((row) => row.id).filter(Boolean);
  const { error } = await supabaseAdmin
    .from('appointment_bookings')
    .update({ [columnName]: new Date().toISOString() })
    .in('id', bookingIds);

  if (error) {
    console.error('[EastCord appointment automation] Email sent marker update failed.', {
      columnName,
      bookingIds,
      error: supabaseErrorPayload(error),
    });
    return { ok: false, error: supabaseErrorPayload(error) };
  }

  return { ok: true };
}

async function sendAppointmentEmails({ supabaseAdmin, rows, session, allRowsAlreadyConfirmed }) {
  const emailResults = {
    customer: { skipped: true, reason: 'not_needed' },
    eastcord: { skipped: true, reason: 'not_needed' },
  };

  const customerShouldSend = shouldSendCustomerEmail(rows, allRowsAlreadyConfirmed);
  const eastcordShouldSend = shouldSendEastcordEmail(rows, allRowsAlreadyConfirmed);

  if (!customerShouldSend && !eastcordShouldSend) {
    console.log('[EastCord appointment automation] Confirmation emails already sent or webhook retry detected; skipping duplicate emails.', {
      bookingIds: rows.map((row) => row.id),
      allRowsAlreadyConfirmed,
    });
    return emailResults;
  }

  if (customerShouldSend) {
    emailResults.customer = await sendEmail(buildCustomerEmail({ rows, session }));
    if (emailResults.customer.ok) {
      emailResults.customerMarker = await markEmailSent({ supabaseAdmin, rows, columnName: 'customer_confirmation_sent_at' });
    }
  }

  if (eastcordShouldSend) {
    emailResults.eastcord = await sendEmail(buildInternalEmail({ rows, session }));
    if (emailResults.eastcord.ok) {
      emailResults.eastcordMarker = await markEmailSent({ supabaseAdmin, rows, columnName: 'eastcord_notification_sent_at' });
    }
  }

  return emailResults;
}

exports.handler = async (event) => {
  console.log('[EastCord appointment automation] Stripe webhook received.', {
    method: event.httpMethod,
    hasStripeSecret: Boolean(process.env.STRIPE_SECRET_KEY),
    hasWebhookSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasResendApiKey: Boolean(process.env.RESEND_API_KEY),
  });

  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('[EastCord appointment automation] STRIPE_SECRET_KEY is missing for Stripe webhook.');
    return json(500, { message: 'Stripe secret key is missing.' });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[EastCord appointment automation] STRIPE_WEBHOOK_SECRET is missing for Stripe webhook signature verification.');
    return json(500, { message: 'Stripe webhook secret is missing.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    console.error('[EastCord appointment automation] Supabase admin variables are missing for Stripe webhook update.');
    return json(500, { message: 'Supabase admin configuration is missing.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = getRawBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('[EastCord appointment automation] Stripe webhook signature verification failed.', {
      message: error.message,
    });
    return json(400, { message: 'Invalid Stripe webhook signature.' });
  }

  console.log('[EastCord appointment automation] Stripe webhook event type.', {
    eventType: stripeEvent.type,
  });

  if (stripeEvent.type !== 'checkout.session.completed') {
    return json(200, { received: true, ignored: true, eventType: stripeEvent.type });
  }

  const session = stripeEvent.data.object;
  const bookingIds = getSessionBookingIds(session);

  console.log('[EastCord appointment automation] Stripe checkout.session.completed received.', {
    sessionId: session.id,
    bookingIdsFound: bookingIds.length,
    paymentStatus: session.payment_status,
  });

  if (session.payment_status && session.payment_status !== 'paid') {
    console.warn('[EastCord appointment automation] checkout.session.completed was received without paid payment status; no booking update or email sent.', {
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return json(200, { received: true, ignored: true, reason: 'payment_not_paid', paymentStatus: session.payment_status });
  }

  if (!bookingIds.length) {
    console.error('[EastCord appointment automation] Missing Supabase booking id metadata on Stripe session.', {
      sessionId: session.id,
    });
    return json(400, { message: 'Missing Supabase booking id in Stripe metadata.' });
  }

  const results = [];
  for (const bookingId of bookingIds) {
    results.push(await updateBookingPaymentStatus({ supabaseAdmin, bookingId, session }));
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    return json(failed[0].statusCode || 500, {
      message: 'Booking payment status could not be updated.',
      results,
    });
  }

  const confirmedRows = results.map((result) => result.row).filter(Boolean);
  const allRowsAlreadyConfirmed = results.every((result) => result.wasAlreadyConfirmed);
  const emailResults = await sendAppointmentEmails({
    supabaseAdmin,
    rows: confirmedRows,
    session,
    allRowsAlreadyConfirmed,
  }).catch((error) => {
    console.error('[EastCord appointment automation] Appointment email notification step failed after successful booking update.', {
      message: error.message,
      stack: error.stack,
    });
    return { error: error.message || 'email_step_failed' };
  });

  return json(200, {
    received: true,
    eventType: stripeEvent.type,
    bookingIds: results.map((result) => result.bookingId),
    updatedCount: results.length,
    paymentStatus: 'paid_deposit',
    bookingStatus: 'Confirmed',
    emailResults,
  });
};
