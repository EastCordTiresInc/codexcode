const https = require('https');

const CONTACT_EMAIL = 'info@eastcordtires.ca';
const SITE_ORIGIN = 'https://eastcordtires.ca';
const ACCOUNT_URL = `${SITE_ORIGIN}/account.html`;
const APPOINTMENT_URL = `${SITE_ORIGIN}/appointment.html`;
const CONFIRM_SIGNUP_URL = `${SITE_ORIGIN}/confirm-signup.html`;
const RESET_PASSWORD_URL = `${SITE_ORIGIN}/reset-password.html`;
const WARRANTY_URL = `${SITE_ORIGIN}/public/docs/eastcord-used-tire-warranty-policy.pdf`;

function buildHashedTokenActionUrl(baseUrl, tokenHash, type) {
  const url = new URL(baseUrl);
  url.searchParams.set('token_hash', String(tokenHash || '').trim());
  url.searchParams.set('type', String(type || '').trim() || 'signup');
  return url.toString();
}

function firstEnv(keys, fallback = '') {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return fallback;
}

function applyEmailEnvFromFile(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return 0;
  let applied = 0;
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
    if (!match) return;
    const key = match[1];
    if (!/^(RESEND_|EMAIL_|POSTMARK_)/.test(key)) return;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, '\n').trim();
    if (!value) return;
    if (!String(process.env[key] || '').trim()) {
      process.env[key] = value;
      applied += 1;
    }
  });
  return applied;
}

