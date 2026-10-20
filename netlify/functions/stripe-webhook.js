const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { buildBrandedEmail, detailRowsHtml, sendEmail, getEmailConfig } = require('./lib/send-email');

const CONTACT_EMAIL = 'info@eastcordtires.ca';
const CONTACT_PHONE = '365-822-5553';
const ACCOUNT_URL = 'https://eastcordtires.ca/account.html';
const WARRANTY_URL = 'https://eastcordtires.ca/public/docs/eastcord-used-tire-warranty-policy.pdf';
const CUSTOMER_EMAIL_COLUMN = 'customer_confirmation_sent_at';
const EASTCORD_EMAIL_COLUMN = 'eastcord_notification_sent_at';
const TAX_RATE = 0.13;

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

  if (columns.has('payment_status')) {
    payload.payment_status = row?.payment_status === 'paid_in_full' ? 'paid_in_full' : 'paid_deposit';
  }
  if (columns.has('stripe_session_id')) payload.stripe_session_id = session.id;
  if (columns.has('updated_at')) payload.updated_at = new Date().toISOString();
  if (columns.has('booking_status')) payload.booking_status = 'Confirmed';

  return payload;
}

function wasAlreadyConfirmed(row) {
  const paymentStatus = row?.payment_status;
  const paid = paymentStatus === 'paid_deposit' || paymentStatus === 'paid_in_full';
  return paid && row?.booking_status === 'Confirmed';
}

