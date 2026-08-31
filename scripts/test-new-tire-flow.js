#!/usr/bin/env node
/* EastCord new-tire order → account → booking checks. Run: node scripts/test-new-tire-flow.js */

const assert = require('assert');
const {
  normalizeWidgetItems,
  cleanWidgetText,
  cleanTireSize,
} = require('../netlify/functions/lib/new-tire-order');
const {
  torontoYmd,
  addDaysYmd,
  earliestInstallYmd,
  isPreferredDateInShippingHold,
  NEW_TIRE_SHIPPING_DAYS,
} = require('../netlify/functions/lib/new-tire-shipping-hold');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
  }
}

test('strips TireConnect "FOUND 86 TIRES FOR" chrome from model', () => {
  assert.strictEqual(cleanWidgetText('FOUND 86 TIRES FOR:'), '');
  assert.strictEqual(cleanWidgetText('BFGoodrich FOUND 86 TIRES FOR:'), 'BFGoodrich');
});

test('strips TireConnect "FILTER RESULTS" chrome from brand', () => {
  assert.strictEqual(cleanWidgetText('FILTER RESULTS:'), '');
  assert.strictEqual(cleanWidgetText('BFGoodrich FILTER RESULTS:'), 'BFGoodrich');
  assert.strictEqual(cleanWidgetText(`BFGoodrich FILTER RESULTS:${String.fromCharCode(0xF105)}`), 'BFGoodrich');
});

test('extracts core metric size from concatenated widget size', () => {
  assert.strictEqual(cleanTireSize('185/65R1588HSLWARRANTY'), '185/65R15');
  assert.strictEqual(cleanTireSize('185/65R15'), '185/65R15');
  assert.strictEqual(cleanTireSize('31X10.50R15'), '31X10.50R15');
});

test('normalizeWidgetItems keeps brand/size and drops junk model', () => {
  const [item] = normalizeWidgetItems([{
    brand: 'BFGoodrich',
    model: 'FOUND 86 TIRES FOR:',
    size: '185/65R1588HSLWARRANTY',
    qty: 4,
    unitPrice: 143.61,
  }]);
  assert.strictEqual(item.brand, 'BFGoodrich');
  assert.strictEqual(item.model, '');
  assert.strictEqual(item.size, '185/65R15');
  assert.strictEqual(item.qty, 4);
  assert.strictEqual(item.unitPrice, 143.61);
  assert.strictEqual(item.lineTotal, 574.44);
});

test('normalizeWidgetItems drops empty junk-only rows', () => {
  const items = normalizeWidgetItems([
    { brand: '', model: 'FOUND 12 TIRES FOR:', size: 'warranty' },
  ]);
  assert.deepStrictEqual(items, []);
});

test('4-day hold uses Toronto purchase date, not UTC clock', () => {
  // Aug 28, 2026 8:00 PM Toronto = Aug 29, 2026 00:00 UTC
  const paidAt = '2026-08-29T00:00:00.000Z';
  assert.strictEqual(torontoYmd(paidAt), '2026-08-28');
  assert.strictEqual(earliestInstallYmd(paidAt), '2026-09-02');
  assert.strictEqual(isPreferredDateInShippingHold('2026-08-28', paidAt), true);
  assert.strictEqual(isPreferredDateInShippingHold('2026-08-31', paidAt), true);
  assert.strictEqual(isPreferredDateInShippingHold('2026-09-01', paidAt), true);
  assert.strictEqual(isPreferredDateInShippingHold('2026-09-02', paidAt), false);
});

test('SQL-equivalent: first bookable day is the day after the 4-day hold', () => {
  const purchased = '2026-08-28';
  const firstBookable = addDaysYmd(purchased, NEW_TIRE_SHIPPING_DAYS + 1);
  assert.strictEqual(firstBookable, '2026-09-02');
  assert.strictEqual(addDaysYmd('2026-01-30', 4), '2026-02-03');
});

