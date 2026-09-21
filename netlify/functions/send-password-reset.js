const { createClient } = require('@supabase/supabase-js');
const { sendEmail, getEmailConfig, RESET_PASSWORD_URL, escapeHtml, emailCta, SITE_ORIGIN } = require('./lib/send-email');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function genericOk() {
  return json(200, {
    message: 'If an EastCord account exists for that email, a password reset link has been sent.',
    emailed: true,
  });
}

function withRedirectTo(confirmUrl, redirectTo) {
  try {
    const url = new URL(confirmUrl);
    url.searchParams.set('redirect_to', redirectTo);
    return url.toString();
  } catch (error) {
    return confirmUrl;
  }
}

function buildResetUrl(supabaseUrl, data, redirectTo) {
  const hashedToken = data?.properties?.hashed_token || '';
  const verifyType = data?.properties?.verification_type || 'recovery';
  if (hashedToken) {
    const base = String(supabaseUrl || '').replace(/\/$/, '');
    return `${base}/auth/v1/verify?token=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(verifyType)}&redirect_to=${encodeURIComponent(redirectTo)}`;
  }
  const actionLink = data?.properties?.action_link || data?.action_link || '';
  return actionLink ? withRedirectTo(actionLink, redirectTo) : '';
}

function buildResetEmail({ to, resetUrl }) {
  const text = [
    'Reset your EastCord Tires password',
    '',
    'We received a request to reset the password for this EastCord Tires account.',
    'Open this link to choose a new password:',
    resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
    '',
    'EastCord Tires',
    SITE_ORIGIN,
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111317;">
      <h1 style="font-size:20px;margin:0 0 12px;">Reset your EastCord Tires password</h1>
      <p style="margin:0 0 16px;">We received a request to reset the password for this EastCord Tires account. Click the button below to choose a new password.</p>
      <p style="margin:0 0 20px;">
        ${emailCta(resetUrl, 'Reset password')}
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">Or paste this link into your browser:</p>
      <p style="margin:0 0 12px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
      <p style="margin:0;font-size:13px;"><a href="${escapeHtml(SITE_ORIGIN)}">${escapeHtml(SITE_ORIGIN)}</a></p>
    </div>
  `;

  return {
    to,
    subject: 'Reset your EastCord Tires password',
    text,
    html,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Request body must be valid JSON.' });
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json(400, { message: 'A valid email address is required.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[EastCord auth] Missing Supabase admin configuration for password reset.');
    return json(500, { message: 'Password reset email is not configured yet.' });
  }

  const emailConfig = getEmailConfig();
  if (!emailConfig.apiKey) {
    console.error('[EastCord auth] RESEND_API_KEY is missing; cannot send password reset.');
    return json(503, {
      message: 'Password reset email could not be sent right now. Please contact EastCord Tires.',
      reason: 'missing_resend_api_key',
    });
  }

  const redirectTo = RESET_PASSWORD_URL;
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  if (error) {
    // Do not reveal whether the email has an account.
    console.warn('[EastCord auth] Password reset generateLink did not send.', {
      message: error.message,
      code: error.code || error.status || '',
    });
    return genericOk();
  }

  const resetUrl = buildResetUrl(supabaseUrl, data, redirectTo);
  if (!resetUrl || /localhost|127\.0\.0\.1/i.test(resetUrl)) {
    console.error('[EastCord auth] Password reset URL missing or pointed at localhost.');
    return json(502, { message: 'Password reset email could not be created right now.' });
  }

  const sent = await sendEmail(buildResetEmail({ to: email, resetUrl }));
  if (!sent.ok) {
    console.error('[EastCord auth] Password reset email send failed.', sent);
    return json(502, {
      message: 'Password reset email could not be sent right now. Please try again shortly.',
      reason: sent.reason || 'send_failed',
    });
  }

  return genericOk();
};
