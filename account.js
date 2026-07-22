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

async function getCurrentUser() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data?.user || null;
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

async function getCurrentProfile() {
  return profileFromUser(await getCurrentUser());
}

async function signUpCustomer({ fullName, email, phone, password }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Signup is not connected yet. Add Supabase URL and anon key in auth-config.js or Netlify environment setup.');
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
  return data;
}

async function signInCustomer({ email, password }) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Login is not connected yet. Add Supabase URL and anon key in auth-config.js or Netlify environment setup.');
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
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
  const profile = await getCurrentProfile();
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

async function hydrateAccountPage() {
  const accountPanel = document.querySelector('[data-account-panel]');
  if (!accountPanel) return;

  if (!isAuthConfigured()) {
    accountPanel.innerHTML = '<p>Account login is prepared but not connected yet. Add Supabase configuration before customer accounts can be used.</p>';
    return;
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    accountPanel.innerHTML = '<p>Please log in to view your account.</p><p><a class="button button-primary" href="/login?redirect=/account">Log In</a></p>';
    return;
  }

  accountPanel.innerHTML = `
    <div class="account-detail"><span>Name</span><strong>${profile.name || 'Not provided'}</strong></div>
    <div class="account-detail"><span>Email</span><strong>${profile.email}</strong></div>
    <div class="account-detail"><span>Phone</span><strong>${profile.phone || 'Not provided'}</strong></div>
  `;
}

function bindLogoutButtons() {
  document.querySelectorAll('[data-logout-button]').forEach((button) => {
    button.addEventListener('click', signOutCustomer);
  });
}

window.EastCordAccount = {
  isAuthConfigured,
  getCurrentProfile,
  getCart,
  saveCart,
  clearCart,
  money,
};

document.addEventListener('DOMContentLoaded', () => {
  bindAuthForms();
  bindLogoutButtons();
  hydrateAccountPage();
  updateAuthNavigation();
});