test('appointment email link includes source and order id', () => {
  const orderId = '162acae5-a4e8-432b-956b-5cdbd22dbe10';
  const url = `https://eastcordtires.ca/appointment.html?source=new-tires&newTireOrder=${encodeURIComponent(orderId)}#appointment-booking`;
  assert.match(url, /source=new-tires/);
  assert.match(url, /newTireOrder=162acae5-a4e8-432b-956b-5cdbd22dbe10/);
});

function formatSavedTireLabel(item) {
  const qty = Math.max(1, Number(item.qty) || 1);
  const kind = item.type === 'new_tire' ? 'New' : '';
  const brand = cleanWidgetText(item.brand);
  const model = cleanWidgetText(item.model);
  const size = cleanTireSize(item.size);
  return `${[kind, brand, model, size].filter(Boolean).join(' ')} × ${qty}`.trim();
}

test('appointment card title for the BFGoodrich screenshot row', () => {
  const label = formatSavedTireLabel({
    type: 'new_tire',
    brand: 'BFGoodrich',
    model: 'FOUND 86 TIRES FOR:',
    size: '185/65R1588HSLWARRANTY',
    qty: 4,
  });
  assert.strictEqual(label, 'New BFGoodrich 185/65R15 × 4');
});

test('appointment card title strips FILTER RESULTS glued onto brand', () => {
  const label = formatSavedTireLabel({
    type: 'new_tire',
    brand: `BFGoodrich FILTER RESULTS:${String.fromCharCode(0xF105)}`,
    model: '',
    size: '225/45R18',
    qty: 4,
  });
  assert.strictEqual(label, 'New BFGoodrich 225/45R18 × 4');
});

test('ROADBOSS row stays readable', () => {
  const label = formatSavedTireLabel({
    type: 'new_tire',
    brand: 'ROADBOSS TIRE',
    model: 'Celsius',
    size: '185/65R15',
    qty: 2,
  });
  assert.strictEqual(label, 'New ROADBOSS TIRE Celsius 185/65R15 × 2');
});

