const SHOP_SLOTS = 'shop_calendar_slots';
const MOBILE_SLOTS = 'mobile_calendar_slots';

function bookingLocation(row) {
  const explicit = String(row?.installLocation || row?.install_location || '').trim().toLowerCase();
  if (explicit === 'shop') return 'shop';
  if (explicit === 'mobile') return 'mobile';
  if (String(row?.city || '').trim().toLowerCase() === 'eastcord shop') return 'shop';
  return 'mobile';
}

function slotKey(date, timeWindow, location) {
  return `${date || ''}__${timeWindow || ''}__${location === 'shop' ? 'shop' : 'mobile'}`;
}

function slotConflictMessage(location) {
  return location === 'shop'
    ? 'That hour already has a shop appointment. The mobile calendar can still use this time.'
    : 'That hour already has a mobile service appointment. The shop calendar can still use this time.';
}

function isSlotConflict(error) {
  const message = String(error?.message || error?.details || '');
  return error?.code === '23505' || /already booked on the/i.test(message);
}

function isMissingCalendarTable(error) {
  if (!error) return false;
  const message = String(error.message || error.details || error.hint || '');
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /shop_calendar_slots|mobile_calendar_slots/i.test(message);
}

async function listCalendarSlots(supabase, dates) {
  const uniqueDates = [...new Set((dates || []).map((date) => String(date || '').trim()).filter(Boolean))];
  if (!uniqueDates.length) return { missing: false, slots: [] };

  const [shop, mobile] = await Promise.all([
    supabase.from(SHOP_SLOTS).select('appointment_id, slot_date, time_window').in('slot_date', uniqueDates),
    supabase.from(MOBILE_SLOTS).select('appointment_id, slot_date, time_window').in('slot_date', uniqueDates),
  ]);

  if (isMissingCalendarTable(shop.error) || isMissingCalendarTable(mobile.error)) {
    return { missing: true, slots: [] };
  }
  if (shop.error || mobile.error) {
    return { missing: false, error: shop.error || mobile.error, slots: [] };
  }

  const slots = [
    ...(shop.data || []).map((row) => ({ ...row, calendar: 'shop' })),
    ...(mobile.data || []).map((row) => ({ ...row, calendar: 'mobile' })),
  ];
  return { missing: false, slots };
}

module.exports = {
  bookingLocation,
  slotKey,
  slotConflictMessage,
  isSlotConflict,
  isMissingCalendarTable,
  listCalendarSlots,
};
