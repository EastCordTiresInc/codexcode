/**
 * One-shot setup for the staff admin account.
 * Creates/updates info@eastcordtires.ca and marks the profile as admin.
 *
 * Usage: node scripts/setup-admin-user.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ADMIN_EMAIL = 'info@eastcordtires.ca';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '1234';
const ADMIN_NAME = 'EastCord Staff';

if (!process.env.ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD not set; using the temporary test password. Change this before production.');
}

function loadProtectedTestEnvironment() {
  function loadFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
      if (!match || process.env[match[1]]) return;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value.replace(/\\n/g, '\n');
    });
  }

  const root = path.join(__dirname, '..');
  loadFile(path.join(root, '.env'));
  loadFile(path.join(root, '.netlify', '.env'));

  ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].forEach((name) => {
    if (process.env[name]) return;
    process.env[name] = execFileSync(
      'npx',
      ['netlify', 'env:get', name, '--context', 'dev', '--scope', 'functions'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' },
    ).trim();
  });
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((user) => String(user.email || '').toLowerCase() === email);
    if (match) return match;
    if (users.length < 200) break;
  }
  return null;
}

(async () => {
  loadProtectedTestEnvironment();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let user = await findUserByEmail(admin, ADMIN_EMAIL);
  let passwordSet = false;
  let passwordNote = '';

  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: ADMIN_NAME, phone: '' },
    });
    if (error) {
      if (/password|least|characters|weak/i.test(error.message || '')) {
        const fallback = '123456';
        const retry = await admin.auth.admin.createUser({
          email: ADMIN_EMAIL,
          password: fallback,
          email_confirm: true,
          user_metadata: { full_name: ADMIN_NAME, phone: '' },
        });
        if (retry.error) throw retry.error;
        user = retry.data.user;
        passwordSet = true;
        passwordNote = `Supabase rejected password "1234" (${error.message}). Temporary password set to "${fallback}".`;
      } else {
        throw error;
      }
    } else {
      user = data.user;
      passwordSet = true;
      passwordNote = 'Password set to "1234" for testing.';
    }
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(user.user_metadata || {}),
        full_name: user.user_metadata?.full_name || ADMIN_NAME,
      },
    });
    if (error) {
      if (/password|least|characters|weak/i.test(error.message || '')) {
        const fallback = '123456';
        const retry = await admin.auth.admin.updateUserById(user.id, {
          password: fallback,
          email_confirm: true,
        });
        if (retry.error) throw retry.error;
        passwordSet = true;
        passwordNote = `Supabase rejected password "1234" (${error.message}). Temporary password set to "${fallback}".`;
      } else {
        throw error;
      }
    } else {
      passwordSet = true;
      passwordNote = 'Password updated to "1234" for testing.';
    }
  }

  // Ensure profile row + admin role. Role column may not exist yet.
  const baseProfile = {
    id: user.id,
    full_name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    phone: '',
    updated_at: new Date().toISOString(),
  };

  let roleApplied = false;
  const withRole = await admin.from('customer_profiles').upsert({
    ...baseProfile,
    role: 'admin',
  });

  if (withRole.error && /column.*role|role.*column/i.test(withRole.error.message || '')) {
    const withoutRole = await admin.from('customer_profiles').upsert(baseProfile);
    if (withoutRole.error) throw withoutRole.error;
    roleApplied = false;
  } else if (withRole.error) {
    throw withRole.error;
  } else {
    roleApplied = true;
  }

  // Verify login works with the password we set.
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  let loginOk = false;
  let loginError = '';
  if (anonKey) {
    const anon = createClient(process.env.SUPABASE_URL, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const passwordToTry = /123456/.test(passwordNote) ? '123456' : ADMIN_PASSWORD;
    const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({
      email: ADMIN_EMAIL,
      password: passwordToTry,
    });
    loginOk = Boolean(signedIn?.session);
    loginError = signInError?.message || '';
    if (signedIn?.session) await anon.auth.signOut();
  }

  console.log(JSON.stringify({
    email: ADMIN_EMAIL,
    userId: user.id,
    passwordSet,
    passwordNote,
    roleApplied,
    roleSqlNeeded: !roleApplied,
    loginOk,
    loginError: loginOk ? '' : loginError,
  }, null, 2));

  if (!roleApplied) {
    console.log('\nRun supabase/admin-staff-role.sql in the Supabase SQL editor, then re-run this script.');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
