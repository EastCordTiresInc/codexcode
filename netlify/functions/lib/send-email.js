const https = require('https');

const CONTACT_EMAIL = 'info@eastcordtires.ca';

function getEmailConfig() {
  return {
    provider: process.env.EMAIL_PROVIDER || 'resend',
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMAIL_FROM || `EastCord Tires <${CONTACT_EMAIL}>`,
    replyTo: process.env.EMAIL_REPLY_TO || CONTACT_EMAIL,
    eastcordTo: process.env.EMAIL_TO_EASTCORD || CONTACT_EMAIL,
  };
}

function postJsonWithHttps({ hostname, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify(body);
    const request = https.request({
      hostname,
      path,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        let parsed = {};
        try {
          parsed = responseBody ? JSON.parse(responseBody) : {};
        } catch (error) {
          parsed = { raw: responseBody, parseError: error.message };
        }
        resolve({ statusCode: response.statusCode || 0, body: parsed });
      });
    });

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}

async function sendEmail(email) {
  const config = getEmailConfig();
  const provider = String(config.provider || '').toLowerCase();

  if (provider !== 'resend') {
    return { ok: false, skipped: true, reason: 'unsupported_email_provider' };
  }
  if (!config.apiKey) {
    return { ok: false, skipped: true, reason: 'missing_resend_api_key' };
  }
  if (!email.to) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }

  const response = await postJsonWithHttps({
    hostname: 'api.resend.com',
    path: '/emails',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: {
      from: config.from,
      to: email.to,
      reply_to: email.replyTo || config.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    console.error('[EastCord email] Send failed.', {
      to: email.to,
      subject: email.subject,
      status: response.statusCode,
    });
    return { ok: false, skipped: false, reason: 'send_failed', status: response.statusCode };
  }

  return { ok: true, skipped: false, to: email.to };
}

module.exports = {
  CONTACT_EMAIL,
  getEmailConfig,
  sendEmail,
};
