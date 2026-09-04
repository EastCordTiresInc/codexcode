#!/usr/bin/env node
const assert = require('assert');
const { chromium } = require('playwright');

const ORIGIN = 'https://eastcordtires.ca';

function watchPage(page) {
  const issues = [];
  page.on('pageerror', (error) => issues.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error'
      && !/Failed to load resource: the server responded with a status of 404|Permissions policy violation: compute-pressure/i.test(message.text())
    ) issues.push(message.text());
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === ORIGIN && response.status() >= 400) {
      issues.push(`${response.status()} ${url.pathname}`);
    }
  });
  return issues;
}

async function assertLayout(page, label) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ));
  assert.ok(overflow <= 1, `${label} has ${overflow}px horizontal overflow.`);
  const brokenVisibleImages = await page.locator('#tireconnect img:visible').evaluateAll((images) => (
    images.filter((image) => image.complete && image.naturalWidth === 0 && !image.src.startsWith('data:')).length
  ));
  assert.strictEqual(brokenVisibleImages, 0, `${label} has broken visible tire images.`);
}

async function openSearch(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const issues = watchPage(page);
  await page.goto(`${ORIGIN}/new-tires.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('#tireconnect select').first().waitFor({ timeout: 30000 });
  return { page, issues };
}

async function choose(page, name, label) {
  const select = page.locator(`select[name="${name}"]`);
  await select.waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForFunction(({ name: selectName, label: optionLabel }) => (
    [...document.querySelector(`select[name="${selectName}"]`)?.options || []]
      .some((option) => option.text.trim() === optionLabel)
  ), { name, label }, { timeout: 20000 });
  await select.selectOption({ label });
  await page.waitForTimeout(500);
}

async function waitForResults(page, expectedSize) {
  await page.waitForURL(/#!tires\/results/i, { timeout: 30000 });
  await page.waitForFunction((size) => {
    const text = document.querySelector('#tireconnect')?.innerText || '';
    return new RegExp(`FOUND\\s+\\d+\\s+TIRES\\s+FOR:[\\s\\S]*${size}`, 'i').test(text)
      && /ADD TO CART/i.test(text);
  }, expectedSize, { timeout: 45000 });
  const text = await page.locator('#tireconnect').innerText();
  const count = Number(text.match(/FOUND\s+(\d+)\s+TIRES\s+FOR/i)?.[1] || 0);
  assert.ok(count > 0, `${expectedSize} returned no tires.`);
  await page.waitForTimeout(2500);
  assert.strictEqual(await page.locator('[data-new-tire-selected]').evaluate((element) => element.hidden), true);
  return count;
}

async function searchBySize(browser, testCase) {
  const { page, issues } = await openSearch(browser, testCase.viewport);
  const findButton = page.locator('button').filter({ hasText: /Find your tires now/i });
  await choose(page, 'width_0', testCase.width);
  assert.strictEqual(await findButton.isEnabled(), false, 'Incomplete size search should remain disabled.');
  await choose(page, 'height_0', testCase.height);
  await choose(page, 'rim_0', `${testCase.rim}''`);
  await choose(page, 'season', testCase.season);
  assert.strictEqual(await findButton.isEnabled(), true);
  await findButton.click();
  const count = await waitForResults(page, `${testCase.width}/${testCase.height}R${testCase.rim}`);
  await assertLayout(page, `${testCase.width}/${testCase.height}R${testCase.rim} ${testCase.viewport.width}px`);
  assert.deepStrictEqual(issues, []);
  return { page, count };
}

async function searchByVehicle(browser) {
  const { page, issues } = await openSearch(browser, { width: 390, height: 844 });
  await page.locator('#tireconnect select').first().selectOption('vehicle');
  await choose(page, 'year', '2020');
  await choose(page, 'make', 'Toyota');
  await choose(page, 'model', 'Corolla');
  await choose(page, 'submodel', 'LE');
  const button = page.locator('button').filter({ hasText: /Find your tires now/i });
  await page.waitForFunction(() => (
    ![...document.querySelectorAll('button')]
      .find((element) => /Find your tires now/i.test(element.innerText || ''))?.disabled
  ), null, { timeout: 10000 });
  assert.strictEqual(await button.isEnabled(), true);
  await button.click();
  await page.waitForURL(/#!tires\/results/i, { timeout: 30000 });
  await page.waitForFunction(() => /ADD TO CART/i.test(document.querySelector('#tireconnect')?.innerText || ''), null, {
    timeout: 45000,
  });
  const text = await page.locator('#tireconnect').innerText();
  assert.match(text, /2020\s+TOYOTA\s+COROLLA\s+LE/i);
  await assertLayout(page, '2020 Toyota Corolla LE vehicle search');
  assert.deepStrictEqual(issues, []);
  await page.close();
}

async function searchStaggeredSizes(browser) {
  const { page, issues } = await openSearch(browser, { width: 1280, height: 900 });
  await page.locator('#tireconnect').getByText(/Add different rear size/i).click();
  await choose(page, 'width_0', '225');
  await choose(page, 'height_0', '45');
  await choose(page, 'rim_0', "18''");
  await choose(page, 'width_1', '255');
  await choose(page, 'height_1', '40');
  await choose(page, 'rim_1', "18''");
  await choose(page, 'season', 'All Tires');
  const button = page.locator('button').filter({ hasText: /Find your tires now/i });
  assert.strictEqual(await button.isEnabled(), true);
  await button.click();
  await page.waitForURL(/#!tires\/results/i, { timeout: 30000 });
  await page.waitForFunction(() => /ADD TO CART/i.test(document.querySelector('#tireconnect')?.innerText || ''), null, {
    timeout: 45000,
  });
  const text = await page.locator('#tireconnect').innerText();
  assert.match(text, /225\/45R18/i);
  assert.match(text, /255\/40R18/i);
  await assertLayout(page, '225/45R18 + 255/40R18 staggered-size search');
  assert.deepStrictEqual(issues, []);
  await page.close();
}

async function verifySummary(page) {
  const model = page.getByText('MR-182', { exact: true }).last();
  await model.waitFor({ state: 'visible' });
  await model.evaluate((element) => {
    let card = element;
    while (card && card.id !== 'tireconnect') {
      const text = String(card.innerText || '').replace(/\s+/g, ' ');
      const addButton = [...card.querySelectorAll('button')]
        .some((button) => /ADD TO CART/i.test(button.innerText || ''));
      if (addButton && text.includes('PER TIRE') && text.length < 1200) {
        card.setAttribute('data-test-mirage-card', 'true');
        return;
      }
      card = card.parentElement;
    }
    throw new Error('Mirage MR-182 result card was not found.');
  });
  await page.locator('[data-test-mirage-card="true"]').getByRole('button', { name: /ADD TO CART/i }).click();
  await page.waitForURL(/summary/i, { timeout: 30000 });
  await page.waitForTimeout(4000);

  const selected = page.locator('[data-new-tire-selected]');
  assert.ok(await selected.isVisible());
  assert.match(await selected.innerText(), /Mirage/i);
  assert.match(await selected.innerText(), /MR-182/i);
  assert.doesNotMatch(await selected.innerText(), /Price Range|ASYMMETRICAL|NON-DIRECTIONAL|TIRES FOR 20/i);

  const quantity = page.locator('#tireconnect select').filter({
    has: page.locator('option[value="2"]'),
  }).last();
  await quantity.selectOption('2');
  await page.waitForFunction(() => /Quantity\s*2/i.test(
    document.querySelector('[data-new-tire-selected]')?.innerText || '',
  ), null, { timeout: 10000 });
  await page.locator('[data-eastcord-eco-fee-summary]').waitFor({ state: 'visible', timeout: 10000 });
  assert.strictEqual(await page.locator('[data-eastcord-eco-fee-hidden="true"]').count(), 1);
}

async function verifyUsedTires(browser) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    const issues = watchPage(page);
    const response = await page.goto(`${ORIGIN}/used-tires.html`, { waitUntil: 'networkidle', timeout: 60000 });
    assert.ok(response?.ok());
    assert.match(await page.locator('main').innerText(), /Used tire shopping is not available yet/i);
    await assertLayout(page, `used tires coming-soon page ${viewport.width}px`);
    assert.deepStrictEqual(issues, []);
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const cases = [
      { width: '225', height: '45', rim: '18', season: 'All Tires', viewport: { width: 1280, height: 900 } },
      { width: '195', height: '65', rim: '15', season: 'All Season', viewport: { width: 390, height: 844 } },
      { width: '205', height: '55', rim: '16', season: 'Winter', viewport: { width: 1280, height: 900 } },
      { width: '275', height: '55', rim: '20', season: 'All Tires', viewport: { width: 390, height: 844 } },
      { width: '215', height: '60', rim: '16', season: 'All Weather', viewport: { width: 1280, height: 900 } },
      { width: '245', height: '40', rim: '19', season: 'Summer', viewport: { width: 390, height: 844 } },
    ];

    for (const testCase of cases) {
      const { page, count } = await searchBySize(browser, testCase);
      console.log(`ok  ${testCase.width}/${testCase.height}R${testCase.rim} ${testCase.season}: ${count} live results`);
      if (testCase.width === '225') await verifySummary(page);
      await page.close();
    }
    await searchByVehicle(browser);
    await searchStaggeredSizes(browser);
    await verifyUsedTires(browser);

    console.log('ok  actual result selection shows correct model, quantity, and eco fee');
    console.log('ok  2020 Toyota Corolla LE vehicle search returns tires');
    console.log('ok  staggered front/rear tire-size search returns both sizes');
    console.log('ok  mobile and desktop searches have no overflow or broken visible images');
    console.log('ok  used-tire page correctly remains in coming-soon state');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('FAIL production tire searches:', error);
  process.exit(1);
});
