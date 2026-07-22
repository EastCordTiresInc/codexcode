const AUTH_CONFIG = window.EASTCORD_AUTH_CONFIG || {};
const CART_KEY = 'eastcord_cart_v1';

function isAuthConfigured() {
  return Boolean(AUTH_CONFIG.supabaseUrl && AUTH_CONFIG.supabaseAnonKey && window.supabase);
}

function getSupabaseClient() {
  if (!isAuthConfigured()) return null;
  if (!window.eastcordSupabaseClient) {
    window.eastcordSupabaseClient = window.supabase.createClient(AUTH_CONFIG.supabaseUrl, AUTH_CONFIG.supabaseAnonKey);
  }
  return window.eastcordSupabaseClient;
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartCount();
}

function money(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function getCurrentUser() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data?.user || null;
}

async function getAccessToken() {
  const client = getSupabaseClient();
  if (!client) return '';
  const { data } = await client.auth.getSession();
  return data?.session?.access_token || '';
}

function profileFromUser(user) {
  if (!user) return null;
  return {
    customerId: user.id,
    name: user.user_metadata?.full_name || user.user_metadata?.name || '',
    email: user.email || '',
    phone: user.user_metadata?.phone || '',
  };
}

function profileFromRow(row, fallbackUser) {
  if (!row && fallbackUser) return profileFromUser(fallbackUser);
  if (!row) return null;
  return {
    customerId: row.id,
    name: row.full_name || '',
    email: row.email || fallbackUser?.email || '',
    phone: row.phone || '',
  };
}

async function upsertCustomerProfile(profile) {
  const client = getSupabaseClient();
  if (!client || !profile?.customerId) return null;

  const row = {
    id: profile.customerId,
    full_name: profile.name || '',
    phone: profile.phone || '',
    email: profile.email || '',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('customer_profiles')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getCurrentProfile() {
  const client = getSupabaseClient();
  const user = await getCurrentUser();
  if (!client || !user) return null;

  const { data, error } = await client
    .from('customer_profiles')
    .select('id, full_name, phone, email')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const fallback = profileFromUser(user);
    try {
      const inserted = await upsertCustomerProfile(fallback);
      return profileFromRow(inserted, user);
    } catch (profileError) {
      return fallback;
    }
  }

  return profileFromRow(data, user);
}

function buildBookingRecord(item, profile) {
  return {
    customer_id: profile.customerId,
    customer_name: profile.name || '',
    customer_email: profile.email || '',
    customer_phone: profile.phone || '',
    service_id: item.serviceId || '',
    service_name: item.serviceName || '',
    starting_price: Number(item.startingPrice || 0),
    deposit_amount: Number(item.depositAmount || 0),
    remaining_balance: Number(item.remainingBalance || 0),
    preferred_date: item.preferredDate || null,
    preferred_time_window: item.preferredTimeWindow || '',
    vehicle_year: item.vehicleYear || '',
    vehicle_make: item.vehicleMake || '',
    vehicle_model: item.vehicleModel || '',
    tire_size: item.tireSize || '',
    tires_already_on_rims: item.tiresAlreadyOnRims || '',
    number_of_tires: Number(item.numberOfTires || 0),
    full_service_address: item.fullServiceAddress || '',
    city: item.city || '',
    postal_code: item.postalCode || '',
    parking_access_notes: item.parkingAccessNotes || '',
    additional_notes: item.additionalNotes || '',
    service_area_status: item.serviceAreaStatus || 'In service area',
    booking_status: 'Pending Confirmation',
    payment_status: item.paymentStatus || 'pending_checkout',
    stripe_session_id: item.stripeSessionId || '',
    updated_at: new Date().toISOString(),
  };
}

async function saveAppointmentBooking(item, profile) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is not connected yet. Add Supabase environment variables before saving bookings.');
  if (!profile?.customerId) throw new Error('Please sign up or log in before booking.');

  const { data, error } = await client
    .from('appointment_bookings')
    .insert(buildBookingRecord(item, profile))
    .select('id')
    .single();

  if (error) throw new Error(error.message || 'Booking could not be saved to Supabase.');
  return data.id;
}

async function getCustomerBookings() {
  const client = getSupabaseClient();
  const profile = await getCurrentProfile();
  if (!client || !profile) return [];

  const { data, error } = await client
    .from('appointment_bookings')
    .select('id, service_name, preferred_date, preferred_time_window, city, tire_size, deposit_amount, remaining_balance, booking_status, payment_status, created_at')
    .eq('customer_id', profile.customerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function signUpCustomer({ fullName, email, phone, password }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Signup is not connected yet. Add Supabase URL and anon key in Netlify environment setup.');
  }

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        phone,
      },
    },
  });

  if (error) throw error;

  if (data?.user) {
    try {
      await upsertCustomerProfile({
        customerId: data.user.id,
        name: fullName,
        email: data.user.email || email,
        phone,
      });
    } catch (profileError) {
      console.warn('Customer profile will be created after email confirmation or next login.', profileError);
    }
  }

  return data;
}