const widgetPayloads = [
  { brand: 'Michelin', model: 'Defender', size: '215/55R17', qty: 4, unitPrice: 189.99 },
  { brand_name: 'Goodyear', model_name: 'Assurance', size: '205/55R16', quantity: 2, unit_price: 164.5 },
  { manufacturer: 'Hankook', product_name: 'Kinergy', tire_size: '225/45ZR17', selectedQuantity: 4, price_per_tire: 142 },
  { brand: 'Pirelli', model: 'P7', size: 'P225/45R18 91V', qty: 4, price: 210 },
  { brand: 'Toyo', model: 'Celsius', size: '185/65R15', qty: 2, unitPrice: 61.43 },
  { brand: 'BFGoodrich', model: 'FOUND 86 TIRES FOR:', size: '185/65R1588HSLWARRANTY', qty: 4, unitPrice: 143.61 },
  { brand: 'BFGoodrich FILTER RESULTS:', model: '', size: '225/45R18', qty: 4, unitPrice: 237.18 },
  { brand: 'Firestone', model: 'WeatherGrip', size: 'LT265/70R17', qty: 4, retail_price: 198.2 },
  { brand: 'Nitto', model: 'Ridge Grappler', size: '35X12.50R20', qty: 4, unitPrice: 399 },
  { brand: 'Cooper', model: 'Discoverer', size: '31X10.50R15', qty: 4, unitPrice: 221 },
  { brand: 'Continental', model: 'TrueContact', size: '195 / 65 R 15', qty: 4, unitPrice: 155 },
  { brand: '<script>alert(1)</script>Michelin', model: 'CrossClimate', size: '225/50R17', qty: 4, unitPrice: 188 },
  { brand: 'Yokohama', model: '', size: '215/60R16', qty: 4, unitPrice: 149 },
  { brand: '', model: 'WinterContact', size: '205/55R16', qty: 4, unitPrice: 171 },
  { brand: 'Price Summary', model: 'Add to cart', size: 'warranty', qty: 4, unitPrice: 99 },
  { brand: 'ROADBOSS TIRE', model: 'Celsius', size: '185/65R15', qty: 2, unitPrice: 61.43 },
  { brand: 'Kumho', model: 'Solus', size: '205/65R16', selected_quantity: 1, unitPrice: 132 },
  { brand: 'Nexen', model: 'N5000', size: '225/65R17', qty: '4', unitPrice: '159.00' },
  { brand: 'Falken', model: 'Ziex', size: '245/40R18', qty: 0, unitPrice: 176 },
  { brand: 'General', model: 'Altimax', size: '215/55R17', qty: 9, unitPrice: 144 },
  { brand: 'Dunlop', model: 'Signature', size: '205/55R16', qty: 4, unitPrice: -20 },
  { brand: 'Uniroyal', model: 'Tiger Paw', size: '225/60R16', qty: 4, unitPrice: 0 },
  { brand: 'Sailun', model: 'Atrezzo', size_short: '205/55R16', qty: 4, unitPrice: 98.88 },
  { brand: 'Maxxis', model: 'Victra', size_display: '225/45R17 94W', qty: 4, unitPrice: 133.33 },
  { brand: 'Kenda', model: 'Kenetica', tire_size: '185/65R14', qty: 4, part_number: 'KEN-123' },
  { brand: 'Nokian', model: 'Hakkapeliitta', size: '215/65R16', qty: 4, unitPrice: 247.1 },
  { brand: 'Ironman', model: 'iMOVE', size: '225/50R17', qty: 4, unitPrice: 89.99 },
  { brand: 'GT Radial', model: 'Champiro', size: '195/65R15', qty: 4, unitPrice: 92 },
  { brand: 'Mastercraft', model: 'Courser', size: '265/70R16', qty: 4, unitPrice: 156 },
  { brand: 'Kelly', model: 'Edge', size: '205/70R15', qty: 4, unitPrice: 101 },
  { brand: 'Starfire', model: 'RS-C', size: '215/55R17', qty: 4, unitPrice: 110 },
  { brand: 'Achilles', model: 'Platinum', size: '225/45R17', qty: 4, unitPrice: 95 },
  { brand: 'Atturo', model: 'Trail Blade', size: '285/70R17', qty: 4, unitPrice: 168 },
  { brand: 'Vercelli', model: 'Strada', size: '245/45R18', qty: 4, unitPrice: 121 },
  { brand: 'Thunderer', model: 'Mach III', size: '225/40R18', qty: 4, unitPrice: 87 },
  { brand: 'Primewell', model: 'Valera', size: '205/55R16', qty: 4, unitPrice: 79 },
  { brand: 'Bridgestone', model: 'Blizzak', size: '225/65R17', qty: 4, unitPrice: 201.45 },
  { brand: 'Michelin', model: 'X-Ice', size: '215/60R16', qty: 2, unitPrice: 178.2 },
  { brand: 'Goodyear', model: 'Ultra Grip', size: '225/70R16', qty: 4, unitPrice: 166 },
  { brand: 'Hankook', model: 'i*Pike', size: '205/55R16', qty: 4, unitPrice: 139 },
  { brand: 'Pirelli', model: 'Sottozero', size: '245/40R18', qty: 4, unitPrice: 255 },
  { brand: 'Toyo', model: 'Observe', size: '215/70R16', qty: 4, unitPrice: 147 },
  { brand: 'Continental', model: 'VikingContact', size: '225/55R17', qty: 4, unitPrice: 193 },
  { brand: 'Yokohama', model: 'iceGUARD', size: '205/60R16', qty: 4, unitPrice: 151 },
  { brand: 'Cooper', model: 'Winter Master', size: '225/75R16', qty: 4, unitPrice: 128 },
  { brand: 'Falken', model: 'Eurowinter', size: '205/55R16', qty: 4, unitPrice: 136 },
  { brand: 'Nexen', model: 'Winguard', size: '215/55R17', qty: 4, unitPrice: 119 },
  { brand: 'Kumho', model: 'WinterCraft', size: '225/45R17', qty: 4, unitPrice: 141 },
  { brand: 'Nitto', model: 'NT421Q', size: '275/55R20', qty: 4, unitPrice: 232 },
  { brand: 'General', model: 'Grabber', size: '265/65R17', qty: 4, unitPrice: 174 },
  { brand: 'Dunlop', model: 'Winter Maxx', size: '215/55R17', qty: 4, unitPrice: 162 },
];

