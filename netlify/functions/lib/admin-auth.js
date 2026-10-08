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

async function requireSignedInUser(event) {
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
        message: 'Log in to continue.',
      },
    };
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      error: {
        statusCode: 401,
        message: 'Your login session expired. Log in again.',
      },
    };
  }

  return {
    supabaseAdmin,
    user: authData.user,
    email: normalizeEmail(authData.user.email),
  };
}

async function isApprovedInstaller(supabaseAdmin, email) {
  try {
    const { data, error } = await supabaseAdmin
      .from('installer_applications')
      .select('email')
      .eq('status', 'approved');
    if (error) {
      console.error('[EastCord installers] Approved installer list failed.', error.message);
      return false;
    }
    return (data || []).some((row) => normalizeEmail(row.email) === email);
  } catch (error) {
    console.error('[EastCord installers] Approved installer list failed.', error.message);
    return false;
  }
}

async function requireAdminUser(event) {
  const auth = await requireSignedInUser(event);
  if (auth.error) return auth;
  if (!isAdminEmail(auth.email)) {
    return {
      error: {
        statusCode: 403,
        message: 'This account is not allowed to open the admin dashboard.',
      },
    };
  }
  return { ...auth, role: 'admin' };
}

async function requireJobPhotoUser(event) {
  const auth = await requireSignedInUser(event);
  if (auth.error) return auth;
  if (isAdminEmail(auth.email)) return { ...auth, role: 'admin' };
  const approved = await isApprovedInstaller(auth.supabaseAdmin, auth.email);
  if (!approved) {
    return {
      error: {
        statusCode: 403,
        message: 'This login cannot submit installation photos.',
      },
    };
  }
  return { ...auth, role: 'installer' };
}

module.exports = {
  ADMIN_EMAILS,
  isAdminEmail,
  requireAdminUser,
  requireJobPhotoUser,
  isApprovedInstaller,
  getSupabaseAdmin,
  getBearerToken,
  normalizeEmail,
};