async function signInCustomer({ email, password }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Login is not connected yet. Add Supabase URL and anon key in Netlify environment setup.');
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const profile = profileFromUser(data?.user);
  if (profile) await upsertCustomerProfile(profile);
  return data;
}

async function signOutCustomer() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  window.location.href = '/login';
}

function updateCartCount() {
  const count = getCart().length;
  document.querySelectorAll('[data-cart-count]').forEach((element) => {
    element.textContent = count ? ` (${count})` : '';
  });
}

async function updateAuthNavigation() {
  let profile = null;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    profile = null;
  }

  document.querySelectorAll('[data-auth-logged-out]').forEach((element) => {
    element.hidden = Boolean(profile);
  });
  document.querySelectorAll('[data-auth-logged-in]').forEach((element) => {
    element.hidden = !profile;
  });
  document.querySelectorAll('[data-account-name]').forEach((element) => {
    element.textContent = profile?.name || 'My Account';
  });
  updateCartCount();
}

function bindAuthForms() {
  const signupForm = document.querySelector('[data-signup-form]');
  const loginForm = document.querySelector('[data-login-form]');
  const authMessage = document.querySelector('[data-auth-message]');

  signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(signupForm);
    const password = formData.get('Password');
    const confirmPassword = formData.get('Confirm Password');

    if (password !== confirmPassword) {
      if (authMessage) authMessage.textContent = 'Passwords do not match.';
      return;
    }

    try {
      await signUpCustomer({
        fullName: formData.get('Full Name'),
        email: formData.get('Email'),
        phone: formData.get('Phone'),
        password,
      });
      window.location.href = '/account';
    } catch (error) {
      if (authMessage) authMessage.textContent = error.message || 'Signup could not be completed.';
    }
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);

    try {
      await signInCustomer({
        email: formData.get('Email'),
        password: formData.get('Password'),
      });
      const redirectTo = new URLSearchParams(window.location.search).get('redirect') || '/account';
      window.location.href = redirectTo;
    } catch (error) {
      if (authMessage) authMessage.textContent = error.message || 'Login could not be completed.';
    }
  });
}

function renderBookingHistory(bookings) {
  if (!bookings.length) {
    return '<p class="empty-cart">No appointment bookings yet.</p>';
  }

  return bookings.map((booking) => `
    <article class="cart-line">
      <span>${escapeHtml(booking.booking_status || 'Pending Confirmation')}</span>
      <strong>${escapeHtml(booking.service_name)}</strong>
      <p>${escapeHtml(booking.preferred_date || '')}${booking.preferred_time_window ? ` at ${escapeHtml(booking.preferred_time_window)}` : ''}</p>
      <p>${escapeHtml(booking.city || '')}${booking.tire_size ? ` - ${escapeHtml(booking.tire_size)}` : ''}</p>
      <p>Deposit: ${money(booking.deposit_amount)} | Remaining on-site: ${money(booking.remaining_balance)} | Payment: ${escapeHtml(booking.payment_status || 'pending_checkout')}</p>
    </article>
  `).join('');
}

async function hydrateAccountPage() {
  const accountPanel = document.querySelector('[data-account-panel]');
  const bookingPanel = document.querySelector('[data-booking-history]');
  if (!accountPanel) return;

  if (!isAuthConfigured()) {
    accountPanel.innerHTML = '<p>Account login is prepared but not connected yet. Add Supabase environment variables before customer accounts can be used.</p>';
    if (bookingPanel) bookingPanel.innerHTML = '';
    return;
  }

  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      accountPanel.innerHTML = '<p>Please log in to view your account.</p><p><a class="button button-primary" href="/login?redirect=/account">Log In</a></p>';
      if (bookingPanel) bookingPanel.innerHTML = '';
      return;
    }

    accountPanel.innerHTML = `
      <div class="account-detail"><span>Name</span><strong>${escapeHtml(profile.name || 'Not provided')}</strong></div>
      <div class="account-detail"><span>Email</span><strong>${escapeHtml(profile.email)}</strong></div>
      <div class="account-detail"><span>Phone</span><strong>${escapeHtml(profile.phone || 'Not provided')}</strong></div>
    `;

    if (bookingPanel) {
      const bookings = await getCustomerBookings();
      bookingPanel.innerHTML = renderBookingHistory(bookings);
    }
  } catch (error) {
    accountPanel.innerHTML = `<p>${escapeHtml(error.message || 'Account details could not be loaded.')}</p>`;
    if (bookingPanel) bookingPanel.innerHTML = '';
  }
}

function bindLogoutButtons() {
  document.querySelectorAll('[data-logout-button]').forEach((button) => {
    button.addEventListener('click', signOutCustomer);
  });
}

window.EastCordAccount = {
  isAuthConfigured,
  getSupabaseClient,
  getCurrentProfile,
  getAccessToken,
  getCart,
  saveCart,
  clearCart,
  saveAppointmentBooking,
  money,
};

document.addEventListener('DOMContentLoaded', () => {
  bindAuthForms();
  bindLogoutButtons();
  hydrateAccountPage();
  updateAuthNavigation();
});
