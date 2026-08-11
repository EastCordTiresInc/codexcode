const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(filePath(relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(filePath(relativePath), content);
  console.log(`[EastCord build] Updated ${relativePath}`);
}

function replaceExact(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  if (!content.includes(search)) {
    throw new Error(`Could not apply patch: ${label}`);
  }
  return content.replace(search, replacement);
}

function insertAfter(content, marker, addition, label) {
  if (content.includes(addition.trim())) return content;
  if (!content.includes(marker)) {
    throw new Error(`Could not insert patch: ${label}`);
  }
  return content.replace(marker, `${marker}${addition}`);
}

function update(relativePath, updater) {
  const before = read(relativePath);
  const after = updater(before);
  if (after !== before) write(relativePath, after);
  else console.log(`[EastCord build] ${relativePath} already normalized`);
}

const browserTireCountHelper = `

  function getServiceTireCount(serviceId, serviceName = '') {
    const counts = {
      'seasonal-changeover-rims': 4,
      'seasonal-swap-not-mounted': 4,
      'mount-balance-1': 1,
      'mount-balance-2': 2,
      'mount-balance-3': 3,
      'mount-balance-4': 4,
    };
    if (counts[serviceId]) return counts[serviceId];

    const mountBalanceMatch = String(serviceName || '').match(/Mount\s*&\s*Balance\s*-\s*([1-4])\s*Tire/i);
    if (mountBalanceMatch) return Number(mountBalanceMatch[1]);
    if (/Seasonal\s+(Changeover|Tire\s+Swap)/i.test(String(serviceName || ''))) return 4;
    return 0;
  }
`;

const appointmentTireHelpers = `${browserTireCountHelper}
  function getCurrentServiceTireCount(service = state.currentService || getCurrentService()) {
    return getServiceTireCount(service?.id, service?.name) || Number(getFieldValue('Number of Tires') || 0);
  }

  function syncTireCountWithService(service) {
    const tireField = els.appointmentForm?.elements.namedItem('Number of Tires');
    const tireCount = getServiceTireCount(service?.id, service?.name);
    if (tireField && tireCount) tireField.value = String(tireCount);
    return tireCount;
  }
`;

const serverTireCountHelper = `

function getServiceTireCount(serviceId, serviceName = '') {
  const counts = {
    'seasonal-changeover-rims': 4,
    'seasonal-swap-not-mounted': 4,
    'mount-balance-1': 1,
    'mount-balance-2': 2,
    'mount-balance-3': 3,
    'mount-balance-4': 4,
  };
  if (counts[serviceId]) return counts[serviceId];

  const mountBalanceMatch = String(serviceName || '').match(/Mount\s*&\s*Balance\s*-\s*([1-4])\s*Tire/i);
  if (mountBalanceMatch) return Number(mountBalanceMatch[1]);
  if (/Seasonal\s+(Changeover|Tire\s+Swap)/i.test(String(serviceName || ''))) return 4;
  return 0;
}
`;

update('appointment.js', (content) => {
  content = insertAfter(
    content,
    `  function calculateServiceAmounts(subtotal) {\n    const serviceSubtotal = roundMoney(subtotal);\n    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);\n    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);\n    const deposit = roundMoney(totalWithHst * 0.20);\n    const remaining = roundMoney(totalWithHst - deposit);\n\n    return {\n      serviceSubtotal,\n      hstAmount,\n      totalWithHst,\n      deposit,\n      remaining,\n      taxRate: TAX_RATE,\n    };\n  }`,
    appointmentTireHelpers,
    'appointment tire count helper'
  );
  content = replaceExact(
    content,
    `    state.currentService = service;\n\n    if (els.startingPrice)`,
    `    state.currentService = service;\n    syncTireCountWithService(service);\n\n    if (els.startingPrice)`,
    'sync tire count when service changes'
  );
  content = replaceExact(
    content,
    `    const tireCount = getFieldValue('Number of Tires');`,
    `    const service = state.currentService || getCurrentService();\n    const tireCount = getServiceTireCount(service?.id, service?.name) || getFieldValue('Number of Tires');`,
    'review tire count from service'
  );
  content = replaceExact(
    content,
    `      numberOfTires: getFieldValue('Number of Tires'),`,
    `      numberOfTires: String(getCurrentServiceTireCount(selectedService) || getFieldValue('Number of Tires')),`,
    'appointment cart tire count from service'
  );
  return content;
});

update('cart.js', (content) => {
  content = insertAfter(
    content,
    `  function calculateTaxBreakdown(subtotal) {\n    const serviceSubtotal = roundMoney(subtotal);\n    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);\n    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);\n    const depositAmount = roundMoney(totalWithHst * 0.20);\n    const remainingBalance = roundMoney(totalWithHst - depositAmount);\n    return { serviceSubtotal, hstAmount, totalWithHst, depositAmount, remainingBalance, taxRate: TAX_RATE };\n  }`,
    browserTireCountHelper,
    'cart tire count helper'
  );
  content = replaceExact(
    content,
    `    const serviceId = first(source, ['serviceId', 'service_id']);\n    const subtotal = Number(first(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price', 'price'], SERVICE_SUBTOTALS[serviceId] || 0));`,
    `    const serviceId = first(source, ['serviceId', 'service_id']);\n    const serviceName = first(source, ['serviceName', 'service_name'], SERVICE_NAMES[serviceId] || 'Appointment service');\n    const serviceTireCount = getServiceTireCount(serviceId, serviceName);\n    const subtotal = Number(first(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price', 'price'], SERVICE_SUBTOTALS[serviceId] || 0));`,
    'cart derive tire count setup'
  );
  content = replaceExact(
    content,
    `      serviceName: first(source, ['serviceName', 'service_name'], SERVICE_NAMES[serviceId] || 'Appointment service'),`,
    `      serviceName,`,
    'cart normalized service name'
  );
  content = replaceExact(
    content,
    `      numberOfTires: first(source, ['numberOfTires', 'number_of_tires']),`,
    `      numberOfTires: String(serviceTireCount || first(source, ['numberOfTires', 'number_of_tires'])),`,
    'cart normalized tire count'
  );
  return content;
});

update('account.js', (content) => {
  content = insertAfter(
    content,
    `function calculateTaxBreakdown(subtotal) {\n  const serviceSubtotal = roundMoney(subtotal);\n  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);\n  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);\n  const depositAmount = roundMoney(totalWithHst * 0.20);\n  const remainingBalance = roundMoney(totalWithHst - depositAmount);\n\n  return {\n    serviceSubtotal,\n    hstAmount,\n    totalWithHst,\n    depositAmount,\n    remainingBalance,\n    taxRate: TAX_RATE,\n  };\n}`,
    serverTireCountHelper,
    'account tire count helper'
  );
  content = replaceExact(
    content,
    `    number_of_tires: Number(item.numberOfTires || 0),`,
    `    number_of_tires: getServiceTireCount(item.serviceId, item.serviceName) || Number(item.numberOfTires || 0),`,
    'Supabase booking tire count from service'
  );
  content = replaceExact(
    content,
    `.select('id, service_name, preferred_date, preferred_time_window, city, tire_size, vehicle_year, vehicle_make, vehicle_model, vehicle_plate_number, vehicle_colour, service_subtotal, hst_amount, total_with_hst, deposit_amount, remaining_balance, booking_status, payment_status, created_at')`,
    `.select('id, service_id, service_name, preferred_date, preferred_time_window, city, tire_size, number_of_tires, vehicle_year, vehicle_make, vehicle_model, vehicle_plate_number, vehicle_colour, service_subtotal, hst_amount, total_with_hst, deposit_amount, remaining_balance, booking_status, payment_status, created_at')`,
    'account booking history select tire count'
  );
  content = replaceExact(
    content,
    `    const colour = booking.vehicle_colour ? \` | Colour: \${escapeHtml(booking.vehicle_colour)}\` : '';\n    return \``,
    `    const colour = booking.vehicle_colour ? \` | Colour: \${escapeHtml(booking.vehicle_colour)}\` : '';\n    const tireSize = booking.tire_size ? \` | Tire Size: \${escapeHtml(booking.tire_size)}\` : '';\n    const tireCount = getServiceTireCount(booking.service_id, booking.service_name) || Number(booking.number_of_tires || 0);\n    const tires = tireCount ? \` | Tires: \${escapeHtml(tireCount)}\` : '';\n    return \``,
    'account booking history tire variables'
  );
  content = replaceExact(
    content,
    `        <p>\${escapeHtml(vehicle || 'Vehicle details submitted')}\${plate}\${colour}\${booking.tire_size ? \` | \${escapeHtml(booking.tire_size)}\` : ''}</p>`,
    `        <p>\${escapeHtml(vehicle || 'Vehicle details submitted')}\${plate}\${colour}\${tireSize}\${tires}</p>`,
    'account booking history tire display'
  );
  return content;
});

update('appointment-success.html', (content) => {
  content = insertAfter(
    content,
    `        function getTaxDetails(item) {\n          const fallback = calculateTaxBreakdown(item.serviceSubtotal ?? item.startingPrice ?? 0);\n          return {\n            serviceSubtotal: roundMoney(item.serviceSubtotal ?? item.startingPrice ?? fallback.serviceSubtotal),\n            hstAmount: roundMoney(item.hstAmount ?? fallback.hstAmount),\n            totalWithHst: roundMoney(item.totalWithHst ?? fallback.totalWithHst),\n            depositAmount: roundMoney(item.depositAmount ?? fallback.depositAmount),\n            remainingBalance: roundMoney(item.remainingBalance ?? fallback.remainingBalance),\n          };\n        }`,
    `\n\n        function getServiceTireCount(serviceId, serviceName = '') {\n          const counts = {\n            'seasonal-changeover-rims': 4,\n            'seasonal-swap-not-mounted': 4,\n            'mount-balance-1': 1,\n            'mount-balance-2': 2,\n            'mount-balance-3': 3,\n            'mount-balance-4': 4,\n          };\n          if (counts[serviceId]) return counts[serviceId];\n          const mountBalanceMatch = String(serviceName || '').match(/Mount\\s*&\\s*Balance\\s*-\\s*([1-4])\\s*Tire/i);\n          if (mountBalanceMatch) return Number(mountBalanceMatch[1]);\n          if (/Seasonal\\s+(Changeover|Tire\\s+Swap)/i.test(String(serviceName || ''))) return 4;\n          return 0;\n        }`,
    'success page tire count helper'
  );
  content = replaceExact(
    content,
    `            <div class="appointment-review-card"><span>Tires</span><strong>\${escapeHtml(item.numberOfTires || 'Tire count submitted')}</strong></div>`,
    `            <div class="appointment-review-card"><span>Tires</span><strong>\${escapeHtml(getServiceTireCount(item.serviceId, item.serviceName) || item.numberOfTires || 'Tire count submitted')}</strong></div>`,
    'success tire count from service'
  );
  return content;
});

update('netlify/functions/create-appointment-checkout-session.js', (content) => {
  content = insertAfter(
    content,
    `const SERVICES = {\n  'seasonal-changeover-rims': { name: 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims', startingPrice: 40 },\n  'seasonal-swap-not-mounted': { name: 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims', startingPrice: 80 },\n  'mount-balance-1': { name: 'Mount & Balance - 1 Tire', startingPrice: 25 },\n  'mount-balance-2': { name: 'Mount & Balance - 2 Tires', startingPrice: 50 },\n  'mount-balance-3': { name: 'Mount & Balance - 3 Tires', startingPrice: 75 },\n  'mount-balance-4': { name: 'Mount & Balance - 4 Tires', startingPrice: 100 },\n};`,
    serverTireCountHelper,
    'checkout tire count helper'
  );
  content = replaceExact(
    content,
    `    number_of_tires: Number(booking.numberOfTires || 0),`,
    `    number_of_tires: getServiceTireCount(booking.serviceId, service.name) || Number(booking.numberOfTires || 0),`,
    'checkout repair insert tire count'
  );
  content = replaceExact(
    content,
    `            tax_rate: item.taxRate,\n            stripe_session_id: session.id,`,
    `            tax_rate: item.taxRate,\n            number_of_tires: getServiceTireCount(item.booking.serviceId, item.service.name) || Number(item.booking.numberOfTires || 0),\n            stripe_session_id: session.id,`,
    'checkout update tire count'
  );
  return content;
});

update('netlify/functions/stripe-webhook.js', (content) => {
  content = insertAfter(
    content,
    `function getTaxDetails(row) {\n  const fallback = calculateTaxBreakdown(row.service_subtotal ?? row.starting_price ?? 0);\n  return {\n    serviceSubtotal: roundMoney(row.service_subtotal ?? row.starting_price ?? fallback.serviceSubtotal),\n    hstAmount: roundMoney(row.hst_amount ?? fallback.hstAmount),\n    totalWithHst: roundMoney(row.total_with_hst ?? fallback.totalWithHst),\n    depositAmount: roundMoney(row.deposit_amount ?? fallback.depositAmount),\n    remainingBalance: roundMoney(row.remaining_balance ?? fallback.remainingBalance),\n  };\n}`,
    serverTireCountHelper,
    'webhook tire count helper'
  );
  content = replaceExact(
    content,
    "    `Tire Size: ${valueOrFallback(row.tire_size, 'Not provided')}`,",
    "    `Tire Size: ${valueOrFallback(row.tire_size, 'Not provided')}`,\n    `Tires: ${getServiceTireCount(row.service_id, row.service_name) || valueOrFallback(row.number_of_tires, 'Not provided')}`,",
    'webhook text email tire count'
  );
  content = replaceExact(
    content,
    `      <tr><td style="padding:6px 0;font-weight:700;">Tire Size:</td><td style="padding:6px 0;">\${escapeHtml(valueOrFallback(row.tire_size, 'Not provided'))}</td></tr>`,
    `      <tr><td style="padding:6px 0;font-weight:700;">Tire Size:</td><td style="padding:6px 0;">\${escapeHtml(valueOrFallback(row.tire_size, 'Not provided'))}</td></tr>\n      <tr><td style="padding:6px 0;font-weight:700;">Tires:</td><td style="padding:6px 0;">\${escapeHtml(getServiceTireCount(row.service_id, row.service_name) || valueOrFallback(row.number_of_tires, 'Not provided'))}</td></tr>`,
    'webhook html email tire count'
  );
  return content;
});

update('appointment.html', (content) => content
  .replace('account.js?v=12', 'account.js?v=13')
  .replace('appointment.js?v=36', 'appointment.js?v=37'));

update('cart.html', (content) => content
  .replace('account.js?v=12', 'account.js?v=13')
  .replace('cart.js?v=18', 'cart.js?v=19'));

update('account.html', (content) => content.replace('account.js?v=9', 'account.js?v=13'));

console.log('[EastCord build] Service tire counts now normalize from selected service.');
