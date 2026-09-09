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
    await page.addInitScript(() => {
      Object.defineProperty(window, 'EASTCORD_TIRECONNECT_CONFIG', {
        configurable: false,
        get: () => ({ apiKey: 'regression-test-key' }),
        set: () => {},
      });
    });
    await page.route('https://app.tireconnect.ca/js/widget.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.TCWidget = {
          eventHandlers: {},
          on(name, handler) {
            (this.eventHandlers[name] ||= []).push(handler);
          },
          init() {
            return Promise.resolve(this);
          },
          addCustomerInfo() {}
        };
      `,
    }));
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

    try {
      await page.evaluate(() => {
        history.replaceState(null, '', `${location.pathname}#!tires/results?width%3E=225&height%3E=45&rim%3E=18&page=2`);
        document.getElementById('tireconnect').innerHTML = `
          <section data-test-results>
            <button type="button" data-test-filter>Filter results:</button>
            <article>
              <h3>Mirage MR-182</h3>
              <p>225/45R18</p>
              <p>PER TIRE $95.40</p>
              <button type="button">ADD TO CART</button>
            </article>
            <a href="#" data-test-next>Next »</a>
          </section>`;
        (window.TCWidget?.eventHandlers?.onTireSearchResults || [])
          .forEach((handler) => handler({ tires: [] }));
      });
      await page.waitForTimeout(200);
      assert.strictEqual(
        await selected.evaluate((element) => element.hidden),
        true,
        'results markup must not be auto-selected',
      );
      await page.locator('[data-test-filter]').click();
      await page.waitForTimeout(700);
      assert.strictEqual(await selected.evaluate((element) => element.hidden), true, 'filter click selected a tire');
      await page.locator('[data-test-next]').click();
      await page.waitForTimeout(700);
      assert.strictEqual(await selected.evaluate((element) => element.hidden), true, 'pagination click selected a tire');
      assert.strictEqual(await page.evaluate(() => sessionStorage.getItem('eastcord_new_tire_quote_v1')), null);
      console.log('ok  filter and pagination clicks cannot auto-select a result card');
    } catch (error) {
      failures.push(`results controls: ${error.message}`);
    }
    try {
      const summaryScenarios = [
        {
          heading: ['<p>POTENZA SPORT AS</p>'],
          logo: '<img alt="Bridgestone" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-brand="bridgestone-logo" />',
          brand: 'Bridgestone',
          model: 'POTENZA SPORT AS',
          price: '$288.62',
        },
        {
          heading: ['<p>ILINK</p>', '<h4>SNOWGRIPPER I</h4>'],
          logo: '<img alt="Bridgestone" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-brand="bridgestone-logo" />',
          brand: 'iLink',
          model: 'SNOWGRIPPER I',
          price: '$108.68',
        },
        {
          heading: ['<p>MICHELIN</p>', '<h4>X-ICE SNOW</h4>'],
          logo: '<img alt="iLink" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-brand="ilink-logo" />',
          brand: 'Michelin',
          model: 'X-ICE SNOW',
          price: '$241.15',
        },
      ];

      for (const scenario of summaryScenarios) {
        await page.evaluate((data) => {
          history.replaceState(null, '', `${location.pathname}#!tires/summary?t_qty=2`);
          document.getElementById('tireconnect').innerHTML = `
            <section>
              <div>
                <h3>SUMMARY</h3>
                ${data.logo}
                ${data.heading.join('')}
                <p>WARRANTY N/A</p>
                <p>CATEGORY Winter</p>
                <p>SIZE 255/40R18</p>
                <label>QTY <select><option selected>2</option></select></label>
                <p>PER TIRE ${data.price}</p>
                <button type="button">CHANGE TIRE</button>
              </div>
            </section>`;
        }, scenario);

        await page.waitForFunction(
          (expected) => {
            const text = document.querySelector('[data-new-tire-selected]')?.innerText || '';
            return new RegExp(`Brand\\s*${expected}`, 'i').test(text);
          },
          scenario.brand,
          { timeout: 10000 },
        );

        const panel = await selected.innerText();
        assert.match(panel, new RegExp(`Brand\\s*${scenario.brand}`, 'i'), `${scenario.brand} brand row`);
        assert.match(panel, new RegExp(`Model\\s*${scenario.model}`, 'i'), `${scenario.brand} model row`);
        assert.doesNotMatch(panel, /Brand\s*(?:Display|Load Range)/i, `${scenario.brand} label as brand`);
        assert.doesNotMatch(panel, /Model\s*(?:Display|Load Range)/i, `${scenario.brand} label as model`);
        assert.doesNotMatch(
          panel,
          new RegExp(`Brand\\s*${scenario.model}`, 'i'),
          `${scenario.brand} model captured as the brand`,
        );
      }
      console.log('ok  each selected tire shows its own brand and model, not a stale logo brand');
    } catch (error) {
      failures.push(`selected tire brand/model: ${error.message}`);
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