async function updateBookingPaymentStatus({ supabaseAdmin, bookingId, session }) {
  const { data: existingRow, error: readError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('*')
    .eq('id', bookingId)
    .maybeSingle();

  if (readError) {
    const diagnostics = buildDiagnostics({ bookingId, sessionId: session.id, row: null, rowFound: false, error: readError, updatePayload: null });
    console.error('[EastCord appointment automation] Supabase booking row read failed before webhook update.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  if (!existingRow) {
    const diagnostics = buildDiagnostics({ bookingId, sessionId: session.id, row: null, rowFound: false, error: null, updatePayload: null });
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
    customerEmailSentAt: existingRow[CUSTOMER_EMAIL_COLUMN] ?? null,
    eastcordEmailSentAt: existingRow[EASTCORD_EMAIL_COLUMN] ?? null,
    availableColumns: Object.keys(existingRow),
  });

  const updatePayload = buildUpdatePayload(existingRow, session);

  if (!Object.keys(updatePayload).length) {
    const diagnostics = buildDiagnostics({ bookingId, sessionId: session.id, row: existingRow, rowFound: true, error: null, updatePayload });
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
    const diagnostics = buildDiagnostics({ bookingId, sessionId: session.id, row: existingRow, rowFound: true, error: updateError, updatePayload });
    console.error('[EastCord appointment automation] Supabase payment status update failed.', diagnostics);
    return { ok: false, statusCode: 500, diagnostics };
  }

  if (!updatedRow) {
    const diagnostics = buildDiagnostics({ bookingId, sessionId: session.id, row: existingRow, rowFound: true, error: null, updatePayload });
    console.error('[EastCord appointment automation] Supabase payment status update returned no row.', diagnostics);
    return { ok: false, statusCode: 404, diagnostics };
  }

  console.log('[EastCord appointment automation] Supabase payment status update success.', {
    bookingId: updatedRow.id,
    paymentStatus: updatedRow.payment_status ?? null,
    bookingStatus: updatedRow.booking_status ?? null,
    stripeSessionId: updatedRow.stripe_session_id ?? null,
    customerEmailSentAt: updatedRow[CUSTOMER_EMAIL_COLUMN] ?? null,
    eastcordEmailSentAt: updatedRow[EASTCORD_EMAIL_COLUMN] ?? null,
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

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateTaxBreakdown(subtotal) {
  const serviceSubtotal = roundMoney(subtotal);
  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
  const depositAmount = roundMoney(totalWithHst * 0.20);
  const remainingBalance = roundMoney(totalWithHst - depositAmount);

  return {
    serviceSubtotal,
    hstAmount,
    totalWithHst,
    depositAmount,
    remainingBalance,
  };
}

function getTaxDetails(row) {
  const fallback = calculateTaxBreakdown(row.service_subtotal ?? row.starting_price ?? 0);
  return {
    serviceSubtotal: roundMoney(row.service_subtotal ?? row.starting_price ?? fallback.serviceSubtotal),
    hstAmount: roundMoney(row.hst_amount ?? fallback.hstAmount),
    totalWithHst: roundMoney(row.total_with_hst ?? fallback.totalWithHst),
    depositAmount: roundMoney(row.deposit_amount ?? fallback.depositAmount),
    remainingBalance: roundMoney(row.remaining_balance ?? fallback.remainingBalance),
  };
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

function valueOrFallback(value, fallback = 'Not provided') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function getVehicle(row) {
  return [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ');
}

function getLocation(row) {
  if (String(row.install_location || '').trim() === 'shop' || String(row.city || '').trim() === 'EastCord shop') {
    return 'EastCord Tires shop';
  }
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

function getTotals(rows) {
  return rows.reduce((totals, row) => {
    const tax = getTaxDetails(row);
    totals.serviceSubtotal += tax.serviceSubtotal;
    totals.hstAmount += tax.hstAmount;
    totals.totalWithHst += tax.totalWithHst;
    totals.depositAmount += tax.depositAmount;
    totals.remainingBalance += tax.remainingBalance;
    return totals;
  }, {
    serviceSubtotal: 0,
    hstAmount: 0,
    totalWithHst: 0,
    depositAmount: 0,
    remainingBalance: 0,
  });
}

function buildAppointmentText(row, index) {
  const tax = getTaxDetails(row);
  return [
    `Appointment ${index + 1}:`,
    `Service: ${valueOrFallback(row.service_name)}`,
    getVehicle(row) ? `Vehicle: ${getVehicle(row)}` : '',
    `Plate Number: ${valueOrFallback(row.vehicle_plate_number, 'Not provided')}`,
    String(row.vehicle_colour || '').trim() ? `Vehicle Colour: ${String(row.vehicle_colour).trim()}` : '',
    String(row.tire_size || '').trim() ? `Tire Size: ${String(row.tire_size).trim()}` : '',
    `Date: ${valueOrFallback(row.preferred_date)}`,
    `Time: ${valueOrFallback(row.preferred_time_window)}`,
    `Service Location: ${getLocation(row)}`,
    `Service Subtotal: ${formatMoney(tax.serviceSubtotal)}`,
    `HST 13%: ${formatMoney(tax.hstAmount)}`,
    `Total Including HST: ${formatMoney(tax.totalWithHst)}`,
    `Paid Online: ${formatMoney(tax.depositAmount)}`,
    `Remaining Balance Due at Service: ${formatMoney(tax.remainingBalance)}`,
  ].filter(Boolean).join('\n');
}

function buildAppointmentHtml(row, index) {
  const tax = getTaxDetails(row);
  return `
    <h3>Appointment ${index + 1}</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
      <tr><td style="padding:6px 0;font-weight:700;">Service:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.service_name))}</td></tr>
      ${getVehicle(row) ? `<tr><td style="padding:6px 0;font-weight:700;">Vehicle:</td><td style="padding:6px 0;">${escapeHtml(getVehicle(row))}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-weight:700;">Plate Number:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.vehicle_plate_number, 'Not provided'))}</td></tr>
      ${String(row.vehicle_colour || '').trim() ? `<tr><td style="padding:6px 0;font-weight:700;">Vehicle Colour:</td><td style="padding:6px 0;">${escapeHtml(String(row.vehicle_colour).trim())}</td></tr>` : ''}
      ${String(row.tire_size || '').trim() ? `<tr><td style="padding:6px 0;font-weight:700;">Tire Size:</td><td style="padding:6px 0;">${escapeHtml(String(row.tire_size).trim())}</td></tr>` : ''}
      <tr><td style="padding:6px 0;font-weight:700;">Date:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.preferred_date))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Time:</td><td style="padding:6px 0;">${escapeHtml(valueOrFallback(row.preferred_time_window))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Service Location:</td><td style="padding:6px 0;">${escapeHtml(getLocation(row))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Service Subtotal:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(tax.serviceSubtotal))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">HST 13%:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(tax.hstAmount))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Total Including HST:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(tax.totalWithHst))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Paid Online:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(tax.depositAmount))}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;">Remaining Balance:</td><td style="padding:6px 0;">${escapeHtml(formatMoney(tax.remainingBalance))}</td></tr>
    </table>
  `;
}

function buildCustomerEmail({ rows, session }) {
  const customerName = getCustomerName(rows, session);
  const appointmentText = rows.map(buildAppointmentText).join('\n\n');
  const appointmentHtml = rows.map(buildAppointmentHtml).join('');
  const totals = getTotals(rows);

  return buildBrandedEmail({
    to: getCustomerEmail(rows, session),
    subject: 'Your EastCord Tires appointment is confirmed',
    heading: 'Your appointment is confirmed',
    body: [
      `Hello ${customerName},`,
      'We received your deposit and booked your EastCord Tires appointment.',
    ],
    actionUrl: ACCOUNT_URL,
    actionLabel: 'View your account',
    extraText: [
      'Appointment Details:',
      appointmentText,
      '',
      'Payment Details:',
      `Total Service Subtotal: ${formatMoney(totals.serviceSubtotal)}`,
      `Total HST 13%: ${formatMoney(totals.hstAmount)}`,
      `Total Including HST: ${formatMoney(totals.totalWithHst)}`,
      `Total Deposit Paid: ${formatMoney(totals.depositAmount)}`,
      `Total Remaining Balance Due at Service: ${formatMoney(totals.remainingBalance)}`,
      'Booking Status: Confirmed',
      'Payment Status: Deposit Paid',
      '',
      'Wheel nuts/bolts must be re-torqued after approximately 100 km of driving following tire service.',
      `Used Tire Warranty: ${WARRANTY_URL}`,
    ].join('\n'),
    extraHtml: `
      ${appointmentHtml}
      <h3 style="font-size:16px;margin:20px 0 8px;">Payment Details</h3>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        <strong>Total Service Subtotal:</strong> ${escapeHtml(formatMoney(totals.serviceSubtotal))}<br />
        <strong>Total HST 13%:</strong> ${escapeHtml(formatMoney(totals.hstAmount))}<br />
        <strong>Total Including HST:</strong> ${escapeHtml(formatMoney(totals.totalWithHst))}<br />
        <strong>Total Deposit Paid:</strong> ${escapeHtml(formatMoney(totals.depositAmount))}<br />
        <strong>Total Remaining Balance Due at Service:</strong> ${escapeHtml(formatMoney(totals.remainingBalance))}<br />
        <strong>Booking Status:</strong> Confirmed<br />
        <strong>Payment Status:</strong> Deposit Paid
      </p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4b5563;">Wheel nuts/bolts must be re-torqued after approximately 100 km of driving following tire service. This is the customer's responsibility.</p>
      <p style="margin:0 0 16px;font-size:14px;">Your appointment is subject to EastCord Tires' Mobile Service Agreement. If used tires are purchased, the <a href="${WARRANTY_URL}" style="color:#ba151b;font-weight:700;">Used Tire Warranty Policy</a> also applies.</p>
    `,
  });
}

function buildInternalEmail({ rows, session }) {
  const customerName = getCustomerName(rows, session);
  const customerEmail = getCustomerEmail(rows, session);
  const customerPhone = getCustomerPhone(rows, session);
  const totals = getTotals(rows);
  const appointmentBlocks = rows.map((row, index) => [
    buildAppointmentText(row, index),
    `Booking ID: ${row.id}`,
    `Customer Notes: ${valueOrFallback(row.additional_notes, 'None')}`,
    `Parking/Access Notes: ${valueOrFallback(row.parking_access_notes, 'None')}`,
  ].join('\n')).join('\n\n');
  const appointmentHtml = rows.map((row, index) => `${buildAppointmentHtml(row, index)}
    <p><strong>Booking ID:</strong> ${escapeHtml(row.id)}<br />
    <strong>Customer Notes:</strong> ${escapeHtml(valueOrFallback(row.additional_notes, 'None'))}<br />
    <strong>Parking/Access Notes:</strong> ${escapeHtml(valueOrFallback(row.parking_access_notes, 'None'))}</p>`).join('');

  return buildBrandedEmail({
    to: CONTACT_EMAIL,
    subject: 'New Confirmed Appointment - EastCord Tires',
    heading: 'New confirmed appointment',
    body: [
      `${customerName} paid the deposit. The appointment is confirmed.`,
    ],
    extraText: [
      'Customer Details:',
      `Name: ${customerName}`,
      `Phone: ${customerPhone}`,
      `Email: ${customerEmail}`,
      '',
      'Appointment Details:',
      appointmentBlocks,
      '',
      'Payment Details:',
      `Total Service Subtotal: ${formatMoney(totals.serviceSubtotal)}`,
      `Total HST 13%: ${formatMoney(totals.hstAmount)}`,
      `Total Including HST: ${formatMoney(totals.totalWithHst)}`,
      `Total Deposit Paid: ${formatMoney(totals.depositAmount)}`,
      `Total Remaining Balance Due at Service: ${formatMoney(totals.remainingBalance)}`,
      'Payment Status: Deposit Paid',
      'Booking Status: Confirmed',
      '',
      `Stripe Session ID: ${session.id}`,
    ].join('\n'),
    extraHtml: `
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;"><strong>Name:</strong> ${escapeHtml(customerName)}<br />
      <strong>Phone:</strong> ${escapeHtml(customerPhone)}<br />
      <strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
      ${appointmentHtml}
      <h3 style="font-size:16px;margin:20px 0 8px;">Payment Details</h3>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
        <strong>Total Service Subtotal:</strong> ${escapeHtml(formatMoney(totals.serviceSubtotal))}<br />
        <strong>Total HST 13%:</strong> ${escapeHtml(formatMoney(totals.hstAmount))}<br />
        <strong>Total Including HST:</strong> ${escapeHtml(formatMoney(totals.totalWithHst))}<br />
        <strong>Total Deposit Paid:</strong> ${escapeHtml(formatMoney(totals.depositAmount))}<br />
        <strong>Total Remaining Balance Due at Service:</strong> ${escapeHtml(formatMoney(totals.remainingBalance))}<br />
        <strong>Payment Status:</strong> Deposit Paid<br />
        <strong>Booking Status:</strong> Confirmed
      </p>
      <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7280;"><strong>Stripe Session ID:</strong> ${escapeHtml(session.id)}</p>
    `,
  });
}

function hasColumn(rows, columnName) {
  return rows.some((row) => Object.prototype.hasOwnProperty.call(row, columnName));
}

function shouldSendCustomerEmail(rows, allRowsAlreadyConfirmed) {
  if (!rows.length) return { shouldSend: false, reason: 'no_booking_rows' };
  if (hasColumn(rows, CUSTOMER_EMAIL_COLUMN)) {
    const unsent = rows.filter((row) => !row[CUSTOMER_EMAIL_COLUMN]);
    return unsent.length
      ? { shouldSend: true, reason: 'sent_at_missing', count: 1, bookingIds: unsent.map((row) => row.id) }
      : { shouldSend: false, reason: 'sent_at_already_exists' };
  }
  void allRowsAlreadyConfirmed;
  return { shouldSend: true, reason: 'sent_at_columns_missing', count: 1, bookingIds: rows.map((row) => row.id) };
}

function shouldSendEastcordEmail(rows, allRowsAlreadyConfirmed) {
  if (!rows.length) return { shouldSend: false, reason: 'no_booking_rows' };
  if (hasColumn(rows, EASTCORD_EMAIL_COLUMN)) {
    const unsent = rows.filter((row) => !row[EASTCORD_EMAIL_COLUMN]);
    return unsent.length
      ? { shouldSend: true, reason: 'sent_at_missing', count: 1, bookingIds: unsent.map((row) => row.id) }
      : { shouldSend: false, reason: 'sent_at_already_exists' };
  }
  void allRowsAlreadyConfirmed;
  return { shouldSend: true, reason: 'sent_at_columns_missing', count: 1, bookingIds: rows.map((row) => row.id) };
}

async function markEmailSent({ supabaseAdmin, rows, columnName }) {
  if (!hasColumn(rows, columnName)) {
    console.warn('[EastCord appointment automation] Email sent marker column is missing. Add the recommended SQL columns to improve duplicate email protection.', { columnName });
    return { ok: false, skipped: true, reason: 'missing_sent_marker_column' };
  }

  const bookingIds = rows.map((row) => row.id).filter(Boolean);
  const timestamp = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('appointment_bookings')
    .update({ [columnName]: timestamp })
    .in('id', bookingIds);

  if (error) {
    console.error('[EastCord appointment automation] Email sent marker update failed.', {
      columnName,
      bookingIds,
      error: supabaseErrorPayload(error),
    });
    return { ok: false, error: supabaseErrorPayload(error) };
  }

  console.log('[EastCord appointment automation] Email sent marker updated.', {
    columnName,
    bookingIds,
    timestamp,
  });

  return { ok: true, timestamp };
}

async function sendAppointmentEmails({ supabaseAdmin, rows, session, allRowsAlreadyConfirmed }) {
  const config = getEmailConfig();
  const customerEmail = getCustomerEmail(rows, session);
  const customerDecision = shouldSendCustomerEmail(rows, allRowsAlreadyConfirmed);
  const eastcordDecision = shouldSendEastcordEmail(rows, allRowsAlreadyConfirmed);
  const emailResults = {
    customer: { skipped: true, reason: customerDecision.reason },
    eastcord: { skipped: true, reason: eastcordDecision.reason },
  };

  console.log('[EastCord appointment automation] Email notification flow started.', {
    sessionId: session.id,
    provider: config.provider,
    emailConfigured: Boolean(config.configured),
    emailFrom: config.from,
    emailToEastcord: CONTACT_EMAIL,
    bookingIds: rows.map((row) => row.id),
    bookingCount: rows.length,
    allRowsAlreadyConfirmed,
    customerRecipientPresent: Boolean(customerEmail),
    customerSentAtValues: rows.map((row) => row[CUSTOMER_EMAIL_COLUMN] ?? null),
    eastcordSentAtValues: rows.map((row) => row[EASTCORD_EMAIL_COLUMN] ?? null),
    customerEmailsToSend: customerDecision.shouldSend && customerEmail ? 1 : 0,
    eastcordEmailsToSend: eastcordDecision.shouldSend ? 1 : 0,
    customerSkipReason: customerDecision.shouldSend ? '' : customerDecision.reason,
    eastcordSkipReason: eastcordDecision.shouldSend ? '' : eastcordDecision.reason,
  });

  if (customerDecision.shouldSend) {
    if (!customerEmail) {
      console.warn('[EastCord appointment automation] Customer email skipped: no customer email found on booking, Stripe session, or metadata.', {
        sessionId: session.id,
        bookingIds: rows.map((row) => row.id),
      });
      emailResults.customer = { ok: false, skipped: true, reason: 'missing_customer_email' };
    } else {
      emailResults.customer = await sendEmail({
        ...buildCustomerEmail({ rows, session }),
        idempotencyKey: `eastcord-appt-customer-${session.id}`,
      });
      if (emailResults.customer.ok) {
        emailResults.customerMarker = await markEmailSent({ supabaseAdmin, rows, columnName: CUSTOMER_EMAIL_COLUMN });
      }
    }
  } else {
    console.log('[EastCord appointment automation] Customer email skipped.', {
      reason: customerDecision.reason,
      bookingIds: rows.map((row) => row.id),
    });
  }

  if (eastcordDecision.shouldSend) {
    emailResults.eastcord = await sendEmail({
      ...buildInternalEmail({ rows, session }),
      idempotencyKey: `eastcord-appt-staff-${session.id}`,
    });
    if (emailResults.eastcord.ok) {
      emailResults.eastcordMarker = await markEmailSent({ supabaseAdmin, rows, columnName: EASTCORD_EMAIL_COLUMN });
    }
  } else {
    console.log('[EastCord appointment automation] EastCord internal email skipped.', {
      reason: eastcordDecision.reason,
      bookingIds: rows.map((row) => row.id),
    });
  }

  console.log('[EastCord appointment automation] Email notification flow completed.', emailResults);
  return emailResults;
}

exports.buildCustomerEmail = buildCustomerEmail;
exports.buildInternalEmail = buildInternalEmail;
exports.buildBalancePaidEmail = buildBalancePaidEmail;

exports.handler = async (event) => {
  console.log('[EastCord appointment automation] Stripe webhook received.', {
    method: event.httpMethod,
    hasStripeSecret: Boolean(process.env.STRIPE_SECRET_KEY),
    hasWebhookSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    emailProvider: getEmailConfig().provider,
    emailConfigured: Boolean(getEmailConfig().configured),
    emailFrom: process.env.EMAIL_FROM || `EastCord Tires <${CONTACT_EMAIL}>`,
    emailToEastcord: CONTACT_EMAIL,
  });

  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { message: 'Stripe secret key is missing.' });
  if (!process.env.STRIPE_WEBHOOK_SECRET) return json(500, { message: 'Stripe webhook secret is missing.' });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Supabase admin configuration is missing.' });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = getRawBody(event);

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error('[EastCord appointment automation] Stripe webhook signature verification failed.', { message: error.message });
    return json(400, { message: 'Invalid Stripe webhook signature.' });
  }

  console.log('[EastCord appointment automation] Stripe webhook event type.', { eventType: stripeEvent.type });
  if (stripeEvent.type !== 'checkout.session.completed') {
    return json(200, { received: true, ignored: true, eventType: stripeEvent.type });
  }

  const session = stripeEvent.data.object;

  if (session.metadata?.order_type === 'used_tire') {
    if (session.payment_status && session.payment_status !== 'paid') {
      return json(200, { received: true, ignored: true, reason: 'payment_not_paid', paymentStatus: session.payment_status });
    }
    const { fulfillPaidUsedTireOrder } = require('./lib/used-tire-order');
    const result = await fulfillPaidUsedTireOrder({ supabaseAdmin, session });
    if (!result.ok) {
      return json(result.statusCode || 500, {
        message: result.message || 'Used tire order could not be updated after payment.',
      });
    }
    return json(200, { received: true, orderType: 'used_tire', alreadyPaid: Boolean(result.alreadyPaid) });
  }

  if (session.metadata?.order_type === 'appointment_balance') {
    if (session.payment_status && session.payment_status !== 'paid') {
      return json(200, { received: true, ignored: true, reason: 'payment_not_paid', paymentStatus: session.payment_status });
    }
    const result = await fulfillAppointmentBalance({ supabaseAdmin, session });
    if (!result.ok) {
      return json(result.statusCode || 500, {
        message: result.message || 'The remaining balance could not be recorded.',
      });
    }
    return json(200, { received: true, orderType: 'appointment_balance', alreadyPaid: Boolean(result.alreadyPaid) });
  }

  if (session.metadata?.order_type === 'new_tire') {
    if (session.payment_status && session.payment_status !== 'paid') {
      return json(200, { received: true, ignored: true, reason: 'payment_not_paid', paymentStatus: session.payment_status });
    }
    const { fulfillPaidNewTireOrder } = require('./lib/new-tire-order');
    const result = await fulfillPaidNewTireOrder({ supabaseAdmin, session });
    if (!result.ok) {
      return json(result.statusCode || 500, {
        message: result.message || 'New tire order could not be updated after payment.',
      });
    }
    return json(200, { received: true, orderType: 'new_tire', alreadyPaid: Boolean(result.alreadyPaid) });
  }

  const result = await fulfillPaidAppointmentCheckout({ supabaseAdmin, session });
  if (!result.ok) {
    return json(result.statusCode || 500, {
      message: result.message || 'Booking payment status could not be updated.',
      results: result.results,
    });
  }

  return json(200, {
    received: true,
    eventType: stripeEvent.type,
    ...result,
  });
};

async function fulfillPaidAppointmentCheckout({ supabaseAdmin, session }) {
  const bookingIds = getSessionBookingIds(session);

  console.log('[EastCord appointment automation] Stripe checkout.session.completed received.', {
    sessionId: session.id,
    bookingIdsFound: bookingIds.length,
    bookingIds,
    paymentStatus: session.payment_status,
  });

  if (session.payment_status && session.payment_status !== 'paid') {
    console.warn('[EastCord appointment automation] checkout.session.completed was received without paid payment status; no booking update or email sent.', {
      sessionId: session.id,
      paymentStatus: session.payment_status,
    });
    return { ok: true, ignored: true, reason: 'payment_not_paid', paymentStatus: session.payment_status };
  }

  if (!bookingIds.length) {
    console.error('[EastCord appointment automation] Missing Supabase booking id metadata on Stripe session.', { sessionId: session.id });
    return { ok: false, statusCode: 400, message: 'Missing Supabase booking id in Stripe metadata.' };
  }

  const results = [];
  for (const bookingId of bookingIds) {
    results.push(await updateBookingPaymentStatus({ supabaseAdmin, bookingId, session }));
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    return {
      ok: false,
      statusCode: failed[0].statusCode || 500,
      message: 'Booking payment status could not be updated.',
      results,
    };
  }

  const confirmedRows = results.map((result) => result.row).filter(Boolean);
  const allRowsAlreadyConfirmed = results.every((result) => result.wasAlreadyConfirmed);

  console.log('[EastCord appointment automation] Booking update complete; starting email notification step.', {
    sessionId: session.id,
    bookingIds: results.map((result) => result.bookingId),
    confirmedRowCount: confirmedRows.length,
    paymentStatuses: confirmedRows.map((row) => row.payment_status),
    bookingStatuses: confirmedRows.map((row) => row.booking_status),
  });

  const emailResults = await sendAppointmentEmails({ supabaseAdmin, rows: confirmedRows, session, allRowsAlreadyConfirmed })
    .catch((error) => {
      console.error('[EastCord appointment automation] Appointment email notification step failed after successful booking update.', {
        message: error.message,
        stack: error.stack,
      });
      return { error: error.message || 'email_step_failed' };
    });

  return {
    ok: true,
    ignored: false,
    bookingIds: results.map((result) => result.bookingId),
    updatedCount: results.length,
    paymentStatus: 'paid_deposit',
    bookingStatus: 'Confirmed',
    emailResults,
  };
}

exports.fulfillPaidAppointmentCheckout = fulfillPaidAppointmentCheckout;

async function fulfillAppointmentBalance({ supabaseAdmin, session }) {
  if (session.payment_status && session.payment_status !== 'paid') {
    return { ok: true, ignored: true, reason: 'payment_not_paid', paymentStatus: session.payment_status };
  }

  const bookingId = String(session.metadata?.supabase_booking_id || '').trim();
  if (!bookingId) {
    return { ok: false, statusCode: 400, message: 'Missing Supabase booking id in Stripe metadata.' };
  }

  const { data: row, error } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id, customer_name, customer_email, customer_phone, service_name, preferred_date, preferred_time_window, vehicle_plate_number, deposit_amount, remaining_balance, total_with_hst, payment_status, booking_status')
    .eq('id', bookingId)
    .maybeSingle();

  if (error) {
    console.error('[EastCord appointment automation] Balance payment booking lookup failed.', error.message);
    return { ok: false, statusCode: 500, message: 'The appointment could not be loaded.' };
  }
  if (!row) return { ok: false, statusCode: 404, message: 'The appointment was not found.' };

  const remaining = roundMoney(row.remaining_balance);
  if (remaining <= 0 || row.payment_status === 'paid_in_full') {
    return { ok: true, alreadyPaid: true, bookingIds: [bookingId] };
  }

  const charged = roundMoney(Number(session.amount_total || 0) / 100);
  if (Math.abs(charged - remaining) > 0.01) {
    console.error('[EastCord appointment automation] Balance payment amount did not match the booking.', {
      bookingId,
      charged,
      remaining,
    });
    return { ok: false, statusCode: 409, message: 'The payment does not match the remaining balance.' };
  }

  const paidOnline = roundMoney(Number(row.deposit_amount || 0) + remaining);
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('appointment_bookings')
    .update({
      deposit_amount: paidOnline,
      remaining_balance: 0,
      payment_status: 'paid_in_full',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .gt('remaining_balance', 0)
    .select('id')
    .maybeSingle();

  if (updateError) {
    console.error('[EastCord appointment automation] Balance payment update failed.', updateError.message);
    return { ok: false, statusCode: 500, message: 'The remaining balance could not be recorded.' };
  }
  if (!updated) return { ok: true, alreadyPaid: true, bookingIds: [bookingId] };

  const emailResult = await sendEmail({
    ...buildBalancePaidEmail(row, charged),
    replyTo: row.customer_email || CONTACT_EMAIL,
    idempotencyKey: `eastcord-appt-balance-${session.id}`,
  }).catch((error) => {
    console.error('[EastCord appointment automation] Balance payment email failed.', error.message);
    return { ok: false, reason: error.message || 'email_failed' };
  });
  if (!emailResult.ok) {
    console.error('[EastCord appointment automation] Balance payment email was not sent.', emailResult.reason || emailResult.providerMessage || '');
  }

  return { ok: true, bookingIds: [bookingId], paymentStatus: 'paid_in_full', emailResult };
}

function buildBalancePaidEmail(row, amountPaid) {
  const name = String(row.customer_name || 'Customer').trim() || 'Customer';
  return buildBrandedEmail({
    to: CONTACT_EMAIL,
    subject: `Remaining balance paid — ${name}`,
    heading: 'Remaining balance paid',
    body: [
      `${name} paid the remaining balance online. Nothing is left to collect.`,
    ],
    extraHtml: detailRowsHtml([
      { label: 'Name', value: name },
      { label: 'Email', value: row.customer_email || '' },
      { label: 'Phone', value: row.customer_phone || '' },
      { label: 'Service', value: row.service_name || '' },
      { label: 'Plate', value: row.vehicle_plate_number || '' },
      { label: 'Date', value: row.preferred_date || '' },
      { label: 'Time', value: row.preferred_time_window || '' },
      { label: 'Amount paid', value: formatMoney(amountPaid) },
      { label: 'Appointment total', value: formatMoney(row.total_with_hst) },
      { label: 'Booking', value: row.id },
    ]),
  });
}

exports.fulfillAppointmentBalance = fulfillAppointmentBalance;
