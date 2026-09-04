#!/usr/bin/env node
const assert = require('assert');
const services = require('../appointment-services');

function test(name, run) {
  try {
    run();
    console.log(`ok  ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('on-rim swaps cost $15 per tire', () => {
  assert.strictEqual(services.selectionPrice({ id: 'on-rim-swap', quantity: 4 }), 60);
});

test('off-rim size bands use the confirmed per-tire pricing', () => {
  assert.strictEqual(services.selectionPrice({ id: 'off-rim-swap', quantity: 4, sizeBand: '14-16' }), 65);
  assert.strictEqual(services.selectionPrice({ id: 'off-rim-swap', quantity: 4, sizeBand: '17-19' }), 75);
  assert.strictEqual(services.selectionPrice({ id: 'off-rim-swap', quantity: 4, sizeBand: '20-22' }), 85);
  assert.strictEqual(services.selectionPrice({ id: 'off-rim-swap', quantity: 4, sizeBand: '23-24' }), 100);
});

test('linked tire sizes map to off-rim pricing bands', () => {
  assert.strictEqual(services.sizeBandFromTireSize('195/65R15'), '14-16');
  assert.strictEqual(services.sizeBandFromTireSize('225/45ZR18'), '17-19');
  assert.strictEqual(services.sizeBandFromTireSize('275/55R20 117T'), '20-22');
  assert.strictEqual(services.sizeBandFromTireSize('35X12.50R24'), '23-24');
  assert.strictEqual(services.sizeBandFromTireSize('2055516'), '14-16');
  assert.strictEqual(services.sizeBandFromTireSize('unknown'), '');
  assert.strictEqual(
    services.deriveOffRimSizeBandFromSizes(['205/55R16', '215/60R16']),
    '14-16',
  );
  assert.strictEqual(
    services.deriveOffRimSizeBandFromSizes(['205/55R16', '225/45R17']),
    '',
  );
  assert.strictEqual(
    services.deriveOffRimSizeBandFromSizes(['205/55R16', 'unknown']),
    '',
  );
});

test('multiple selected services produce one combined payment total', () => {
  const result = services.calculateSelections([
    { id: 'off-rim-swap', quantity: 2, sizeBand: '20-22' },
    { id: 'balancing', quantity: 4 },
    { id: 'flat-patch-plug', quantity: 1 },
    { id: 'air-fill' },
  ]);
  assert.strictEqual(result.serviceSubtotal, 172.5);
  assert.strictEqual(result.hstAmount, 22.43);
  assert.strictEqual(result.totalWithHst, 194.93);
  assert.strictEqual(result.depositAmount, 38.99);
  assert.strictEqual(result.remainingBalance, 155.94);
  assert.strictEqual(result.quoteRequests.length, 0);
});

test('air fill-up and tire retorque are fixed $20 services', () => {
  assert.strictEqual(services.selectionPrice({ id: 'air-fill' }), 20);
  assert.strictEqual(services.selectionPrice({ id: 'tire-replacement' }), 20);
  assert.strictEqual(services.SERVICES['tire-replacement'].name, 'Tire retorque');
});

test('conflicting choices in one category cannot both be priced', () => {
  const result = services.calculateSelections([
    { id: 'on-rim-swap', quantity: 4 },
    { id: 'off-rim-swap', quantity: 4, sizeBand: '23-24' },
    { id: 'flat-patch-plug', quantity: 1 },
    { id: 'flat-plug-only', quantity: 1 },
  ]);
  assert.deepStrictEqual(result.selections.map((selection) => selection.id), [
    'on-rim-swap',
    'flat-patch-plug',
  ]);
  assert.strictEqual(result.serviceSubtotal, 110);
});

test('server resolution recalculates submitted prices from selections', () => {
  const result = services.resolveService({
    serviceId: 'multi-service-v1',
    serviceSubtotal: 0.01,
    serviceSelections: [
      { id: 'on-rim-swap', quantity: 4 },
      { id: 'balancing', quantity: 4 },
    ],
  });
  assert.strictEqual(result.serviceSubtotal, 120);
  assert.strictEqual(result.depositAmount, 27.12);
});

test('server rejects incomplete or conflicting multi-service payloads', () => {
  assert.strictEqual(services.resolveService({
    serviceSelections: [
      { id: 'off-rim-swap', quantity: 2 },
      { id: 'air-fill' },
    ],
  }), null);
  assert.strictEqual(services.resolveService({
    serviceSelections: [
      { id: 'on-rim-swap', quantity: 4 },
      { id: 'off-rim-swap', quantity: 4, sizeBand: '20-22' },
    ],
  }), null);
  assert.strictEqual(services.resolveService({
    serviceSelections: [{ id: 'balancing', quantity: 0 }],
  }), null);
});

console.log('\nAll appointment service tests passed.');
