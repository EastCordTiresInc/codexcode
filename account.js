const AUTH_CONFIG = window.EASTCORD_AUTH_CONFIG || {};
const CART_KEY = 'eastcord_cart_v1';
const ACCOUNT_SETUP_MESSAGE = 'Account signup is being connected. Please contact EastCord Tires or check back soon.';
const EMAIL_CONFIRMATION_MESSAGE = 'Account created. Please check your email to confirm your account, then log in.';
const TAX_RATE = 0.13;
const CART_STORAGE_KEYS = [
  CART_KEY,
  'cart',
  'eastcord_cart',
  'appointment_cart',
  'eastcord_appointment_cart',
  'eastcord_appointment_cart_v1',
];
const APPOINTMENT_DRAFT_STORAGE_KEYS = [
  'eastcord_pending_appointment_v1',
  'eastcord_auth_redirect',
  'pendingAppointment',
  'pending_appointment',
  'appointmentDraft',
  'savedAppointment',
  'eastcord_appointment_draft',
  'eastcord_saved_appointment',
];
const CART_RESET_STORAGE_KEYS = [...new Set([...CART_STORAGE_KEYS, ...APPOINTMENT_DRAFT_STORAGE_KEYS])];

function logDeveloperError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, error);
}

function logSupabaseError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, {
    message: error?.message || '',
    code: error?.code || '',
    details: error?.details || '',
    hint: error?.hint || '',
  });
}

function logAuthDiagnostic(message, value) {
  console.info(`[EastCord appointment automation] ${message}: ${value ? 'yes' : 'no'}`);
}

function logAuthConfigStatus() {
  logAuthDiagnostic('Supabase URL exists', Boolean(AUTH_CONFIG.supabaseUrl));
  logAuthDiagnostic('Supabase anon key exists', Boolean(AUTH_CONFIG.supabaseAnonKey));
  logAuthDiagnostic('Supabase browser library exists', Boolean(window.supabase));
}

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

function getRedirectTarget(defaultTarget = '/account.html') {
  const params = new URLSearchParams(window.location.search);
  return params.get('redirect') || localStorage.getItem('eastcord_auth_redirect') || defaultTarget;
}

function goToRedirectTarget(defaultTarget = '/account.html') {
  const redirectTo = getRedirectTarget(defaultTarget);
  localStorage.removeItem('eastcord_auth_redirect');
  window.location.href = redirectTo;
}

function preserveAuthSwitchLinks() {
  const redirectTarget = getRedirectTarget('');
  if (!redirectTarget) return;

  document.querySelectorAll('a[href="/signup.html"], a[href="signup.html"]').forEach((link) => {
    link.href = `/signup.html?redirect=${encodeURIComponent(redirectTarget)}`;
  });

  document.querySelectorAll('a[href="/login.html"], a[href="login.html"]').forEach((link) => {
    link.href = `/login.html?redirect=${encodeURIComponent(redirectTarget)}`;
  });
}