test(`runs ${widgetPayloads.length} widget order payloads through the live save normalizer`, () => {
  assert.strictEqual(widgetPayloads.length, 51);
  const results = widgetPayloads.map((payload, index) => {
    const [item] = normalizeWidgetItems([payload]);
    return { index, payload, item };
  });

  const junk = results.find((row) => row.payload.size === 'warranty');
  assert.ok(!junk.item, 'widget chrome-only row must not be saved');

  const found86 = results.find((row) => /FOUND 86/i.test(row.payload.model || ''));
  assert.ok(found86.item);
  assert.strictEqual(found86.item.model, '');
  assert.strictEqual(found86.item.brand, 'BFGoodrich');
  assert.strictEqual(found86.item.size, '185/65R15');

  const filterResults = results.find((row) => /FILTER RESULTS/i.test(row.payload.brand || ''));
  assert.ok(filterResults.item);
  assert.strictEqual(filterResults.item.brand, 'BFGoodrich');
  assert.strictEqual(filterResults.item.model, '');
  assert.strictEqual(filterResults.item.size, '225/45R18');

  const alias = results.find((row) => row.payload.brand_name === 'Goodyear');
  assert.ok(alias.item);
  assert.strictEqual(alias.item.brand, 'Goodyear');
  assert.strictEqual(alias.item.qty, 2);
  assert.strictEqual(alias.item.unitPrice, 164.5);

  const zr = results.find((row) => row.payload.manufacturer === 'Hankook');
  assert.strictEqual(zr.item.size, '225/45ZR17');
  assert.strictEqual(zr.item.qty, 4);

  const pMetric = results.find((row) => String(row.payload.size || '').startsWith('P225'));
  assert.strictEqual(pMetric.item.size, '225/45R18');

  const html = results.find((row) => /script/i.test(row.payload.brand || ''));
  assert.ok(html.item.brand.includes('Michelin'));
  assert.ok(!html.item.brand.includes('<'));

  const qtyZero = results.find((row) => row.payload.qty === 0);
  assert.strictEqual(qtyZero.item.qty, 1);

  const qtyNine = results.find((row) => row.payload.qty === 9);
  assert.strictEqual(qtyNine.item.qty, 8);

  const negative = results.find((row) => row.payload.unitPrice === -20);
  assert.strictEqual(negative.item.unitPrice, 0);

  const spaced = results.find((row) => row.payload.size === '195 / 65 R 15');
  assert.strictEqual(spaced.item.size, '195/65R15');

  const flotation = results.find((row) => row.payload.size === '35X12.50R20');
  assert.strictEqual(flotation.item.size, '35X12.50R20');

  const lt = results.find((row) => String(row.payload.size || '').startsWith('LT'));
  assert.strictEqual(lt.item.size, '265/70R17');

  const saved = results.filter((row) => row.item);
  assert.ok(saved.length >= 48, `expected almost all payloads to save, got ${saved.length}`);
  saved.forEach((row) => {
    assert.ok(row.item.brand || row.item.model || row.item.size, `row ${row.index} lost tire identity`);
    assert.ok(row.item.qty >= 1 && row.item.qty <= 8);
    assert.ok(row.item.unitPrice >= 0);
    assert.strictEqual(row.item.kind, 'new_tire');
  });
});