function loadLocalEmailEnv() {
  if (loadLocalEmailEnv.done) return;
  loadLocalEmailEnv.done = true;
  if (firstEnv(['RESEND_API_KEY', 'RESEND_API_KEYY']) && firstEnv(['POSTMARK_SERVER_TOKEN'])) return;

  const fs = require('fs');
  const path = require('path');
  const starts = [process.cwd(), __dirname];
  const seen = new Set();
  starts.forEach((start) => {
    let dir = start;
    for (let i = 0; i < 6; i += 1) {
      [
        path.join(dir, '.netlify', '.env'),
        path.join(dir, '.env'),
      ].forEach((file) => {
        const resolved = path.resolve(file);
        if (seen.has(resolved) || !fs.existsSync(resolved)) return;
        seen.add(resolved);
        applyEmailEnvFromFile(resolved);
      });
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  });

  if (!String(process.env.RESEND_API_KEY || '').trim() && process.env.RESEND_API_KEYY) {
    process.env.RESEND_API_KEY = process.env.RESEND_API_KEYY;
  }
}

function resolveEmailProvider(env = process.env) {
  const explicit = String(env.EMAIL_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (String(env.POSTMARK_SERVER_TOKEN || '').trim()) return 'postmark';
  return 'resend';
}

function getEmailConfig() {
  loadLocalEmailEnv();
  const provider = resolveEmailProvider();
  const apiKey = firstEnv(['RESEND_API_KEY', 'RESEND_API_KEYY']);
  const postmarkToken = firstEnv(['POSTMARK_SERVER_TOKEN']);
  return {
    provider,
    apiKey,
    postmarkToken,
    messageStream: firstEnv(['POSTMARK_MESSAGE_STREAM'], 'outbound'),
    from: firstEnv(['EMAIL_FROM', 'EMAIL_FROMM'], `EastCord Tires <${CONTACT_EMAIL}>`),
    replyTo: firstEnv(['EMAIL_REPLY_TO'], CONTACT_EMAIL),
    eastcordTo: firstEnv(['EMAIL_TO_EASTCORD'], CONTACT_EMAIL),
    configured: provider === 'postmark' ? Boolean(postmarkToken) : provider === 'resend' ? Boolean(apiKey) : false,
  };
}

function isEmailConfigured(config = getEmailConfig()) {
  return Boolean(config?.configured);
}

function missingEmailConfigReason(config = getEmailConfig()) {
  return String(config?.provider || '').toLowerCase() === 'postmark'
    ? 'missing_postmark_server_token'
    : 'missing_resend_api_key';
}

function isLocalNetlifyDev() {
  return String(process.env.NETLIFY_DEV || '').toLowerCase() === 'true';
}

async function forwardToProductionFunction(functionName, body) {
  console.warn(`[EastCord auth] Email credentials missing locally; using production ${functionName}.`);
  const response = await postJsonWithHttps({
    hostname: 'eastcordtires.ca',
    path: `/.netlify/functions/${functionName}`,
    headers: {},
    body,
  });
  const payload = response.body && typeof response.body === 'object' && !response.body.parseError
    ? response.body
    : { message: 'Production email service did not respond.' };
  return {
    statusCode: response.statusCode || 502,
    payload,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlFromText(text) {
  const linked = escapeHtml(text).replace(/(https:\/\/[^\s<]+)/g, (match) => {
    const trailing = match.match(/[.,;:!?)]+$/)?.[0] || '';
    const href = trailing ? match.slice(0, -trailing.length) : match;
    return `<a href="${href}">${href}</a>${trailing}`;
  });
  return `<pre style="font: 15px/1.5 sans-serif; white-space: pre-wrap;">${linked}</pre>`;
}

function emailCta(href, label) {
  const safeHref = escapeHtml(href);
  return `<a href="${safeHref}" style="color:#ba151b;font-weight:700;font-size:16px;text-decoration:underline;">${escapeHtml(label)}</a>`;
}

const LOGO_URL = `${SITE_ORIGIN}/assets/eastcord-logo-email.png`;

function buildBrandedEmail({
  to,
  subject,
  heading,
  body,
  actionUrl,
  actionLabel,
  footer,
  extraText = '',
  extraHtml = '',
}) {
  const paragraphs = (Array.isArray(body) ? body : [body]).map((para) => String(para || '').trim()).filter(Boolean);
  const footerText = footer || '';
  const text = [
    'EastCord Tires',
    '',
    heading,
    '',
    ...paragraphs,
    extraText,
    actionUrl && actionLabel ? `${actionLabel}:\n${actionUrl}` : '',
    footerText,
    '',
    'EastCord Tires',
    '600 Harrop Drive, Milton, Ontario',
    'info@eastcordtires.ca · 365-822-5553',
  ].filter((line) => line !== undefined && line !== null).join('\n');

  const bodyHtml = paragraphs.map((para, index) => (
    `<p style="margin:0 0 ${index === paragraphs.length - 1 ? '20' : '12'}px;font-size:15px;line-height:1.6;color:#4b5563;">${escapeHtml(para)}</p>`
  )).join('');
  const actionHtml = actionUrl && actionLabel
    ? `<p style="margin:0 0 28px;">${emailCta(actionUrl, actionLabel)}</p>`
    : '';
  const footerHtml = footerText
    ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6b7280;">${escapeHtml(footerText)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td align="center" style="background:#111317;padding:18px 28px;">
                <img src="${LOGO_URL}" alt="EastCord Tires" width="280" style="display:block;width:280px;max-width:100%;height:auto;border:0;" />
              </td>
            </tr>
            <tr>
              <td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#111317;">
                <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;">${escapeHtml(heading)}</h1>
                ${bodyHtml}
                ${extraHtml}
                ${actionHtml}
                ${footerHtml}
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">EastCord Tires · 600 Harrop Drive, Milton, Ontario<br />info@eastcordtires.ca · 365-822-5553</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { to, subject, text, html };
}

function buildAuthEmail(options) {
  return buildBrandedEmail(options);
}

const RESEND_DOMAIN_NAME = 'eastcordtires.ca';
const RESEND_SENDING_OK = new Set(['verified', 'partially_verified']);

function isDomainUnverifiedError(message) {
  return /domain is not verified|not verified/i.test(String(message || ''));
}

function summarizeResendDomain(body) {
  const records = Array.isArray(body?.records) ? body.records : [];
  return {
    id: body?.id || null,
    name: body?.name || null,
    status: String(body?.status || ''),
    records: records.map((record) => ({
      type: record.record || record.type || '',
      name: record.name || '',
      status: record.status || '',
    })),
  };
}

function requestJsonWithHttps({ hostname, path, method = 'POST', headers, body }) {
  return new Promise((resolve, reject) => {
    const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
    const requestBody = hasBody ? JSON.stringify(body) : '';
    const request = https.request({
      hostname,
      path,
      method,
      headers: {
        ...headers,
        ...(hasBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        } : {}),
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
    if (hasBody) request.write(requestBody);
    request.end();
  });
}

function postJsonWithHttps(options) {
  return requestJsonWithHttps({ ...options, method: 'POST' });
}

async function resendApi(method, urlPath, body) {
  const config = getEmailConfig();
  if (!config.apiKey) {
    return { statusCode: 0, body: { message: 'missing_resend_api_key' } };
  }
  return requestJsonWithHttps({
    hostname: 'api.resend.com',
    path: urlPath,
    method,
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body,
  });
}

async function getEastcordResendDomain() {
  const list = await resendApi('GET', '/domains');
  if (list.statusCode < 200 || list.statusCode >= 300) {
    return {
      ok: false,
      reason: 'domain_list_failed',
      statusCode: list.statusCode,
      resendMessage: String(list.body?.message || '').slice(0, 160),
    };
  }
  const domains = Array.isArray(list.body?.data) ? list.body.data : [];
  const match = domains.find((item) => String(item.name || '').toLowerCase() === RESEND_DOMAIN_NAME);
  if (!match?.id) {
    return { ok: false, reason: 'domain_not_found' };
  }
  const detail = await resendApi('GET', `/domains/${match.id}`);
  if (detail.statusCode < 200 || detail.statusCode >= 300) {
    return {
      ok: false,
      reason: 'domain_detail_failed',
      statusCode: detail.statusCode,
      domain: summarizeResendDomain(match),
    };
  }
  return { ok: true, domain: summarizeResendDomain({ ...match, ...detail.body }) };
}

async function checkAndRepairResendDomain({ alertStaff = false, repair = true } = {}) {
  const config = getEmailConfig();
  if (String(config.provider || '').toLowerCase() === 'postmark') {
    return { ok: true, skipped: true, reason: 'postmark_provider' };
  }
  const found = await getEastcordResendDomain();
  if (!found.ok) return found;

  const beforeStatus = found.domain.status;
  const sendingOk = RESEND_SENDING_OK.has(beforeStatus);
  if (sendingOk || !repair) {
    return { ok: sendingOk, repaired: false, domain: found.domain };
  }

  const verify = await resendApi('POST', `/domains/${found.domain.id}/verify`);
  const after = await getEastcordResendDomain();
  const domain = after.domain || found.domain;
  const ok = RESEND_SENDING_OK.has(String(domain?.status || ''));
  const result = {
    ok,
    repaired: true,
    beforeStatus,
    verifyStatus: verify.statusCode,
    domain,
  };

  if (alertStaff && !ok) {
    const recordLines = (domain?.records || [])
      .map((record) => `${record.name || record.type}: ${record.status || 'unknown'}`)
      .join('\n');
    const alerted = await sendEmail({
      to: CONTACT_EMAIL,
      subject: 'EastCord emails are blocked — Resend domain not verified',
      text: [
        'Customer emails from eastcordtires.ca are blocked until Resend verifies the domain again.',
        `Current status: ${domain?.status || beforeStatus}`,
        recordLines ? `DNS records:\n${recordLines}` : '',
        'Leave the resend._domainkey, rsend, and send DNS records in place. This check will restart verification automatically.',
      ].filter(Boolean).join('\n\n'),
      html: `<p>Customer emails from eastcordtires.ca are blocked until Resend verifies the domain again.</p><p>Current status: <strong>${escapeHtml(domain?.status || beforeStatus)}</strong></p><p>Leave the resend._domainkey, rsend, and send DNS records in place.</p>`,
      skipDomainRepair: true,
    });
    result.staffAlerted = Boolean(alerted.ok);
  }

  return result;
}

function providerErrorMessage(body) {
  return String(body?.Message || body?.message || body?.name || body?.ErrorCode || '').slice(0, 160);
}

async function sendWithPostmark(config, email) {
  if (!config.postmarkToken) {
    return { ok: false, skipped: true, reason: 'missing_postmark_server_token' };
  }

  const headers = {
    Accept: 'application/json',
    'X-Postmark-Server-Token': config.postmarkToken,
  };
  const body = {
    From: config.from,
    To: email.to,
    ReplyTo: email.replyTo || config.replyTo,
    Subject: email.subject,
    HtmlBody: email.html,
    TextBody: email.text,
    MessageStream: config.messageStream || 'outbound',
  };
  if (email.idempotencyKey) {
    body.Tag = String(email.idempotencyKey).slice(0, 80);
  }

  const response = await postJsonWithHttps({
    hostname: 'api.postmarkapp.com',
    path: '/email',
    headers,
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const providerMessage = providerErrorMessage(response.body);
    console.error('[EastCord email] Postmark send failed.', {
      to: email.to,
      subject: email.subject,
      status: response.statusCode,
      providerMessage,
    });
    return {
      ok: false,
      skipped: false,
      reason: 'send_failed',
      status: response.statusCode,
      provider: 'postmark',
      providerMessage,
      resendMessage: providerMessage,
    };
  }

  return {
    ok: true,
    skipped: false,
    to: email.to,
    provider: 'postmark',
    id: response.body?.MessageID || '',
  };
}

async function sendWithResend(config, email) {
  if (!config.apiKey) {
    return { ok: false, skipped: true, reason: 'missing_resend_api_key' };
  }

  const headers = { Authorization: `Bearer ${config.apiKey}` };
  if (email.idempotencyKey) {
    headers['Idempotency-Key'] = String(email.idempotencyKey).slice(0, 256);
  }

  const response = await postJsonWithHttps({
    hostname: 'api.resend.com',
    path: '/emails',
    headers,
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
    const resendMessage = providerErrorMessage(response.body);
    console.error('[EastCord email] Resend send failed.', {
      to: email.to,
      subject: email.subject,
      status: response.statusCode,
      resendMessage,
    });
    if (!email.skipDomainRepair && isDomainUnverifiedError(resendMessage)) {
      try {
        await checkAndRepairResendDomain({ alertStaff: false, repair: true });
      } catch (error) {
        console.error('[EastCord email] Domain repair failed.', error.message || error);
      }
    }
    return {
      ok: false,
      skipped: false,
      reason: 'send_failed',
      status: response.statusCode,
      provider: 'resend',
      providerMessage: resendMessage,
      resendMessage,
    };
  }

  return {
    ok: true,
    skipped: false,
    to: email.to,
    provider: 'resend',
    id: response.body?.id || '',
  };
}

async function sendEmail(email) {
  const config = getEmailConfig();
  const provider = String(config.provider || '').toLowerCase();

  if (!email.to) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }
  if (provider === 'postmark') {
    return sendWithPostmark(config, email);
  }
  if (provider === 'resend') {
    return sendWithResend(config, email);
  }
  return { ok: false, skipped: true, reason: 'unsupported_email_provider' };
}

module.exports = {
  CONTACT_EMAIL,
  SITE_ORIGIN,
  ACCOUNT_URL,
  APPOINTMENT_URL,
  CONFIRM_SIGNUP_URL,
  RESET_PASSWORD_URL,
  WARRANTY_URL,
  buildHashedTokenActionUrl,
  getEmailConfig,
  isEmailConfigured,
  missingEmailConfigReason,
  resolveEmailProvider,
  isLocalNetlifyDev,
  forwardToProductionFunction,
  escapeHtml,
  htmlFromText,
  emailCta,
  buildAuthEmail,
  buildBrandedEmail,
  sendEmail,
  isDomainUnverifiedError,
  checkAndRepairResendDomain,
};