function getFriendlySupabaseError(error, fallback = 'Signup could not be completed right now. Please try again shortly.') {
  const message = String(error?.message || '').trim();
  const lowerMessage = message.toLowerCase();

  if (!message) return fallback;
  if (lowerMessage.includes('already registered') || lowerMessage.includes('already exists')) {
    return 'An account may already exist for this email. Please log in or use password recovery if needed.';
  }
  if (lowerMessage.includes('invalid email')) return 'Please enter a valid email address.';
  if (lowerMessage.includes('password')) return message;
  if (lowerMessage.includes('email rate limit')) return 'Too many signup emails were requested. Please wait a few minutes and try again.';
  if (lowerMessage.includes('signup') && lowerMessage.includes('disabled')) return 'Online signup is not enabled yet. Please contact EastCord Tires.';
  if (lowerMessage.includes('fetch') || lowerMessage.includes('network')) return 'Signup could not connect right now. Please check your connection and try again.';

  return message;
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch (error) {
    logDeveloperError('Cart storage could not be read.', error);
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function getExistingStorageKeys(storage) {
  const keys = [];
  if (!storage) return keys;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

function removeStorageKeys(storage, keys) {
  if (!storage) return;
  keys.forEach((key) => storage.removeItem(key));
}

function clearCartStorage() {
  const localKeysBefore = getExistingStorageKeys(localStorage);
  const sessionKeysBefore = getExistingStorageKeys(sessionStorage);
  const localKeysToRemove = localKeysBefore.filter((key) => CART_RESET_STORAGE_KEYS.includes(key));
  const sessionKeysToRemove = sessionKeysBefore.filter((key) => CART_RESET_STORAGE_KEYS.includes(key));

  console.info('[EastCord appointment automation] Clearing cart storage.', {
    localKeysBefore: localKeysToRemove,
    sessionKeysBefore: sessionKeysToRemove,
    cartItemCountBefore: getCart().length,
  });

  removeStorageKeys(localStorage, CART_RESET_STORAGE_KEYS);
  removeStorageKeys(sessionStorage, CART_RESET_STORAGE_KEYS);
  localStorage.setItem(CART_KEY, '[]');

  console.info('[EastCord appointment automation] Cart storage cleared.', {
    localKeysAfter: getExistingStorageKeys(localStorage).filter((key) => CART_RESET_STORAGE_KEYS.includes(key)),
    sessionKeysAfter: getExistingStorageKeys(sessionStorage).filter((key) => CART_RESET_STORAGE_KEYS.includes(key)),
    cartItemCountAfter: getCart().length,
  });
}

function clearCart() {
  clearCartStorage();
  updateCartCount();
}

function money(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateTaxBreakdown(subtotal) {
  const serviceSubtotal = roundMoney(subtotal);
  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
  const depositAmount = roundMoney(totalWithHst * 0.20);
  const remainingBalance = roundMoney(totalWithHst - depositAmount);

  return {
    serviceSubtotal,
    hstAmount,
    totalWithHst,
    depositAmount,
    remainingBalance,
    taxRate: TAX_RATE,
  };
}

function getBookingTaxDetails(item) {
  const fallback = calculateTaxBreakdown(item.serviceSubtotal ?? item.startingPrice ?? 0);
  return {
    serviceSubtotal: roundMoney(item.serviceSubtotal ?? item.startingPrice ?? fallback.serviceSubtotal),
    hstAmount: roundMoney(item.hstAmount ?? fallback.hstAmount),
    totalWithHst: roundMoney(item.totalWithHst ?? fallback.totalWithHst),
    depositAmount: roundMoney(item.depositAmount ?? fallback.depositAmount),
    remainingBalance: roundMoney(item.remainingBalance ?? fallback.remainingBalance),
    taxRate: Number(item.taxRate ?? TAX_RATE),
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function getCurrentUser() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) {
    logSupabaseError('Supabase user lookup failed.', error);
    return null;
  }
  return data?.user || null;
}

async function getAccessToken() {
  const client = getSupabaseClient();
  if (!client) return '';
  const { data, error } = await client.auth.getSession();
  if (error) {
    logSupabaseError('Supabase session lookup failed.', error);
    return '';
  }
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

function buildCustomerProfileRow(profile) {
  return {
    id: profile.customerId,
    full_name: profile.name || '',
    phone: profile.phone || '',
    email: profile.email || '',
    updated_at: new Date().toISOString(),
  };
}

function isDuplicateKeyError(error) {
  return error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate key');
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' && message.includes(columnName.toLowerCase());
}

function profileSaveErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('row-level security') || error?.code === '42501') {
    return 'Customer profile could not be saved because Supabase row security blocked the profile write. Please check the customer_profiles RLS insert/update/select policies.';
  }
  if (isMissingColumnError(error, 'updated_at')) {
    return 'Customer profile could not be saved because the customer_profiles table is missing the updated_at column used by the website.';
  }
  return 'Customer profile could not be saved right now. Please try again shortly.';
}

async function insertCustomerProfile(client, row) {
  return client
    .from('customer_profiles')
    .insert(row)
    .select('id, full_name, phone, email')
    .single();
}

async function updateCustomerProfile(client, row) {
  return client
    .from('customer_profiles')
    .update(row)
    .eq('id', row.id)
    .select('id, full_name, phone, email')
    .single();
}

async function upsertCustomerProfile(profile) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);
  if (!profile?.customerId) throw new Error('Please log in again before continuing.');

  const row = buildCustomerProfileRow(profile);
  console.info('[EastCord appointment automation] customer_profiles save started', {
    idMatchesAuthUser: Boolean(row.id),
    columns: Object.keys(row),
  });

  let insertResult = await insertCustomerProfile(client, row);

  if (isMissingColumnError(insertResult.error, 'updated_at')) {
    delete row.updated_at;
    console.info('[EastCord appointment automation] customer_profiles updated_at column missing; retrying without updated_at.');
    insertResult = await insertCustomerProfile(client, row);
  }

  if (!insertResult.error) {
    console.info('[EastCord appointment automation] customer_profiles insert success');
    return insertResult.data;
  }

  if (!isDuplicateKeyError(insertResult.error)) {
    logSupabaseError('customer_profiles insert failed.', insertResult.error);
    throw new Error(profileSaveErrorMessage(insertResult.error));
  }

  console.info('[EastCord appointment automation] customer_profiles already exists; trying update.');
  let updateResult = await updateCustomerProfile(client, row);

  if (isMissingColumnError(updateResult.error, 'updated_at')) {
    delete row.updated_at;
    console.info('[EastCord appointment automation] customer_profiles updated_at column missing on update; retrying without updated_at.');
    updateResult = await updateCustomerProfile(client, row);
  }

  if (updateResult.error) {
    logSupabaseError('customer_profiles update failed.', updateResult.error);
    throw new Error(profileSaveErrorMessage(updateResult.error));
  }

  console.info('[EastCord appointment automation] customer_profiles update success');
  return updateResult.data;
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

  if (error) {
    logSupabaseError('customer_profiles read failed.', error);
    return profileFromUser(user);
  }

  if (!data) {
    const fallback = profileFromUser(user);
    try {
      const inserted = await upsertCustomerProfile(fallback);
      return profileFromRow(inserted, user);
    } catch (profileError) {
      logDeveloperError('customer_profiles fallback create failed.', profileError);
      return fallback;
    }
  }

  return profileFromRow(data, user);
}

function buildBookingRecord(item, profile) {
  const tax = getBookingTaxDetails(item);
  return {
    customer_id: profile.customerId,
    customer_name: profile.name || '',
    customer_email: profile.email || '',
    customer_phone: profile.phone || '',
    service_id: item.serviceId || '',
    service_name: item.serviceName || '',
    starting_price: tax.serviceSubtotal,
    service_subtotal: tax.serviceSubtotal,
    hst_amount: tax.hstAmount,
    total_with_hst: tax.totalWithHst,
    deposit_amount: tax.depositAmount,
    remaining_balance: tax.remainingBalance,
    tax_rate: tax.taxRate,
    preferred_date: item.preferredDate || null,
    preferred_time_window: item.preferredTimeWindow || '',
    vehicle_year: item.vehicleYear || '',
    vehicle_make: item.vehicleMake || '',
    vehicle_model: item.vehicleModel || '',
    vehicle_plate_number: item.vehiclePlateNumber || '',
    vehicle_colour: item.vehicleColour || '',
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
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);
  if (!profile?.customerId) throw new Error('Please sign up or log in before booking.');

  const { data, error } = await client
    .from('appointment_bookings')
    .insert(buildBookingRecord(item, profile))
    .select('id')
    .single();

  if (error) {
    logSupabaseError('appointment_bookings insert failed.', error);
    throw new Error('Booking details could not be saved right now. Please try again shortly.');
  }
  return data.id;
}

async function getCustomerBookings() {
  const client = getSupabaseClient();
  const profile = await getCurrentProfile();
  if (!client || !profile) return [];

  const { data, error } = await client
    .from('appointment_bookings')
    .select('id, service_name, preferred_date, preferred_time_window, city, tire_size, vehicle_year, vehicle_make, vehicle_model, vehicle_plate_number, vehicle_colour, service_subtotal, hst_amount, total_with_hst, deposit_amount, remaining_balance, booking_status, payment_status, created_at')
    .eq('customer_id', profile.customerId)
    .order('created_at', { ascending: false });

  if (error) {
    logSupabaseError('appointment_bookings read failed.', error);
    return [];
  }
  return data || [];
}

async function signUpCustomer({ fullName, email, phone, password }) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);

  console.info('[EastCord appointment automation] signup request started');

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${window.location.origin}/account.html`,
      data: {
        full_name: fullName,
        phone,
      },
    },
  });

  if (error) {
    console.info('[EastCord appointment automation] signup error');
    logSupabaseError('Supabase signup failed.', error);
    throw new Error(getFriendlySupabaseError(error));
  }

  console.info('[EastCord appointment automation] signup success', {
    userCreated: Boolean(data?.user),
    sessionCreated: Boolean(data?.session),
    emailConfirmationLikelyRequired: Boolean(data?.user && !data?.session),
  });

  if (data?.user && data?.session) {
    try {
      await upsertCustomerProfile({
        customerId: data.user.id,
        name: fullName,
        email: data.user.email || email,
        phone,
      });
    } catch (profileError) {
      logDeveloperError('Customer profile create after signup failed.', profileError);
      throw profileError;
    }
  } else if (data?.user && !data?.session) {
    console.info('[EastCord appointment automation] Email confirmation appears required before login.');
  }

  return data;
}

async function signInCustomer({ email, password }) {
  const client = getSupabaseClient();
  if (!client) throw new Error(ACCOUNT_SETUP_MESSAGE);

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    logSupabaseError('Supabase login failed.', error);
    throw new Error(getFriendlySupabaseError(error, 'Login could not be completed. Please check your email and password.'));
  }

  const profile = profileFromUser(data?.user);
  if (profile) await upsertCustomerProfile(profile);
  return data;
}

async function signOutCustomer() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  window.location.href = '/login.html';
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
    logDeveloperError('Auth navigation profile lookup failed.', error);
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

function setAuthMessage(message, type = '') {
  const authMessage = document.querySelector('[data-auth-message]');
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.className = `account-message ${type}`.trim();
}

function bindAuthForms() {
  const signupForm = document.querySelector('[data-signup-form]');
  const loginForm = document.querySelector('[data-login-form]');

  if (!isAuthConfigured() && (signupForm || loginForm)) {
    setAuthMessage(ACCOUNT_SETUP_MESSAGE, 'error');
  } else {
    setAuthMessage('');
  }

  signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    logAuthConfigStatus();

    if (!isAuthConfigured()) {
      setAuthMessage(ACCOUNT_SETUP_MESSAGE, 'error');
      logDeveloperError('Signup attempted before Supabase env vars were configured.', {
        supabaseUrlExists: Boolean(AUTH_CONFIG.supabaseUrl),
        supabaseAnonKeyExists: Boolean(AUTH_CONFIG.supabaseAnonKey),
        supabaseLibraryExists: Boolean(window.supabase),
      });
      return;
    }

    const formData = new FormData(signupForm);
    const password = formData.get('Password');
    const confirmPassword = formData.get('Confirm Password');

    if (password !== confirmPassword) {
      setAuthMessage('Passwords do not match.', 'error');
      return;
    }

    setAuthMessage('Creating your account...', 'success');

    try {
      const signupResult = await signUpCustomer({
        fullName: formData.get('Full Name'),
        email: formData.get('Email'),
        phone: formData.get('Phone'),
        password,
      });

      if (signupResult?.session) {
        setAuthMessage('Account created. Redirecting you back...', 'success');
        window.setTimeout(() => {
          goToRedirectTarget('/account.html');
        }, 800);
        return;
      }

      const redirectTarget = getRedirectTarget('/appointment.html?restore=appointment#appointment-booking');
      const loginUrl = `/login.html?redirect=${encodeURIComponent(redirectTarget)}`;
      setAuthMessage(`${EMAIL_CONFIRMATION_MESSAGE} After confirming, log in to continue your saved appointment.`, 'success');
      const messageElement = document.querySelector('[data-auth-message]');
      if (messageElement) {
        messageElement.insertAdjacentHTML('beforeend', ` <a href="${loginUrl}">Log in after confirming</a>`);
      }
    } catch (error) {
      setAuthMessage(error.message || 'Signup could not be completed.', 'error');
    }
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    logAuthConfigStatus();

    if (!isAuthConfigured()) {
      setAuthMessage(ACCOUNT_SETUP_MESSAGE, 'error');
      logDeveloperError('Login attempted before Supabase env vars were configured.', {
        supabaseUrlExists: Boolean(AUTH_CONFIG.supabaseUrl),
        supabaseAnonKeyExists: Boolean(AUTH_CONFIG.supabaseAnonKey),
        supabaseLibraryExists: Boolean(window.supabase),
      });
      return;
    }

    const formData = new FormData(loginForm);
    setAuthMessage('Logging you in...', 'success');

    try {
      await signInCustomer({
        email: formData.get('Email'),
        password: formData.get('Password'),
      });
      goToRedirectTarget('/account.html');
    } catch (error) {
      setAuthMessage(error.message || 'Login could not be completed.', 'error');
    }
  });
}

function renderBookingHistory(bookings) {
  if (!bookings.length) {
    return '<p class="empty-cart">No appointment bookings yet.</p>';
  }

  return bookings.map((booking) => {
    const vehicle = [booking.vehicle_year, booking.vehicle_make, booking.vehicle_model].filter(Boolean).join(' ');
    const plate = booking.vehicle_plate_number ? ` | Plate: ${escapeHtml(booking.vehicle_plate_number)}` : '';
    const colour = booking.vehicle_colour ? ` | Colour: ${escapeHtml(booking.vehicle_colour)}` : '';
    return `
      <article class="cart-line">
        <span>${escapeHtml(booking.booking_status || 'Pending Confirmation')}</span>
        <strong>${escapeHtml(booking.service_name)}</strong>
        <p>${escapeHtml(booking.preferred_date || '')}${booking.preferred_time_window ? ` at ${escapeHtml(booking.preferred_time_window)}` : ''}</p>
        <p>${escapeHtml(vehicle || 'Vehicle details submitted')}${plate}${colour}${booking.tire_size ? ` | ${escapeHtml(booking.tire_size)}` : ''}</p>
        <p>${escapeHtml(booking.city || '')}</p>
        <p>Service subtotal: ${money(booking.service_subtotal || 0)} | HST 13%: ${money(booking.hst_amount || 0)} | Total including HST: ${money(booking.total_with_hst || 0)}</p>
        <p>Deposit: ${money(booking.deposit_amount)} | Remaining on-site: ${money(booking.remaining_balance)} | Payment: ${escapeHtml(booking.payment_status || 'pending_checkout')}</p>
      </article>
    `;
  }).join('');
}

async function hydrateAccountPage() {
  const accountPanel = document.querySelector('[data-account-panel]');
  const bookingPanel = document.querySelector('[data-booking-history]');
  if (!accountPanel) return;

  if (!isAuthConfigured()) {
    accountPanel.innerHTML = `<p>${ACCOUNT_SETUP_MESSAGE}</p>`;
    if (bookingPanel) bookingPanel.innerHTML = '';
    return;
  }

  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      accountPanel.innerHTML = '<p>Please log in to view your account.</p><p><a class="button button-primary" href="/login.html?redirect=/account.html">Log In</a></p>';
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
    logDeveloperError('Account page hydration failed.', error);
    accountPanel.innerHTML = '<p>Account details could not be loaded right now. Please try again shortly.</p>';
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
  setupMessage: ACCOUNT_SETUP_MESSAGE,
};

document.addEventListener('DOMContentLoaded', () => {
  logAuthConfigStatus();
  preserveAuthSwitchLinks();
  bindAuthForms();
  bindLogoutButtons();
  hydrateAccountPage();
  updateAuthNavigation();
});