#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const {
  SITE_ORIGIN,
  ACCOUNT_URL,
  APPOINTMENT_URL,
  RESET_PASSWORD_URL,
  WARRANTY_URL,
  htmlFromText,
  buildAuthEmail,
} = require('../netlify/functions/lib/send-email');
const { buildUsedTireReceipt } = require('../netlify/functions/lib/used-tire-receipt');

function decodeHref(value) {
  return String(value || '').replace(/&amp;/g, '&');
}

function extractUrls(html) {
  const hrefs = [...String(html).matchAll(/href="([^"]+)"/g)].map((match) => decodeHref(match[1]));
  const plains = [...String(html).matchAll(/https:\/\/[^\s<"]+/g)].map((match) => decodeHref(match[0]));
  return [...new Set([...hrefs, ...plains])].filter((url) => url.startsWith('http'));
}

function head(url) {
  const result = spawnSync('curl.exe', ['-I', '-sS', '-L', '--max-redirs', '5', '-o', 'NUL', '-w', '%{http_code}', url], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `curl failed for ${url}`);
  }
  return { status: Number(result.stdout.trim() || 0), location: '' };
}

(async () => {
  for (const url of [SITE_ORIGIN, ACCOUNT_URL, APPOINTMENT_URL, RESET_PASSWORD_URL, WARRANTY_URL]) {
    assert.ok(url.startsWith('https://eastcordtires.ca'), `Expected production URL, got ${url}`);
    assert.doesNotMatch(url, /localhost|127\.0\.0\.1/i);
  }

  const bookingUrl = `${APPOINTMENT_URL}?source=new-tires&newTireOrder=11111111-1111-1111-1111-111111111111#appointment-booking`;
  const linked = htmlFromText([
    'Book installation:',
    bookingUrl,
    `Account: ${ACCOUNT_URL}`,
    `Reset: ${RESET_PASSWORD_URL}`,
    `Warranty: ${WARRANTY_URL}`,
  ].join('\n'));
  assert.match(linked, /<a href="/);
  assert.doesNotMatch(linked, /localhost|127\.0\.0\.1/i);

  const confirmEmail = buildAuthEmail({
    to: 'test@example.com',
    subject: 'Confirm your signup',
    heading: 'Confirm your signup',
    body: 'Follow this link to confirm your user:',
    actionUrl: 'https://pvivlobtolcdggzefpxo.supabase.co/auth/v1/verify?token=example&type=signup&redirect_to=https%3A%2F%2Feastcordtires.ca%2Faccount.html',
    actionLabel: 'Confirm your mail',
  });
  const visibleConfirmText = confirmEmail.html.replace(/<a\b[^>]*>/gi, '<a>').replace(/<[^>]+>/g, ' ');
  assert.match(confirmEmail.html, /Confirm your mail/);
  assert.match(confirmEmail.html, /eastcord-logo-email\.png/);
  assert.doesNotMatch(confirmEmail.html, /background:#ba151b/);
  assert.doesNotMatch(visibleConfirmText, /supabase\.co|token=/i);
  assert.doesNotMatch(confirmEmail.html, /paste this link/i);
  assert.doesNotMatch(confirmEmail.text, /supabase\.co|token=/i);

  const receipt = buildUsedTireReceipt({
    customer: { name: 'Test Customer', email: 'test@example.com' },
    items: [{ brand: 'Michelin', size: '225/45R17', qty: 2, unitPrice: 80 }],
  });
  assert.match(receipt.html, /View your account/);
  assert.match(receipt.html, /Used Tire Warranty Policy/);
  assert.doesNotMatch(`${receipt.text}\n${receipt.html}`, /localhost|127\.0\.0\.1/i);

  const emailFiles = [
    'netlify/functions/send-signup-confirmation.js',
    'netlify/functions/send-password-reset.js',
    'netlify/functions/lib/send-email.js',
    'netlify/functions/lib/new-tire-order.js',
    'netlify/functions/lib/used-tire-receipt.js',
    'netlify/functions/lib/used-tire-order.js',
    'netlify/functions/request-new-tire-order.js',
    'netlify/functions/request-used-tire-reservation.js',
    'netlify/functions/stripe-webhook.js',
  ];
  for (const file of emailFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /href=["']https?:\/\/localhost/i, `${file} still has a localhost href`);
    assert.doesNotMatch(source, /https?:\/\/localhost:\d+\/(?:account|reset-password|appointment)/i, `${file} still emails a localhost page`);
  }

  const urls = [
    SITE_ORIGIN,
    ACCOUNT_URL,
    `${SITE_ORIGIN}/account`,
    APPOINTMENT_URL,
    `${SITE_ORIGIN}/appointment`,
    bookingUrl.split('#')[0],
    RESET_PASSWORD_URL,
    `${SITE_ORIGIN}/reset-password`,
    `${SITE_ORIGIN}/forgot-password.html`,
    WARRANTY_URL,
    ...extractUrls(linked),
    ...extractUrls(receipt.html),
  ].filter((url, index, list) => list.indexOf(url) === index);

  for (const url of urls) {
    if (!url.startsWith('https://eastcordtires.ca')) continue;
    const result = await head(url);
    const ok = result.status >= 200 && result.status < 400;
    assert.ok(ok, `${url} returned ${result.status}`);
    console.log(`OK ${result.status} ${url}`);
  }

  console.log('Email link checks passed.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
