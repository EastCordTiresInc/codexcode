#!/usr/bin/env node
const assert = require('assert');
const { chromium } = require('playwright');

const SITE = process.env.PASSWORD_RECOVERY_TEST_URL || 'http://localhost:8888';

async function createContext(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.__passwordRecoveryCalls = [];
      window.supabase = {
        createClient() {
          const recoverySession = location.pathname.includes('reset-password')
            && (location.search.includes('code=') || location.hash.includes('type=recovery'));
          return {
            auth: {
              async resetPasswordForEmail(email, options) {
                window.__passwordRecoveryCalls.push({ method: 'resetPasswordForEmail', email, options });
                return { data: {}, error: null };
              },
              async getSession() {
                return {
                  data: {
                    session: recoverySession ? { user: { id: 'recovery-user' } } : null
                  },
                  error: null
                };
              },
              async getUser() {
                return { data: { user: null }, error: null };
              },
              async updateUser(values) {
                window.__passwordRecoveryCalls.push({ method: 'updateUser', values });
                return { data: { user: { id: 'recovery-user' } }, error: null };
              },
              async signOut(options) {
                window.__passwordRecoveryCalls.push({ method: 'signOut', options });
                return { error: null };
              },
              onAuthStateChange() {
                return { data: { subscription: { unsubscribe() {} } } };
              }
            }
          };
        }
      };
    `,
  }));
  return context;
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await createContext(browser);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${SITE}/login.html?redirect=%2Fappointment.html`, { waitUntil: 'networkidle' });
    const forgotLink = page.locator('.forgot-password-link');
    await forgotLink.waitFor({ state: 'visible' });
    assert.ok(await forgotLink.isVisible());
    assert.match(await forgotLink.getAttribute('href'), /forgot-password(?:\.html)?\?redirect=%2Fappointment\.html/);
    assert.ok(await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )) <= 1);

    await forgotLink.click();
    await page.locator('[data-forgot-password-form] input[name="Email"]').fill('customer@example.com');
    await page.locator('[data-forgot-password-form] button[type="submit"]').click();
    await page.waitForFunction(() => /If an EastCord account exists/i.test(
      document.querySelector('[data-auth-message]')?.textContent || '',
    ));
    const resetRequest = await page.evaluate(() => window.__passwordRecoveryCalls[0]);
    assert.strictEqual(resetRequest.method, 'resetPasswordForEmail');
    assert.strictEqual(resetRequest.email, 'customer@example.com');
    assert.match(resetRequest.options.redirectTo, /\/reset-password\.html\?redirect=%2Fappointment\.html$/);

    await page.goto(`${SITE}/reset-password.html?redirect=%2Fappointment.html`, { waitUntil: 'networkidle' });
    assert.strictEqual(await page.locator('[data-reset-password-form]').isHidden(), true);
    assert.match(await page.locator('[data-auth-message]').innerText(), /missing or has expired/i);

    await context.close();

    const recoveryContext = await createContext(browser);
    const recoveryPage = await recoveryContext.newPage();
    recoveryPage.on('pageerror', (error) => errors.push(error.message));
    await recoveryPage.goto(
      `${SITE}/reset-password.html?code=recovery-test&redirect=%2Fappointment.html`,
      { waitUntil: 'networkidle' },
    );
    const resetForm = recoveryPage.locator('[data-reset-password-form]');
    await resetForm.waitFor({ state: 'visible' });
    assert.match(await recoveryPage.locator('[data-auth-message]').innerText(), /Reset link verified/i);
    assert.doesNotMatch(recoveryPage.url(), /code=/);

    await resetForm.locator('input[name="Password"]').fill('NewPassword123!');
    await resetForm.locator('input[name="Confirm Password"]').fill('DifferentPassword123!');
    await resetForm.locator('button[type="submit"]').click();
    assert.match(await recoveryPage.locator('[data-auth-message]').innerText(), /Passwords do not match/i);

    await resetForm.locator('input[name="Confirm Password"]').fill('NewPassword123!');
    await resetForm.locator('button[type="submit"]').click();
    await recoveryPage.waitForFunction(() => /Password updated/i.test(
      document.querySelector('[data-auth-message]')?.textContent || '',
    ));
    const recoveryCalls = await recoveryPage.evaluate(() => window.__passwordRecoveryCalls);
    assert.deepStrictEqual(recoveryCalls.find((call) => call.method === 'updateUser')?.values, {
      password: 'NewPassword123!',
    });
    assert.deepStrictEqual(recoveryCalls.find((call) => call.method === 'signOut')?.options, {
      scope: 'global',
    });
    assert.match(
      await recoveryPage.locator('[data-auth-message] a').getAttribute('href'),
      /login(?:\.html)?\?redirect=%2Fappointment\.html/,
    );
    assert.ok(await recoveryPage.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )) <= 1);
    assert.deepStrictEqual(errors, []);

    await recoveryContext.close();
    console.log('ok  login preserves the checkout destination in the forgot-password link');
    console.log('ok  reset requests use a secure Supabase recovery redirect');
    console.log('ok  unknown emails receive a non-enumerating confirmation message');
    console.log('ok  missing recovery links cannot display the password form');
    console.log('ok  mismatched passwords are rejected');
    console.log('ok  valid recovery updates the password and signs out all sessions');
    console.log('ok  mobile recovery pages have no horizontal overflow');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error('FAIL password recovery:', error);
  process.exit(1);
});
