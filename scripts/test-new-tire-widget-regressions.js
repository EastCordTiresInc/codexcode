const assert = require('assert');
const { chromium } = require('playwright');

const SITE = process.env.SITE_URL || 'http://localhost:8888/new-tires.html';

async function waitForText(locator, pattern, message) {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  await assert.doesNotReject(
    () => locator.page().waitForFunction(
      ({ selector, source, flags }) => new RegExp(source, flags).test(document.querySelector(selector)?.innerText || ''),
      { selector: '[data-new-tire-selected]', source: pattern.source, flags: pattern.flags },
      { timeout: 10000 },
    ),
    message,
  );
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const failures = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const responseUrl = new URL(response.url());
      if (responseUrl.origin === new URL(SITE).origin) errors.push(`${response.status()} ${response.url()}`);
    });
    page.on('console', (message) => {
      if (
        message.type() === 'error'
        && !/favicon|ERR_ABORTED|Failed to load resource: the server responded with a status of 404/i.test(message.text())
      ) errors.push(message.text());
    });

    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const trigger = (name, payload) => {
        (window.TCWidget?.eventHandlers?.[name] || []).forEach((handler) => handler(payload));
      };
      trigger('onTireSearchResults', {
        tires: [{
          brand: 'Ovation',
          model: 'ECOVISION VI-682',
          size: '195/65R15',
          quantity: 4,
          price: 81.90,
          partNumber: 'OV1956515',
        }],
      });
      trigger('onTireSelect', {
        tire: {
          brand: 'Ovation',
          model: 'ECOVISION VI-682',
          size: '195/65R15',
          quantity: 4,
          price: 81.90,
          partNumber: 'OV1956515',
        },
      });
    });

    const selected = page.locator('[data-new-tire-selected]');
    await waitForText(selected, /ECOVISION VI-682/, 'selected tire model did not render');
    assert.doesNotMatch(await selected.innerText(), /Price Range|ASYMMETRICAL|NON-DIRECTIONAL|2009 MAZDA/i);

    await page.evaluate(() => {
      (window.TCWidget?.eventHandlers?.onTireQuantityChanged || [])
        .forEach((handler) => handler({ quantity: 2 }));
    });
    await waitForText(selected, /Quantity\s*2/i, 'selected tire quantity did not update');

    await page.evaluate(() => {
      (window.TCWidget?.eventHandlers?.onTireSearchResults || [])
        .forEach((handler) => handler({ tires: [] }));
    });
    await page.waitForFunction(() => document.querySelector('[data-new-tire-selected]')?.hidden === true);
    assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('eastcord_new_tire_quote_v1')), null);
    await page.evaluate(() => {
      (window.TCWidget?.eventHandlers?.onTireSelect || [])
        .forEach((handler) => handler({
          tire: {
            brand: 'Ovation',
            model: 'ECOVISION VI-682',
            size: '195/65R15',
            quantity: 2,
            price: 81.90,
            partNumber: 'OV1956515',
          },
        }));
    });
    await waitForText(selected, /ECOVISION VI-682/, 'selected tire did not restore after the search reset test');

    await page.evaluate(() => {
      history.replaceState(null, '', `${location.pathname}#!tires/summary?t_qty=2`);
      document.getElementById('tireconnect').innerHTML = `
        <section>
          <div>
            <h3>SUMMARY</h3>
            <img alt="Ovation Tires" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
            <p>ECOVISION VI-682</p>
            <p>WARRANTY N/A</p>
            <p>CATEGORY All Season</p>
            <p>SIZE 195/65R15</p>
            <label>QTY <select><option selected>2</option></select></label>
            <p>PER TIRE $81.90</p>
            <button type="button">CHANGE TIRE</button>
          </div>
          <div data-test-required>
            <h3>REQUIRED SERVICES</h3>
            <div role="row" data-test-eco-source><span>Tire Eco Fee</span><span>$10.00</span></div>
          </div>
          <div data-test-price-summary>
            <h3>PRICE SUMMARY</h3>
            <div role="row"><span>Subtotal</span><span>$163.80</span></div>
            <div role="row"><span>Total</span><span>$173.80</span></div>
          </div>
        </section>`;
    });

    try {
      const movedFee = page.locator('[data-eastcord-eco-fee-summary]');
      await movedFee.waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await movedFee.innerText(), /Tire Eco Fee\s*\$10\.00/i);
      assert.strictEqual(await page.locator('[data-test-eco-source]').getAttribute('data-eastcord-eco-fee-hidden'), 'true');

      await page.evaluate(() => {
        document.querySelector('[data-test-eco-source] span:last-child').textContent = '$20.00';
      });
      await page.waitForFunction(() => (
        /\$20\.00/.test(document.querySelector('[data-eastcord-eco-fee-summary]')?.innerText || '')
      ));
      console.log('ok  eco fee moves into price summary and updates dynamically');
    } catch (error) {
      failures.push(`eco fee: ${error.message}`);
    }

    try {
      await page.evaluate(() => {
        (window.TCWidget?.eventHandlers?.onPageChanged || [])
          .forEach((handler) => handler({ page: 'search' }));
      });
      await page.waitForFunction(() => document.querySelector('[data-new-tire-selected]')?.hidden === true);
      assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('eastcord_new_tire_quote_v1')), null);
      assert.ok(await page.locator('#eastcord-tire-highlight').evaluate((element) => element.hidden).catch(() => true));
      console.log('ok  returning to search clears stale tire state and highlight');
    } catch (error) {
      failures.push(`stale state: ${error.message}`);
    }
    assert.deepStrictEqual(errors, []);

    console.log('ok  valid tire model remains visible and sidebar/spec labels are rejected');
    console.log('ok  quantity callbacks update the selected tire panel');
    console.log('ok  no browser errors during TireConnect regression scenarios');
    if (failures.length) throw new Error(`TireConnect regression failures:\n- ${failures.join('\n- ')}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
