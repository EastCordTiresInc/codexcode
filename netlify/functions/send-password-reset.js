const { createClient } = require('@supabase/supabase-js');
const { sendEmail, getEmailConfig, RESET_PASSWORD_URL, buildAuthEmail, isLocalNetlifyDev, forwardToProductionFunction } = require('./lib/send-email');

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
  return buildAuthEmail({
    to,
    subject: 'Reset your EastCord Tires password',
    heading: 'Reset your EastCord Tires password',
    body: [
      'We received a request to reset the password on your EastCord Tires account.',
      'Choose a new password so you can keep shopping inspected used tires, new tires, and installation at 600 Harrop Drive in Milton.',
    ],
    actionUrl: resetUrl,
    actionLabel: 'Choose a new EastCord password',
    footer: 'If you did not ask to reset your EastCord Tires password, you can ignore this email.',
  });
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
    if (isLocalNetlifyDev()) {
      try {
        const forwarded = await forwardToProductionFunction('send-password-reset', { email });
        return json(forwarded.statusCode, forwarded.payload);
      } catch (error) {
        console.error('[EastCord auth] Local password reset could not reach production email service.', error.message);
      }
    }
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
