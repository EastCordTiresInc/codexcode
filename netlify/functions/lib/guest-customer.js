const crypto = require('crypto');

function clean(value) {
  return String(value || '').trim();
}

function guestCustomerError(customer) {
  const name = clean(customer?.name);
  const email = clean(customer?.email).toLowerCase();
  const phone = clean(customer?.phone);
  if (!name || !email || !phone) return 'Enter your name, email, and phone before payment.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (phone.replace(/\D/g, '').length < 10) return 'Enter a phone number with at least 10 digits.';
  return '';
}

async function findAuthUserByEmail(supabaseAdmin, email) {
  const target = clean(email).toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const listed = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (listed.error) throw listed.error;
    const users = listed.data?.users || [];
    const match = users.find((user) => String(user.email || '').toLowerCase() === target);
    if (match) return match;
    if (users.length < 200) break;
  }
  return null;
}

async function ensureCheckoutCustomer(supabaseAdmin, customer, options = {}) {
  const message = guestCustomerError(customer);
  if (message) return { error: message, statusCode: 400 };

  const email = clean(customer.email).toLowerCase();
  const name = clean(customer.name);
  const phone = clean(customer.phone);
  const password = `EastCord-Guest-${crypto.randomBytes(18).toString('base64url')}aA1!`;
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name, phone, guest_checkout: true },
  });
  const already = /already been registered|already registered|already exists/i.test(created.error?.message || '');
  if (already) {
    if (options.allowExisting) {
      try {
        const existing = await findAuthUserByEmail(supabaseAdmin, email);
        if (existing?.id) return { id: existing.id, email, name, phone, existing: true };
      } catch (error) {
        console.warn('[EastCord guest checkout] Existing account lookup failed.', error.message || error);
      }
    }
    return {
      error: 'An account already uses this email. Log in to pay with that account.',
      code: 'account_exists',
      statusCode: 409,
    };
  }
  if (created.error || !created.data?.user?.id) {
    return { error: created.error?.message || 'The customer could not be saved.', statusCode: 500 };
  }

  const row = {
    id: created.data.user.id,
    full_name: name,
    email,
    phone,
    updated_at: new Date().toISOString(),
  };
  let profile = await supabaseAdmin.from('customer_profiles').upsert(row, { onConflict: 'id' });
  if (profile.error && /updated_at/i.test(`${profile.error.message || ''} ${profile.error.details || ''}`)) {
    delete row.updated_at;
    profile = await supabaseAdmin.from('customer_profiles').upsert(row, { onConflict: 'id' });
  }
  if (profile.error) {
    console.warn('[EastCord guest checkout] Profile save failed.', profile.error.message);
  }

  return { id: created.data.user.id, email, name, phone };
}

async function guestBookingSignIn(supabaseAdmin, email) {
  const generated = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: clean(email).toLowerCase(),
  });
  const tokenHash = generated.data?.properties?.hashed_token || '';
  if (generated.error || !tokenHash) {
    console.warn('[EastCord guest checkout] Booking sign-in link failed.', generated.error?.message || 'missing token');
    return null;
  }
  return { tokenHash, type: 'magiclink' };
}

module.exports = { ensureCheckoutCustomer, guestCustomerError, guestBookingSignIn };
