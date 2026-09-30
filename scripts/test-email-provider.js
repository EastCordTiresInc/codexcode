#!/usr/bin/env node
const assert = require('assert');
const { resolveEmailProvider, missingEmailConfigReason } = require('../netlify/functions/lib/send-email');

function test(name, run) {
  try {
    run();
    console.log(`ok  ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('explicit EMAIL_PROVIDER wins', () => {
  assert.strictEqual(resolveEmailProvider({ EMAIL_PROVIDER: 'resend', POSTMARK_SERVER_TOKEN: 'pm-token' }), 'resend');
  assert.strictEqual(resolveEmailProvider({ EMAIL_PROVIDER: 'postmark' }), 'postmark');
});

test('Postmark token selects Postmark when provider is unset', () => {
  assert.strictEqual(resolveEmailProvider({ POSTMARK_SERVER_TOKEN: 'pm-token' }), 'postmark');
});

test('Resend remains the default without a Postmark token', () => {
  assert.strictEqual(resolveEmailProvider({}), 'resend');
  assert.strictEqual(resolveEmailProvider({ RESEND_API_KEY: 're_test' }), 'resend');
});

test('missing-config reason follows the selected provider', () => {
  assert.strictEqual(missingEmailConfigReason({ provider: 'postmark' }), 'missing_postmark_server_token');
  assert.strictEqual(missingEmailConfigReason({ provider: 'resend' }), 'missing_resend_api_key');
});

console.log('All email provider tests passed.');
