const { buildBrandedEmail, ACCOUNT_URL } = require('./send-email');

const BLOCKED_SHOP_INBOX = 'info@eastcordtires.ca';
const REMINDER_LEAD_MINUTES = 60;
const REMINDER_WINDOW_MINUTES = 15;

function startMinutes(timeWindow) {
  const match = String(timeWindow || '').match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();
  if (hour > 12 || minute > 59) return null;
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function torontoParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute),
  };
}

function isReminderDue(appointment, now = new Date()) {
  if (String(appointment?.booking_status || '') !== 'Confirmed') return false;
  if (appointment?.reminder_sent_at) return false;
  const current = torontoParts(now);
  if (String(appointment.preferred_date || '') !== current.date) return false;
  const start = startMinutes(appointment.preferred_time_window);
  if (start == null) return false;
  const minutesUntil = start - current.minutes;
  const earliest = REMINDER_LEAD_MINUTES - REMINDER_WINDOW_MINUTES;
  const latest = REMINDER_LEAD_MINUTES + REMINDER_WINDOW_MINUTES;
  return minutesUntil >= earliest && minutesUntil <= latest;
}

function isCustomerEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email !== BLOCKED_SHOP_INBOX;
}

function locationLine(appointment) {
  const location = String(appointment?.install_location || '').trim().toLowerCase();
  const city = String(appointment?.city || '').trim();
  const shop = location === 'shop' || city.toLowerCase() === 'eastcord shop';
  if (shop) return 'EastCord shop, 600 Harrop Drive, Milton';
  const address = [appointment?.full_service_address, city].filter(Boolean).join(', ');
  return address || 'Your mobile service address';
}

function appointmentDateLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 16));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function buildReminderEmail(appointment, options = {}) {
  const name = String(appointment.customer_name || '').trim() || 'Hello';
  const sample = options.sample
    ? 'This is a sample of the reminder customers receive about 1 hour before a booked appointment.'
    : '';
  return buildBrandedEmail({
    to: String(appointment.customer_email || '').trim(),
    subject: 'Your EastCord appointment is in 1 hour',
    heading: 'Your appointment is coming up',
    body: [
      sample,
      `${name}, your EastCord Tires appointment starts in about 1 hour.`,
      appointment.service_name || 'Tire service',
      appointmentDateLabel(appointment.preferred_date),
      appointment.preferred_time_window || '',
      locationLine(appointment),
      'Please have the vehicle ready at the start of this hour.',
    ].filter(Boolean),
    actionUrl: ACCOUNT_URL,
    actionLabel: 'View your appointment',
    footer: 'Reply to this email if you need to change the time.',
  });
}

module.exports = {
  BLOCKED_SHOP_INBOX,
  REMINDER_LEAD_MINUTES,
  startMinutes,
  torontoParts,
  isReminderDue,
  isCustomerEmail,
  locationLine,
  buildReminderEmail,
};
