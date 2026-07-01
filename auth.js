import {
  AuthError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  onAuthChange,
  signup,
} from 'https://esm.sh/@netlify/identity@1';

const CART_KEY = 'eastcord-cart';
const RETURN_KEY = 'eastcord-return-to';

const inventory = [
  {
    id: 'used-205-55r16-all-season',
    type: 'used',
    title: 'Used All-Season Tire',
    brand: 'Inspected passenger tire',
    size: '205/55R16',
    price: 60,
    stock: 8,
    details: 'Quality checked used passenger tire. Final availability is confirmed before payment.',
  },
  {
    id: 'used-225-65r17-all-season',
    type: 'used',
    title: 'Used All-Season Tire',
    brand: 'Inspected passenger tire',
    size: '225/65R17',
    price: 70,
    stock: 6,
    details: 'Inspected used tire option for passenger vehicles and SUVs.',
  },
  {
    id: 'new-205-55r16-touring',
    type: 'new',
    title: 'New Touring Tire',
    brand: 'Passenger touring tire',
    size: '205/55R16',
    price: 115,
    stock: 12,
    details: 'New passenger tire with dependable everyday performance.',
  },
  {
    id: 'new-225-65r17-all-season',
    type: 'new',
    title: 'New All-Season Tire',
    brand: 'Passenger all-season tire',
    size: '225/65R17',
    price: 145,
    stock: 10,
    details: 'New all-season passenger tire with long-lasting value.',
  },
];

const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
});

let currentUser = null;

init();

async function init() {
  await processAuthCallback();
  currentUser = await getUser();

  bindAuthForms();
  bindLogoutButtons();
  renderAuthStatus();

  if (document.querySelector('#inventory-list')) {
    bindInventoryControls();
    renderInventory();
    renderCart();
    bindCheckout();
    continuePendingCheckout();
  }

  onAuthChange((_event, user) => {
    currentUser = user;
    renderAuthStatus();
  });
}

async function processAuthCallback() {
  try {
    await handleAuthCallback();
  } catch (error) {
    showAuthMessage(formatAuthError(error), 'error');
  }
}

function bindInventoryControls() {
  document.querySelector('#inventory-search')?.addEventListener('input', renderInventory);
  document.querySelector('#inventory-filter')?.addEventListener('change', renderInventory);
}

function renderInventory() {
  const list = document.querySelector('#inventory-list');
  if (!list) return;

  const search = document.querySelector('#inventory-search')?.value.trim().toLowerCase() ?? '';
  const filter = document.querySelector('#inventory-filter')?.value ?? 'all';

  const products = inventory.filter((item) => {
    const matchesType = filter === 'all' || item.type === filter;
    const searchable = `${item.title} ${item.brand} ${item.size} ${item.details}`.toLowerCase();
    return matchesType && searchable.includes(search);
  });

  if (!products.length) {
    list.innerHTML = '<p class="empty-cart">No tires match that search. Try another size or tire type.</p>';
    return;
  }

  list.innerHTML = products.map((item) => `
    <article class="product-card">
      <div>
        <span class="product-type">${item.type === 'used' ? 'Used tire' : 'New tire'}</span>
        <h3>${item.title}</h3>
        <div class="product-meta">
          <span>${item.size}</span>
          <span>${item.brand}</span>
          <span>${item.stock} in stock</span>
        </div>
        <p>${item.details}</p>
      </div>
      <div class="product-price">
        <strong>${money.format(item.price)}</strong>
        <button class="add-cart-button" type="button" data-add-to-cart="${item.id}">Add to cart</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('[data-add-to-cart]').forEach((button) => {
    button.addEventListener('click', () => addToCart(button.dataset.addToCart));
  });
}

function addToCart(productId) {
  const item = inventory.find((product) => product.id === productId);
  if (!item) return;

  const cart = getCart();
  const existing = cart.find((cartItem) => cartItem.id === productId);

  if (existing) {
    existing.qty = Math.min(existing.qty + 1, item.stock);
  } else {
    cart.push({ id: productId, qty: 1 });
  }

  saveCart(cart);
  renderCart();
  showCheckoutMessage(`${item.title} added to cart.`, 'success');
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch (_error) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function getCartLines() {
  return getCart()
    .map((cartItem) => {
      const product = inventory.find((item) => item.id === cartItem.id);
      if (!product) return null;
      return { ...product, qty: cartItem.qty };
    })
    .filter(Boolean);
}

function renderCart() {
  const list = document.querySelector('#cart-items');
  const total = document.querySelector('#cart-total');
  if (!list || !total) return;

  const lines = getCartLines();
  if (!lines.length) {
    list.innerHTML = '<p class="empty-cart">Your cart is empty. Add a tire to continue.</p>';
    total.textContent = money.format(0);
    return;
  }

  list.innerHTML = lines.map((line) => `
    <div class="cart-item">
      <div>
        <strong>${line.title}</strong>
        <span>${line.size} - ${money.format(line.price)} each</span>
      </div>
      <div class="cart-qty" aria-label="Quantity controls for ${line.title}">
        <button class="qty-button" type="button" data-cart-decrease="${line.id}">-</button>
        <span>${line.qty}</span>
        <button class="qty-button" type="button" data-cart-increase="${line.id}">+</button>
      </div>
    </div>
  `).join('');

  total.textContent = money.format(lines.reduce((sum, line) => sum + line.price * line.qty, 0));

  list.querySelectorAll('[data-cart-decrease]').forEach((button) => {
    button.addEventListener('click', () => updateCartQty(button.dataset.cartDecrease, -1));
  });

  list.querySelectorAll('[data-cart-increase]').forEach((button) => {
    button.addEventListener('click', () => updateCartQty(button.dataset.cartIncrease, 1));
  });
}

function updateCartQty(productId, change) {
  const product = inventory.find((item) => item.id === productId);
  const cart = getCart()
    .map((item) => {
      if (item.id !== productId) return item;
      return { ...item, qty: Math.min(Math.max(item.qty + change, 0), product?.stock ?? item.qty) };
    })
    .filter((item) => item.qty > 0);

  saveCart(cart);
  renderCart();
}

function bindCheckout() {
  document.querySelector('#checkout-button')?.addEventListener('click', startCheckout);
}

async function continuePendingCheckout() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('checkout') !== '1') return;

  window.history.replaceState({}, document.title, `${window.location.pathname}#cart`);
  document.querySelector('#cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  currentUser = await getUser();
  if (currentUser) startCheckout();
}

async function startCheckout() {
  const lines = getCartLines();
  if (!lines.length) {
    showCheckoutMessage('Add at least one tire before checkout.', 'error');
    return;
  }

  currentUser = await getUser();
  if (!currentUser) {
    const returnTo = '/?checkout=1#cart';
    localStorage.setItem(RETURN_KEY, returnTo);
    window.location.href = `login.html?returnTo=${encodeURIComponent(returnTo)}`;
    return;
  }

  const token = getAccessToken(currentUser);
  if (!token) {
    showCheckoutMessage('Please log in again before checkout. Your session token could not be verified.', 'error');
    return;
  }

  showCheckoutMessage('Checking your account before checkout...', 'success');

  try {
    const response = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items: lines }),
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok && data.url) {
      window.location.href = data.url;
      return;
    }

    showCheckoutMessage(data.message || 'Checkout is not available yet. Please try again later.', response.status === 501 ? '' : 'error');
  } catch (_error) {
    showCheckoutMessage('Checkout could not be started. Please try again later.', 'error');
  }
}

