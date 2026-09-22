#!/usr/bin/env node
/**
 * Local smoke checks for admin pages + helper logic.
 * Does not require staff login for page/auth-gate tests.
 */

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  const text = await response.text();
  return { response, text, contentType: response.headers.get('content-type') || '' };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  return { response, payload };
}

function runUnitTests() {
  const LOW_STOCK_MAX = 2;
  const isLowStock = (item) => {
    const stock = Number(item.current_stock) || 0;
    return stock > 0 && stock <= LOW_STOCK_MAX;
  };

  assert(!isLowStock({ current_stock: 0 }), 'stock 0 should not be low');
  assert(isLowStock({ current_stock: 1 }), 'stock 1 should be low');
  assert(isLowStock({ current_stock: 2 }), 'stock 2 should be low');
  assert(!isLowStock({ current_stock: 3 }), 'stock 3 should not be low');

  const isPaid = (appointment) => (
    String(appointment.payment_status || '').toLowerCase().includes('paid')
    || String(appointment.booking_status || '').toLowerCase() === 'confirmed'
  );

  const dayStats = (appointments, date) => {
    const forDay = appointments.filter((item) => String(item.preferred_date) === date);
    let pending = 0;
    let booked = 0;
    forDay.forEach((appointment) => {
      const status = String(appointment.booking_status || '').toLowerCase();
      if (status === 'cancelled' || status === 'no-show') return;
      if (status === 'confirmed' || status === 'completed' || isPaid(appointment)) {
        booked += 1;
      } else {
        pending += 1;
      }
    });
    return { pending, booked, total: pending + booked };
  };

  const sample = [
    { preferred_date: '2026-09-18', booking_status: 'Pending Confirmation' },
    { preferred_date: '2026-09-18', booking_status: 'Confirmed' },
    { preferred_date: '2026-09-18', booking_status: 'Completed' },
    { preferred_date: '2026-09-18', booking_status: 'Cancelled' },
    { preferred_date: '2026-09-18', booking_status: 'No-Show' },
    { preferred_date: '2026-09-19', booking_status: 'Pending Confirmation' },
  ];
  const stats = dayStats(sample, '2026-09-18');
  assert(stats.pending === 1, `expected 1 pending, got ${stats.pending}`);
  assert(stats.booked === 2, `expected 2 booked, got ${stats.booked}`);
  assert(stats.total === 3, `expected total 3, got ${stats.total}`);
  assert(dayStats(sample, '2026-09-20').total === 0, 'empty day should be 0');

  const mapsHref = (appointment) => {
    if (
      appointment.install_location === 'shop'
      || String(appointment.city || '').toLowerCase() === 'eastcord shop'
    ) {
      return '';
    }
    const query = [
      appointment.full_service_address,
      appointment.city,
      appointment.postal_code,
    ].filter(Boolean).join(', ');
    if (!query) return '';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  };

  assert(mapsHref({ install_location: 'shop', full_service_address: '123 Main' }) === '', 'shop has no maps link');
  assert(
    mapsHref({ city: 'Halifax', full_service_address: '10 Water St' }).includes('Water'),
    'mobile address should map',
  );

  const windowStartMinutes = (windowLabel) => {
    const start = String(windowLabel || '').split(' - ')[0]?.trim() || '';
    const match = start.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridian = match[3].toUpperCase();
    if (meridian === 'PM' && hour < 12) hour += 12;
    if (meridian === 'AM' && hour === 12) hour = 0;
    return (hour * 60) + minute;
  };

  assert(windowStartMinutes('8:00 AM - 9:00 AM') === 480, '8am should be 480 minutes');
  assert(windowStartMinutes('12:00 PM - 1:00 PM') === 720, 'noon should be 720');
  assert(windowStartMinutes('12:00 AM - 1:00 AM') === 0, 'midnight should be 0');

  const { writeCell } = require('../netlify/functions/lib/google-sheets-inventory');
  const sheetData = [];
  const sheetUpdated = [];
  writeCell(sheetData, sheetUpdated, {
    id: '12',
    sheetTitle: 'Sheet1',
    sheetRow: 4,
    columnKey: 'add_qty',
    columnIndexValue: 6,
    value: 3,
  });
  writeCell(sheetData, sheetUpdated, {
    id: '12',
    sheetTitle: 'Sheet1',
    sheetRow: 4,
    columnKey: 'opening_qty',
    columnIndexValue: -1,
    value: 0,
  });
  assert(sheetData.length === 1, 'writeCell should skip missing columns');
  assert(sheetData[0].range === "'Sheet1'!G4", `expected Sheet1!G4, got ${sheetData[0].range}`);
  assert(sheetData[0].values[0][0] === 3, 'writeCell should queue the value');
  assert(sheetUpdated[0].field === 'add_qty', 'writeCell should record the field');

  console.log('PASS unit helpers');
}

