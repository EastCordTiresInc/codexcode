const ADMIN_EMAILS = Object.freeze([
  'info@eastcordtires.ca',
]);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdminUser(event) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return {
      error: {
        statusCode: 500,
        message: 'Supabase admin configuration is missing.',
      },
    };
  }

  const token = getBearerToken(event);
  if (!token) {
    return {
      error: {
        statusCode: 401,
        message: 'Log in with the EastCord staff account to open the admin dashboard.',
      },
    };
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      error: {
        statusCode: 401,
        message: 'Your login session expired. Log in again to open the admin dashboard.',
      },
    };
  }

  const email = normalizeEmail(authData.user.email);
  if (!isAdminEmail(email)) {
    return {
      error: {
        statusCode: 403,
        message: 'This account is not allowed to open the admin dashboard.',
      },
    };
  }

  return {
    supabaseAdmin,
    user: authData.user,
    email,
  };
}

module.exports = {
  ADMIN_EMAILS,
  isAdminEmail,
  requireAdminUser,
  getSupabaseAdmin,
  getBearerToken,
  normalizeEmail,
};