function getAccessToken(user) {
  return user?.token?.access_token || user?.token?.accessToken || user?.access_token || user?.jwt || '';
}

function bindAuthForms() {
  const loginForm = document.querySelector('[data-login-form]');
  const signupForm = document.querySelector('[data-signup-form]');

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    showAuthMessage('Logging you in...', 'success');

    try {
      currentUser = await login(formData.get('email'), formData.get('password'));
      goToReturnUrl();
    } catch (error) {
      showAuthMessage(formatAuthError(error), 'error');
    }
  });

  signupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(signupForm);
    const password = formData.get('password');
    const confirmPassword = formData.get('confirm-password');

    if (password !== confirmPassword) {
      showAuthMessage('Passwords do not match.', 'error');
      return;
    }

    showAuthMessage('Creating your account...', 'success');

    try {
      currentUser = await signup(formData.get('email'), password, {
        full_name: formData.get('full-name'),
        phone: formData.get('phone'),
      });

      if (currentUser?.emailVerified) {
        goToReturnUrl();
        return;
      }

      showAuthMessage('Account created. Please check your email to confirm your account, then log in.', 'success');
    } catch (error) {
      showAuthMessage(formatAuthError(error), 'error');
    }
  });
}

function bindLogoutButtons() {
  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      await logout();
      currentUser = null;
      renderAuthStatus();
      showCheckoutMessage('You have been logged out. Login is required before checkout.', '');
    });
  });
}

function goToReturnUrl() {
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get('returnTo') || localStorage.getItem(RETURN_KEY) || '/';
  localStorage.removeItem(RETURN_KEY);
  window.location.href = returnTo;
}

function renderAuthStatus() {
  const status = document.querySelector('#auth-status');
  const authLink = document.querySelector('.cart-auth-link');
  if (!status) return;

  if (currentUser) {
    status.innerHTML = `Logged in as ${currentUser.email}. <button class="text-button" type="button" data-logout>Log out</button>`;
    if (authLink) authLink.textContent = 'Account ready';
    bindLogoutButtons();
    return;
  }

  status.textContent = 'Browsing as guest';
  if (authLink) authLink.textContent = 'Login';
}

function showCheckoutMessage(message, type = '') {
  const element = document.querySelector('#checkout-message');
  if (!element) return;
  element.textContent = message;
  element.className = `cart-note ${type}`.trim();
}

function showAuthMessage(message, type = '') {
  const element = document.querySelector('[data-auth-message]');
  if (!element) return;
  element.textContent = message;
  element.className = `auth-message ${type}`.trim();
}

function formatAuthError(error) {
  if (error instanceof AuthError) {
    if (error.status === 401) return 'Invalid email or password.';
    if (error.status === 403) return 'Signups are not currently available.';
    return error.message;
  }

  return 'Something went wrong. Please try again.';
}
