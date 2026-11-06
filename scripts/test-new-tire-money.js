#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const money = require('../new-tire-money');
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

function assertCardAddsUp(card) {
  assert.strictEqual(money.roundMoney(card.tireAmount + card.ecoFee + card.taxes), card.total);
  assert.strictEqual(card.taxes, money.roundMoney((card.tireAmount + card.ecoFee) * 0.13));
  assert.strictEqual(money.roundMoney(card.unit * card.qty), card.tireAmount);
}

test('the page uses the shared tire-card math', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'new-tires.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'new-tires.js'), 'utf8');
  const start = source.indexOf('function selectedTireMoney');
  const end = source.indexOf('function selectedTireFactsHtml');
  const fn = source.slice(start, end);
  assert.ok(html.indexOf('new-tire-money.js') !== -1 && html.indexOf('new-tire-money.js') < html.indexOf('new-tires.js'));
  assert.match(fn, /EastCordNewTireMoney/);
  assert.match(fn, /selectedTireCardMoney/);
  assert.doesNotMatch(fn, /stored\s*\*\s*qty|unit\s*\*\s*qty/);
});

test('Firestone set is not charged twice', () => {
  const card = money.selectedTireCardMoney({
    qty: 2,
    storedPrice: 475.80,
    scrapedEco: 6,
    targetWithTax: 551.21,
  });
  assert.strictEqual(card.unit, 237.90);
  assert.strictEqual(card.tireAmount, 475.80);
  assert.strictEqual(card.ecoFee, 12);
  assert.strictEqual(card.taxes, 63.41);
  assert.strictEqual(card.total, 551.21);
  assert.notStrictEqual(card.total, 1082.09);
  assertCardAddsUp(card);
});

test('a per-tire label that repeats the set price is not multiplied', () => {
  const card = money.selectedTireCardMoney({
    qty: 2,
    storedPrice: 475.80,
    perTire: 475.80,
    tireTotal: 475.80,
    scrapedEco: 6,
    targetWithTax: 551.21,
  });
  assert.strictEqual(card.tireAmount, 475.80);
  assert.strictEqual(card.unit, 237.90);
  assert.strictEqual(card.ecoFee, 12);
  assert.strictEqual(card.total, 551.21);
  assertCardAddsUp(card);
});

test('an off-rim unit price scraped as per tire is ignored', () => {
  const card = money.selectedTireCardMoney({
    qty: 2,
    storedPrice: 475.80,
    perTire: 18.75,
    scrapedEco: 6,
    targetWithTax: 551.21,
  });
  assert.strictEqual(card.tireAmount, 475.80);
  assert.strictEqual(card.total, 551.21);
  assert.ok(!money.OFF_RIM_UNIT_PRICES.includes(card.unit));
  assertCardAddsUp(card);
});

test('a real per-tire price is multiplied once', () => {
  const tireAmount = money.roundMoney(81.90 * 4);
  const ecoFee = money.roundMoney(6 * 4);
  const target = money.roundMoney((tireAmount + ecoFee) * 1.13);
  const card = money.selectedTireCardMoney({
    qty: 4,
    storedPrice: 81.90,
    perTire: 81.90,
    tireTotal: tireAmount,
    scrapedEco: 6,
    targetWithTax: target,
  });
  assert.strictEqual(card.unit, 81.90);
  assert.strictEqual(card.tireAmount, 327.60);
  assert.strictEqual(card.ecoFee, 24);
  assert.strictEqual(card.total, target);
  assertCardAddsUp(card);
});

test('an eco fee that is already extended is not multiplied again', () => {
  const card = money.selectedTireCardMoney({
    qty: 2,
    storedPrice: 475.80,
    tireTotal: 475.80,
    scrapedEco: 12,
    targetWithTax: 551.21,
  });
  assert.strictEqual(card.ecoFee, 12);
  assert.strictEqual(card.total, 551.21);
  assertCardAddsUp(card);
});

test('one tire uses the single price and one eco fee', () => {
  const card = money.selectedTireCardMoney({
    qty: 1,
    storedPrice: 200,
    perTire: 200,
    scrapedEco: 6,
    targetWithTax: money.roundMoney(206 * 1.13),
  });
  assert.strictEqual(card.unit, 200);
  assert.strictEqual(card.tireAmount, 200);
  assert.strictEqual(card.ecoFee, 6);
  assert.strictEqual(card.taxes, 26.78);
  assert.strictEqual(card.total, 232.78);
  assertCardAddsUp(card);
});

test('off-rim swap stays out of the tire tax', () => {
  const card = money.selectedTireCardMoney({
    qty: 2,
    storedPrice: 475.80,
    scrapedEco: 6,
    targetWithTax: 551.21,
  });
  const install = services.calculateSelections([{ id: 'off-rim-swap', quantity: 2, sizeBand: '17-19' }]);
  assert.strictEqual(services.sizeBandFromTireSize('255/45R18'), '17-19');
  assert.strictEqual(install.serviceSubtotal, 37.50);
  assert.strictEqual(install.hstAmount, 4.88);
  assert.strictEqual(install.totalWithHst, 42.38);
  assert.strictEqual(card.taxes, 63.41);
  assert.strictEqual(money.roundMoney(card.total + install.totalWithHst), 593.59);
  assert.notStrictEqual(card.total, 593.59);
  assertCardAddsUp(card);
});

test('without a price summary, a labeled tire total is not multiplied', () => {
  const card = money.selectedTireCardMoney({
    qty: 2,
    storedPrice: 475.80,
    tireTotal: 475.80,
    scrapedEco: 6,
  });
  assert.strictEqual(card.tireAmount, 475.80);
  assert.notStrictEqual(card.tireAmount, 951.60);
  assertCardAddsUp(card);
});
