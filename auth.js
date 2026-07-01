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
const INVENTORY_SOURCE_URL = 'assets/inventory.json';
const EMPTY_INVENTORY_MESSAGE = 'Inventory will appear here once products are added.';

const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
});

let currentUser = null;
let inventory = [];
let inventoryLoaded = false;

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
    await loadInventory();
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

async function loadInventory() {
  try {
    const response = await fetch(INVENTORY_SOURCE_URL, { cache: 'no-store' });
    if (!response.ok) {
      inventory = [];
      return;
    }

    const data = await response.json();
    const records = Array.isArray(data) ? data : data.products || data.inventory || data.items || [];
    inventory = records.map(normalizeInventoryItem).filter(Boolean);
  } catch (_error) {
    inventory = [];
  } finally {
    inventoryLoaded = true;
  }
}

function normalizeInventoryItem(record, index) {
  if (!record || typeof record !== 'object') return null;

  const brand = clean(record.brand || record.Brand);
  const model = clean(record.model || record.Model);
  const size = clean(record.size || record.Size || record.tireSize || record['Tire Size']);
  const type = clean(record.type || record.Type || record.tireType || record['Tire Type'] || record.category || record.Category);
  const loadRating = clean(record.loadRating || record['Load Rating'] || record.load || record.Load || record.rating || record.Rating);
  const tag = clean(record.tag || record.Tag || record.category || record.Category);
  const details = clean(record.details || record.Details || record.description || record.Description || record.notes || record.Notes);
  const title = clean(record.title || record.Title || record.name || record.Name || record.productName || record['Product Name']);
  const price = parsePrice(record.price || record.Price || record.salePrice || record['Sale Price']);
  const stock = parseStock(record.stock || record.Stock || record.quantity || record.Quantity || record.qty || record.Qty);
  const sourceId = clean(record.id || record.ID || record.sku || record.SKU || record.productId || record['Product ID']);
  const displayTitle = title || [brand, model, size].filter(Boolean).join(' ');

  if (!displayTitle && !brand && !model && !size) return null;

  return {
    id: sourceId || `inventory-${index}`,
    type,
    title: displayTitle || 'Inventory item',
    brand,
    model,
    size,
    loadRating,
    price,
    stock,
    tag,
    details,
  };
}

function clean(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parsePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function parseStock(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function bindInventoryControls() {
  document.querySelector('#inventory-search')?.addEventListener('input', renderInventory);
  document.querySelector('#inventory-filter')?.addEventListener('change', renderInventory);
}

function renderInventory() {
  const list = document.querySelector('#inventory-list');
  if (!list) return;

  if (!inventoryLoaded) {
    list.innerHTML = '<p class="empty-cart">Loading inventory...</p>';
    return;
  }

  if (!inventory.length) {
    list.innerHTML = `<p class="empty-cart">${EMPTY_INVENTORY_MESSAGE}</p>`;
    return;
  }

  const search = document.querySelector('#inventory-search')?.value.trim().toLowerCase() ?? '';
  const filter = document.querySelector('#inventory-filter')?.value ?? 'all';

  const products = inventory.filter((item) => {
    const itemType = item.type.toLowerCase();
    const matchesType = filter === 'all' || itemType.includes(filter);
    const searchable = [item.title, item.brand, item.model, item.size, item.loadRating, item.tag, item.details]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return matchesType && searchable.includes(search);
  });

  if (!products.length) {
    list.innerHTML = '<p class="empty-cart">No tires match that search. Try another size, brand, or tire type.</p>';
    return;
  }

  list.innerHTML = products.map((item) => `
    <article class="product-card">
      <div>
        ${item.type ? `<span class="product-type">${escapeHtml(item.type)}</span>` : ''}
        <h3>${escapeHtml(item.title)}</h3>
        <div class="product-meta">
          ${item.size ? `<span>${escapeHtml(item.size)}</span>` : ''}
          ${item.brand ? `<span>${escapeHtml(item.brand)}</span>` : ''}
          ${item.model ? `<span>${escapeHtml(item.model)}</span>` : ''}
          ${item.loadRating ? `<span>${escapeHtml(item.loadRating)}</span>` : ''}
          ${item.stock !== null ? `<span>${escapeHtml(String(item.stock))} in stock</span>` : ''}
          ${item.tag ? `<span>${escapeHtml(item.tag)}</span>` : ''}
        </div>
        ${item.details ? `<p>${escapeHtml(item.details)}</p>` : ''}
      </div>
      <div class="product-price">
        <strong>${formatPrice(item.price)}</strong>
        <button class="add-cart-button" type="button" data-add-to-cart="${escapeHtml(item.id)}" ${item.stock === 0 ? 'disabled' : ''}>Add to cart</button>
      </div>
    </article>
  `).join('');

  list.querySelectorAll('[data-add-to-cart]').forEach((button) => {
    button.addEventListener('click', () => addToCart(button.dataset.addToCart));
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(price) {
  return price === null ? 'Price pending' : money.format(price);
}

function addToCart(productId) {
  const item = inventory.find((product) => product.id === productId);
  if (!item || item.stock === 0) return;

  const cart = getCart();
  const existing = cart.find((cartItem) => cartItem.id === productId);

  if (existing) {
    existing.qty = item.stock === null ? existing.qty + 1 : Math.min(existing.qty + 1, item.stock);
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
        <strong>${escapeHtml(line.title)}</strong>
        <span>${[line.size, formatPrice(line.price)].filter(Boolean).map(escapeHtml).join(' - ')}</span>
      </div>
      <div class="cart-qty" aria-label="Quantity controls for ${escapeHtml(line.title)}">
        <button class="qty-button" type="button" data-cart-decrease="${escapeHtml(line.id)}">-</button>
        <span>${line.qty}</span>
        <button class="qty-button" type="button" data-cart-increase="${escapeHtml(line.id)}">+</button>
      </div>
    </div>
  `).join('');

  const hasPendingPrice = lines.some((line) => line.price === null);
  total.textContent = hasPendingPrice
    ? 'Price pending'
    : money.format(lines.reduce((sum, line) => sum + line.price * line.qty, 0));

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
      const maxQty = product?.stock ?? item.qty + change;
      return { ...item, qty: Math.min(Math.max(item.qty + change, 0), maxQty) };
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
    status.innerHTML = `Logged in as ${escapeHtml(currentUser.email)}. <button class="text-button" type="button" data-logout>Log out</button>`;
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