const holdCases = [
  ['2026-08-28', '2026-08-28', true],
  ['2026-08-28', '2026-08-29', true],
  ['2026-08-28', '2026-08-30', true],
  ['2026-08-28', '2026-08-31', true],
  ['2026-08-28', '2026-09-01', true],
  ['2026-08-28', '2026-09-02', false],
  ['2026-12-30', '2027-01-03', true],
  ['2026-12-30', '2027-01-04', false],
  ['2026-02-26', '2026-03-02', true],
  ['2026-02-26', '2026-03-03', false],
];

test('booking hold covers month and year boundaries', () => {
  holdCases.forEach(([purchased, preferred, blocked]) => {
    const paidAt = `${purchased}T16:00:00.000-04:00`;
    assert.strictEqual(
      isPreferredDateInShippingHold(preferred, paidAt),
      blocked,
      `${purchased} booking ${preferred} should ${blocked ? 'be blocked' : 'be allowed'}`,
    );
  });
});

test('keeps Ovation as a real brand and strips FILTER RESULTS from it', () => {
  assert.strictEqual(cleanWidgetText('Ovation'), 'Ovation');
  assert.strictEqual(cleanWidgetText('Ovation FILTER RESULTS:'), 'Ovation');
  const [item] = normalizeWidgetItems([{
    brand: 'Ovation FILTER RESULTS:',
    model: '',
    size: '225/45R18',
    qty: 4,
    unitPrice: 162.6,
  }]);
  assert.strictEqual(item.brand, 'Ovation');
  assert.strictEqual(item.size, '225/45R18');
});

const {
  strongerBrand,
  pickSummaryBrand,
  headingBrandFrom,
  knownBrandIn,
} = require('../new-tire-brand.js');

test('summary heading Mirage is not overwritten by leftover BFGoodrich filters', () => {
  const summary = [
    'SUMMARY',
    'MIRAGE',
    'MR-182',
    'WARRANTY',
    'N/A',
    'CATEGORY',
    'Performance Summer',
    'SIZE',
    '225/45R18 95W XL',
    'QTY',
    '4',
    'PER TIRE',
    '$95.40',
    'CHANGE TIRE',
  ].join('\n');
  const widgetWithFilters = [
    'FILTER RESULTS',
    'BFGoodrich',
    'Michelin',
    'Ovation',
    'FOUND 86 TIRES FOR:',
    summary,
  ].join('\n');

  assert.strictEqual(pickSummaryBrand(summary), 'Mirage');
  assert.strictEqual(headingBrandFrom(summary), 'Mirage');
  assert.match(knownBrandIn(widgetWithFilters), /BF\s*Goodrich/i);
  assert.strictEqual(strongerBrand('Mirage', 'BF Goodrich'), 'Mirage');
  assert.strictEqual(strongerBrand('Mirage', 'BFGoodrich'), 'Mirage');
  assert.notStrictEqual(pickSummaryBrand(summary), knownBrandIn(widgetWithFilters));
});

test('new-tires capture keeps Ovation, strips widget chrome, and does not fake a login error', () => {
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'new-tires.js'), 'utf8');
  const brands = fs.readFileSync(path.join(__dirname, '..', 'new-tire-brand.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'new-tires.html'), 'utf8');
  assert.match(brands, /'Ovation'/);
  assert.match(brands, /'Mirage'/);
  assert.match(page, /pickSummaryBrand/);
  assert.match(page, /summaryPanelText/);
  assert.match(brands, /filter\\s\*results:\?/);
  assert.match(page, /onTireSearchResults/);
  assert.match(page, /brandFromCache/);
  assert.match(page, /Keep npm run dev running/);
  assert.doesNotMatch(page, /The demo order could not be saved\. Log in and try again/);
  assert.match(html, /new-tire-brand\.js\?v=/);
  assert.match(html, /You cannot book on the purchase date or the following 4 days/);
  assert.doesNotMatch(html, /Search tires in the widget/);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll local flow tests passed.');
