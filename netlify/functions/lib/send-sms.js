const https = require('https');

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function toE164(value) {
  const number = digits(value);
  if (number.length === 10) return `+1${number}`;
  if (number.length === 11 && number.startsWith('1')) return `+${number}`;
  return '';
}

function smsConfig() {
  return {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || '').trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || '').trim(),
    from: toE164(process.env.TWILIO_FROM_NUMBER || ''),
  };
}

function postForm(options) {
  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch (error) {
          body = { message: raw.slice(0, 180) };
        }
        resolve({ statusCode: response.statusCode || 0, body });
      });
    });
    request.on('error', reject);
    request.write(options.payload || '');
    request.end();
  });
}

async function sendSms({ to, body }) {
  const config = smsConfig();
  const destination = toE164(to);
  const message = String(body || '').trim();
  if (!config.accountSid || !config.authToken || !config.from) {
    return { ok: false, skipped: true, reason: 'missing_sms_config' };
  }
  if (!destination) return { ok: false, skipped: true, reason: 'invalid_phone' };
  if (!message) return { ok: false, skipped: true, reason: 'empty_message' };

  const payload = new URLSearchParams({
    To: destination,
    From: config.from,
    Body: message.slice(0, 1000),
  }).toString();
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
  let response;
  try {
    response = await postForm({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
      payload,
    });
  } catch (error) {
    console.error('[EastCord sms] Text request failed.', error.message || error);
    return { ok: false, reason: 'request_failed' };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    console.error('[EastCord sms] Text was not sent.', {
      status: response.statusCode,
      code: response.body?.code || '',
      to: destination.slice(-4),
    });
    return { ok: false, reason: 'provider_rejected' };
  }

  console.info('[EastCord sms] Text sent.', { to: destination.slice(-4) });
  return { ok: true, to: destination };
}

module.exports = { sendSms, toE164 };
