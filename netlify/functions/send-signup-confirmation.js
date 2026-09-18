const { createClient } = require('@supabase/supabase-js');
const { sendEmail, getEmailConfig } = require('./lib/send-email');

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

function isAlreadyRegisteredError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || error?.status || '').toLowerCase();
  return code === 'user_already_exists'
    || code === '422'
    || message.includes('already been registered')
    || message.includes('already registered')
    || message.includes('user already exists')
    || message.includes('email address has already been registered');
}

function getSiteOrigin(event) {
  const proto = String(event.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(event.headers['x-forwarded-host'] || event.headers.host || 'eastcordtires.ca')
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (!host || host.includes('localhost') || host.startsWith('127.')) {
    return 'https://eastcordtires.ca';
  }

  return `${proto}://${host}`.replace(/\/$/, '');
}

function getConfirmRedirectTo(event, requestedRedirect) {
  const origin = getSiteOrigin(event);
  const fallback = `${origin}/account.html`;
  const raw = String(requestedRedirect || '').trim();
  if (!raw) return fallback;

  try {
    const url = new URL(raw, origin);
    // Never send customers to a local development URL from production emails.
    if (/localhost|127\.0\.0\.1/i.test(url.hostname)) return fallback;
    if (url.origin !== origin) return fallback;
    if (!url.pathname.startsWith('/')) return fallback;
    // Prefer the account page so confirm links land signed-in on My Account.
    if (url.pathname === '/login' || url.pathname === '/login.html' || url.pathname === '/signup' || url.pathname === '/signup.html') {
      return fallback;
    }
    return url.toString();
  } catch (error) {
    return fallback;
  }
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

function buildConfirmationEmail({ to, confirmUrl }) {
  const text = [
    'Confirm your EastCord Tires account',
    '',
    'Thanks for signing up. Open this link to confirm your email and open your EastCord account:',
    confirmUrl,
    '',
    'If you did not create this account, you can ignore this email.',
    '',
    'EastCord Tires',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111317;">
      <h1 style="font-size:20px;margin:0 0 12px;">Confirm your EastCord Tires account</h1>
      <p style="margin:0 0 16px;">Thanks for signing up. Click the button below to confirm your email and open your account.</p>
      <p style="margin:0 0 20px;">
        <a href="${confirmUrl}" style="display:inline-block;background:#ba151b;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">
          Confirm email
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#4b5563;">Or paste this link into your browser:</p>
      <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${confirmUrl}">${confirmUrl}</a></p>
    </div>
  `;

  return {
    to,
    subject: 'Confirm your EastCord Tires account',
    text,
    html,
  };
}

async function generateConfirmLink(supabaseAdmin, { email, password, fullName, phone, redirectTo }) {
  // Creates the auth user and returns a confirm URL without Supabase sending mail.
  const signupAttempt = await supabaseAdmin.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone,
      },
      redirectTo,
    },
  });

  if (!signupAttempt.error) {
    return signupAttempt;
  }

  if (isAlreadyRegisteredError(signupAttempt.error)) {
    return {
      data: null,
      error: signupAttempt.error,
      alreadyMember: true,
    };
  }

  return signupAttempt;
}

function extractActionLink(data) {
  return data?.properties?.action_link
    || data?.action_link
    || '';
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
  const password = String(body.password || '');
  const fullName = String(body.fullName || '').trim();
  const phone = String(body.phone || '').trim();

  if (!isValidEmail(email)) {
    return json(400, { message: 'A valid email address is required.' });
  }
  if (password.length < 8) {
    return json(400, { message: 'Password must be at least 8 characters.' });
  }
  if (!fullName) {
    return json(400, { message: 'Full name is required.' });
  }
  if (!phone) {
    return json(400, { message: 'Phone number is required.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[EastCord auth] Missing Supabase admin configuration for signup confirmation.');
    return json(500, { message: 'Account confirmation email is not configured yet.' });
  }

  const emailConfig = getEmailConfig();
  if (!emailConfig.apiKey) {
    console.error('[EastCord auth] RESEND_API_KEY is missing; cannot send signup confirmation.');
    return json(503, {
      message: 'Confirmation email service is not configured. Please contact EastCord Tires.',
      reason: 'missing_resend_api_key',
    });
  }

  const redirectTo = getConfirmRedirectTo(event, body.redirectTo);
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const linkResult = await generateConfirmLink(supabaseAdmin, {
    email,
    password,
    fullName,
    phone,
    redirectTo,
  });

  if (linkResult.alreadyMember) {
    return json(409, {
      message: 'This email already has an EastCord Tires account. Please sign in.',
      alreadyMember: true,
    });
  }

  if (linkResult.error) {
    console.error('[EastCord auth] generateLink failed.', {
      message: linkResult.error.message,
      code: linkResult.error.code || linkResult.error.status || '',
    });
    return json(502, {
      message: 'Account could not be created right now. Please try again shortly.',
    });
  }

  const rawConfirmUrl = extractActionLink(linkResult.data);
  if (!rawConfirmUrl) {
    console.error('[EastCord auth] generateLink returned no action_link.');
    return json(502, { message: 'Confirmation email could not be created right now.' });
  }

  const confirmUrl = withRedirectTo(rawConfirmUrl, redirectTo);
  const sent = await sendEmail(buildConfirmationEmail({ to: email, confirmUrl }));
  if (!sent.ok) {
    console.error('[EastCord auth] Confirmation email send failed.', sent);
    return json(502, {
      message: 'Account was created, but the confirmation email could not be sent. Please contact EastCord Tires.',
      reason: sent.reason || 'send_failed',
      userCreated: true,
    });
  }

  return json(200, {
    message: 'Confirmation email sent. Please check your inbox (and spam folder).',
    emailed: true,
  });
};