async function runHttpTests(base = 'http://localhost:8888') {
  const pages = [
    { path: '/admin', mustInclude: ['data-admin-status-filter', 'admin.js?v=9'] },
    { path: '/admin/calendar', mustInclude: ['data-admin-calendar', 'admin-calendar.js?v=4'] },
    { path: '/admin/inventory', mustInclude: ['Low stock', 'data-admin-inventory-search', 'data-sync-to-sheet', 'admin-inventory.js?v=25'] },
    { path: '/admin/orders', mustInclude: ['Waiting for tires', 'data-admin-orders-filter', 'admin-orders.js?v=5'] },
  ];

  for (const page of pages) {
    const { response, text, contentType } = await fetchText(`${base}${page.path}`);
    assert(response.status === 200, `${page.path} expected 200, got ${response.status}`);
    assert(contentType.includes('text/html'), `${page.path} expected HTML, got ${contentType}`);
    for (const marker of page.mustInclude) {
      assert(text.includes(marker), `${page.path} missing marker: ${marker}`);
    }
    console.log(`PASS page ${page.path}`);
  }

  const home = await fetchText(`${base}/`);
  assert(home.response.status === 200, `home expected 200, got ${home.response.status}`);
  assert(home.text.includes('<title>EASTCORD TIRES | Used & New Tires</title>'), 'home title should not include in Brantford');
  assert(!home.text.includes('Used & New Tires in Brantford'), 'old Brantford title should be gone');
  console.log('PASS homepage title');

  const assets = [
    '/admin.css?v=22',
    '/admin.js?v=9',
    '/admin-calendar.js?v=4',
    '/admin-inventory.js?v=25',
    '/admin-orders.js?v=5',
  ];

  for (const asset of assets) {
    const { response, text, contentType } = await fetchText(`${base}${asset}`);
    assert(response.status === 200, `${asset} expected 200, got ${response.status}`);
    assert(!contentType.includes('octet-stream'), `${asset} should not be octet-stream`);
    assert(text.length > 50, `${asset} body too small`);
    console.log(`PASS asset ${asset}`);
  }

  // Source markers for today's features
  const inventoryJs = await fetchText(`${base}/admin-inventory.js?v=25`);
  assert(inventoryJs.text.includes('LOW_STOCK_MAX'), 'inventory js missing LOW_STOCK_MAX');
  assert(inventoryJs.text.includes("stockFilter === 'low'"), 'inventory js missing low filter');
  assert(inventoryJs.text.includes('syncToSheet'), 'inventory js missing syncToSheet');
  assert(inventoryJs.text.includes('admin-drive-link'), 'inventory js missing compact drive link');

  const adminJs = await fetchText(`${base}/admin.js?v=9`);
  assert(adminJs.text.includes('mapsHref'), 'admin js missing mapsHref');
  assert(adminJs.text.includes('renderLocation'), 'admin js missing renderLocation');

  const calendarJs = await fetchText(`${base}/admin-calendar.js?v=4`);
  assert(calendarJs.text.includes('dayStats'), 'calendar js missing dayStats');
  assert(calendarJs.text.includes('admin-cal-day-count'), 'calendar js missing day count markup');

  console.log('PASS feature markers in JS');

  const appointmentsApi = await fetchJson(`${base}/.netlify/functions/admin-appointments?date=2026-09-18`);
  assert(
    appointmentsApi.response.status === 401 || appointmentsApi.response.status === 403,
    `admin-appointments should require auth, got ${appointmentsApi.response.status}`,
  );
  console.log('PASS admin-appointments auth gate');

  const inventoryApi = await fetchJson(`${base}/.netlify/functions/admin-used-inventory`);
  assert(
    inventoryApi.response.status === 401 || inventoryApi.response.status === 403,
    `admin-used-inventory should require auth, got ${inventoryApi.response.status}`,
  );
  console.log('PASS admin-used-inventory auth gate');

  const inventoryPatch = await fetchJson(`${base}/.netlify/functions/admin-used-inventory`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, add_qty: 1 }),
  });
  assert(
    inventoryPatch.response.status === 401 || inventoryPatch.response.status === 403,
    `inventory PATCH should require auth, got ${inventoryPatch.response.status}`,
  );
  console.log('PASS inventory PATCH auth gate');

  const syncToSheet = await fetchJson(`${base}/.netlify/functions/admin-used-inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'syncToSheet' }),
  });
  assert(
    syncToSheet.response.status === 401 || syncToSheet.response.status === 403,
    `syncToSheet should require auth, got ${syncToSheet.response.status}`,
  );
  console.log('PASS syncToSheet auth gate');

  const ordersApi = await fetchJson(`${base}/.netlify/functions/admin-new-tire-orders`);
  assert(
    ordersApi.response.status === 401 || ordersApi.response.status === 403,
    `admin-new-tire-orders should require auth, got ${ordersApi.response.status}`,
  );
  console.log('PASS admin-new-tire-orders auth gate');
}

async function main() {
  runUnitTests();
  await runHttpTests(process.env.ADMIN_BASE_URL || 'http://localhost:8888');
  console.log('\nAll admin local smoke tests passed.');
}

main().catch((error) => {
  console.error('\nFAIL:', error.message);
  process.exit(1);
});
