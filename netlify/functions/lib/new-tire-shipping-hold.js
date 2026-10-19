const NEW_TIRE_ARRIVAL_START_MINUTES = 13 * 60;
const NEW_TIRE_HOLD_MESSAGE = 'New tire installation starts at 1:00 PM the day after purchase. Please choose 1:00 PM or later that day, or any time from 8:00 AM on a later day.';
const SHOP_TIME_ZONE = 'America/Toronto';

function torontoYmd(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmd(ymd, days) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
}

function getTimeWindowStartMinutes(value) {
  const startText = String(value || '').split('-')[0].trim();
  const match = startText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return (hours * 60) + minutes;
}

function earliestInstallYmd(purchaseIso) {
  // The purchase day is closed. The next calendar day opens at 1:00 PM,
  // no matter what time the order was placed.
  const purchased = purchaseIso ? torontoYmd(purchaseIso) : torontoYmd(new Date());
  if (!purchased) return addDaysYmd(torontoYmd(new Date()), 1);
  return addDaysYmd(purchased, 1);
}

function isPreferredDateInShippingHold(preferredDate, purchaseIso) {
  const selected = String(preferredDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) return false;
  return selected < earliestInstallYmd(purchaseIso);
}

function isNewTireInstallTooEarly(preferredDate, preferredTimeWindow, purchaseIso) {
  if (isPreferredDateInShippingHold(preferredDate, purchaseIso)) return true;
  const selected = String(preferredDate || '').trim();
  if (selected !== earliestInstallYmd(purchaseIso)) return false;
  const start = getTimeWindowStartMinutes(preferredTimeWindow);
  if (start === null) return false;
  return start < NEW_TIRE_ARRIVAL_START_MINUTES;
}

module.exports = {
  NEW_TIRE_ARRIVAL_START_MINUTES,
  NEW_TIRE_HOLD_MESSAGE,
  SHOP_TIME_ZONE,
  torontoYmd,
  addDaysYmd,
  getTimeWindowStartMinutes,
  earliestInstallYmd,
  isPreferredDateInShippingHold,
  isNewTireInstallTooEarly,
};
