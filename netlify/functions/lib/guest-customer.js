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

async function ensureCheckoutCustomer(supabaseAdmin, customer) {
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
    return {
      error: 'An account already uses this email. Log in to pay with that account.',
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

module.exports = { ensureCheckoutCustomer, guestCustomerError };
