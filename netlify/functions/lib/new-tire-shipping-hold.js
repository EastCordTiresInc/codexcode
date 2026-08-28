const NEW_TIRE_SHIPPING_DAYS = 4;
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

function earliestInstallYmd(purchaseIso, days = NEW_TIRE_SHIPPING_DAYS) {
  // Next `days` calendar days after purchase are blocked.
  // Purchase Aug 28 → hold 29, 30, 31, Sep 1 → first bookable Sep 2.
  const purchased = purchaseIso ? torontoYmd(purchaseIso) : torontoYmd(new Date());
  if (!purchased) return addDaysYmd(torontoYmd(new Date()), days + 1);
  return addDaysYmd(purchased, days + 1);
}

function isPreferredDateInShippingHold(preferredDate, purchaseIso, days = NEW_TIRE_SHIPPING_DAYS) {
  const selected = String(preferredDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected)) return false;
  return selected < earliestInstallYmd(purchaseIso, days);
}

module.exports = {
  NEW_TIRE_SHIPPING_DAYS,
  SHOP_TIME_ZONE,
  torontoYmd,
  addDaysYmd,
  earliestInstallYmd,
  isPreferredDateInShippingHold,
};
