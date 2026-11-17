const { bookingLocation, listCalendarSlots } = require('./appointment-calendars');

const PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const STRIPE_MIN_EXPIRY_MS = 30 * 60 * 1000;
const SLOT_TAKEN_MESSAGE = 'This time was just booked by someone else. Call EastCord Tires at 365-822-5553 to choose another time.';
const SLOT_REFUNDED_MESSAGE = 'This time was just booked by someone else. Your payment is being returned. Call EastCord Tires at 365-822-5553 to choose another time.';
const LINK_EXPIRED_MESSAGE = 'This payment link has expired. Call EastCord Tires at 365-822-5553 to book again.';

function paymentDeadlineMs(createdAt, now = Date.now()) {
  const created = Date.parse(createdAt || '');
  const start = Number.isFinite(created) ? created : now;
  return start + PAYMENT_WINDOW_MS;
}

function linkStillOpen(createdAt, now = Date.now()) {
  return now < paymentDeadlineMs(createdAt, now);
}

function stripeExpiresAt(createdAt, now = Date.now()) {
  const deadline = paymentDeadlineMs(createdAt, now);
  if (deadline < now + STRIPE_MIN_EXPIRY_MS) return null;
  return Math.floor(deadline / 1000);
}

async function slotTakenBySomeoneElse(supabase, row) {
  if (!row?.preferred_date || !row?.preferred_time_window) return false;
  const location = bookingLocation(row);
  const listed = await listCalendarSlots(supabase, [row.preferred_date]);
  if (!listed.missing && !listed.error) {
    return listed.slots.some((slot) => (
      String(slot.slot_date) === String(row.preferred_date)
      && String(slot.time_window) === String(row.preferred_time_window)
      && slot.calendar === location
      && slot.appointment_id !== row.id
    ));
  }

  const { data, error } = await supabase
    .from('appointment_bookings')
    .select('id, install_location, city, payment_status, booking_status')
    .eq('preferred_date', row.preferred_date)
    .eq('preferred_time_window', row.preferred_time_window)
    .in('payment_status', ['paid_deposit', 'paid_in_full'])
    .eq('booking_status', 'Confirmed')
    .neq('id', row.id);
  if (error) {
    console.error('[EastCord appointment automation] Slot check failed.', error.message || error);
    return false;
  }
  return (data || []).some((other) => bookingLocation(other) === location);
}

async function expireCheckoutSession(stripe, sessionId) {
  if (!stripe || !sessionId) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'open') await stripe.checkout.sessions.expire(sessionId);
  } catch (error) {
    console.warn('[EastCord appointment automation] Checkout session could not be expired.', error.message || error);
  }
}

async function refundTakenSlotPayment(stripe, session) {
  const paymentIntent = session?.payment_intent;
  if (!stripe || !paymentIntent) return;
  try {
    await stripe.refunds.create({ payment_intent: paymentIntent });
  } catch (error) {
    console.error('[EastCord appointment automation] Taken-slot refund failed.', error.message || error);
  }
}

async function expireOtherOpenPayments(supabase, stripe, row) {
  if (!supabase || !stripe || !row?.preferred_date || !row?.preferred_time_window) return;
  const location = bookingLocation(row);
  const { data, error } = await supabase
    .from('appointment_bookings')
    .select('id, stripe_session_id, install_location, city, payment_status, booking_status')
    .eq('preferred_date', row.preferred_date)
    .eq('preferred_time_window', row.preferred_time_window)
    .neq('id', row.id);
  if (error) {
    console.error('[EastCord appointment automation] Competing payment links could not be loaded.', error.message || error);
    return;
  }
  for (const other of data || []) {
    if (bookingLocation(other) !== location) continue;
    const paid = other.payment_status === 'paid_deposit' || other.payment_status === 'paid_in_full';
    if (paid && other.booking_status === 'Confirmed') continue;
    await expireCheckoutSession(stripe, other.stripe_session_id);
  }
}

module.exports = {
  PAYMENT_WINDOW_MS,
  SLOT_TAKEN_MESSAGE,
  SLOT_REFUNDED_MESSAGE,
  LINK_EXPIRED_MESSAGE,
  paymentDeadlineMs,
  linkStillOpen,
  stripeExpiresAt,
  slotTakenBySomeoneElse,
  expireCheckoutSession,
  refundTakenSlotPayment,
  expireOtherOpenPayments,
};
