const { getSupabaseAdmin, isAdminEmail } = require('./lib/admin-auth');
const { sendEmail } = require('./lib/send-email');
const {
  isReminderDue,
  isCustomerEmail,
  buildReminderEmail,
} = require('./lib/appointment-reminder');

const SELECT_FIELDS = [
  'id',
  'customer_name',
  'customer_email',
  'service_name',
  'preferred_date',
  'preferred_time_window',
  'install_location',
  'city',
  'full_service_address',
  'booking_status',
  'reminder_sent_at',
].join(', ');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(payload),
  };
}

function isScheduled(event) {
  return String(event.headers?.['x-nf-event'] || event.headers?.['X-Nf-Event'] || '').toLowerCase() === 'schedule';
}

function missingReminderColumn(error) {
  const message = String(error?.message || error?.details || '');
  return /reminder_sent_at/i.test(message);
}

async function dueAppointments(supabaseAdmin, now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('appointment_bookings')
    .select(SELECT_FIELDS)
    .eq('booking_status', 'Confirmed')
    .is('reminder_sent_at', null);

  if (error) return { error };
  const due = (data || []).filter((row) => isReminderDue(row, now) && isCustomerEmail(row.customer_email) && !isAdminEmail(row.customer_email));
  return { due };
}

async function handler(event) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return json(500, { message: 'Appointment reminders are not configured yet.' });

  const found = await dueAppointments(supabaseAdmin);
  if (found.error) {
    if (missingReminderColumn(found.error)) {
      return json(501, { message: 'The appointment reminder column is not set up yet.', setupRequired: true });
    }
    console.error('[EastCord reminders] Lookup failed.', found.error.message);
    return json(500, { message: 'Appointment reminders could not be checked.' });
  }

  if (!isScheduled(event)) {
    return json(200, { dryRun: true, due: found.due.length, sent: 0 });
  }

  const sent = [];
  for (const appointment of found.due) {
    const result = await sendEmail(buildReminderEmail(appointment));
    if (!result.ok) {
      console.error('[EastCord reminders] Email failed.', appointment.id, result.providerMessage || result.reason);
      continue;
    }
    const marked = await supabaseAdmin
      .from('appointment_bookings')
      .update({ reminder_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', appointment.id)
      .is('reminder_sent_at', null);
    if (marked.error) {
      console.error('[EastCord reminders] Sent flag failed.', appointment.id, marked.error.message);
    }
    sent.push(appointment.id);
  }

  return json(200, { dryRun: false, due: found.due.length, sent: sent.length });
}

module.exports = {
  handler,
  dueAppointments,
};
