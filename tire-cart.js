const USED_TIRE_CART_KEY = 'eastcord_used_tire_cart_v1';
const TAX_RATE = 0.13;
const cartItemsEl = document.querySelector('[data-tire-cart-items]');
const cartTotalEl = document.querySelector('[data-tire-cart-total]');
const cartHstEl = document.querySelector('[data-tire-cart-hst]');
const cartGrandTotalEl = document.querySelector('[data-tire-cart-grand-total]');
const cartMessageEl = document.querySelector('[data-tire-cart-message]');
const reservationForm = document.querySelector('[data-tire-reservation-form]');
const reservationSubmit = document.querySelector('[data-tire-reservation-submit]');
const installationDirections = document.querySelector('[data-installation-directions]');
const checkoutAuth = document.querySelector('[data-tire-checkout-auth]');

let tireCart = readTireCart();
let currentProfile = null;
let authChecked = false;

function readTireCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(USED_TIRE_CART_KEY) || '[]');
    return normalizeTireCart(stored);
  } catch (error) {
    console.warn('[EastCord tire cart] Cart could not be read.', error);
    return [];
  }
}

function normalizeTireCart(items) {
  if (window.EastCordAccount?.normalizeUsedTireCartItems) {
    return window.EastCordAccount.normalizeUsedTireCartItems(items);
  }
  return Array.isArray(items)
    ? items.filter((item) => item?.type === 'used_tire' && item.inventoryId)
    : [];
}

function saveTireCart() {
  localStorage.setItem(USED_TIRE_CART_KEY, JSON.stringify(tireCart));
  updateCartCount();
  window.EastCordAccount?.saveCustomerCart?.('used_tire', tireCart).catch((error) => {
    console.warn('[EastCord tire cart] Account cart sync failed.', error);
    if (cartMessageEl) cartMessageEl.textContent = error.message;
  });
}

function updateCartCount() {
  const count = tireCart.reduce((total, item) => total + (Number(item.qty) || 0), 0);
  document.querySelectorAll('[data-cart-count]').forEach((element) => {
    element.textContent = count ? ` (${count})` : '';
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

function getCartSubtotal() {
  return tireCart.reduce(
    (total, item) => total + ((Number(item.unitPrice) || 0) * (Number(item.qty) || 0)),
    0,
  );
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getCartTotals() {
  const subtotal = roundMoney(getCartSubtotal());
  const hstAmount = roundMoney(subtotal * TAX_RATE);
  return {
    subtotal,
    hstAmount,
    totalWithHst: roundMoney(subtotal + hstAmount),
  };
}

function renderQuantityOptions(item) {
  const maxStock = Math.max(1, Math.min(Number(item.maxStock) || 1, 4));
  return Array.from({ length: maxStock }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}"${value === Number(item.qty) ? ' selected' : ''}>${value}</option>`;
  }).join('');
}

function renderTireCartItem(item) {
  const lineTotal = (Number(item.unitPrice) || 0) * (Number(item.qty) || 0);
  const availability = item.unavailable
    ? '<p class="tire-cart-unavailable">Currently unavailable — remove this tire before submitting.</p>'
    : '';

  return `
    <article class="tire-cart-item${item.unavailable ? ' is-unavailable' : ''}">
      <div>
        <h3>${escapeHtml(item.brand)} ${escapeHtml(item.size)}</h3>
        <dl class="tire-cart-item-summary">
          <div>
            <dt>Stock</dt>
            <dd>${escapeHtml(item.maxStock)} available</dd>
          </div>
          <div>
            <dt>Per tire</dt>
            <dd>${escapeHtml(formatMoney(item.unitPrice))}</dd>
          </div>
          <div>
            <dt>Total (${escapeHtml(item.qty)})</dt>
            <dd>${escapeHtml(formatMoney(lineTotal))}</dd>
          </div>
        </dl>
        ${availability}
      </div>
      <div class="tire-cart-item-controls">
        <label for="tire-cart-qty-${escapeHtml(item.inventoryId)}">Quantity</label>
        <select
          id="tire-cart-qty-${escapeHtml(item.inventoryId)}"
          data-tire-cart-qty="${escapeHtml(item.inventoryId)}"
          ${item.unavailable ? 'disabled' : ''}
        >${renderQuantityOptions(item)}</select>
        <button class="tire-cart-remove" type="button" data-remove-tire="${escapeHtml(item.inventoryId)}">Remove</button>
      </div>
    </article>
  `;
}

function renderTireCart() {
  if (cartItemsEl) {
    cartItemsEl.innerHTML = tireCart.length
      ? tireCart.map(renderTireCartItem).join('')
      : '<div class="tire-cart-empty">Your tire cart is empty. Search used tires to add a set.</div>';
  }

  const totals = getCartTotals();
  if (cartTotalEl) cartTotalEl.textContent = formatMoney(totals.subtotal);
  if (cartHstEl) cartHstEl.textContent = formatMoney(totals.hstAmount);
  if (cartGrandTotalEl) cartGrandTotalEl.textContent = formatMoney(totals.totalWithHst);
  if (reservationSubmit) {
    reservationSubmit.classList.toggle('is-signed-in', Boolean(currentProfile));
    reservationSubmit.classList.toggle('is-signed-out', !currentProfile);
    reservationSubmit.disabled = !authChecked
      || !currentProfile
      || !tireCart.length
      || tireCart.some((item) => item.unavailable);
  }
  updateCartCount();
}

function fillCustomerFields(profile) {
  if (!reservationForm || !profile) return;
  const values = {
    'Full Name': profile.name || '',
    'Email Address': profile.email || '',
    'Phone Number': profile.phone || '',
  };

  Object.entries(values).forEach(([name, value]) => {
    const input = reservationForm.elements.namedItem(name);
    if (input && !input.value) input.value = value;
  });
}

async function hydrateCustomerAccount() {
  try {
    currentProfile = await window.EastCordAccount?.getCurrentProfile?.();
  } catch (error) {
    console.warn('[EastCord tire cart] Customer profile could not be loaded.', error);
    currentProfile = null;
  } finally {
    authChecked = true;
  }

  if (currentProfile) {
    try {
      const loadedCart = await window.EastCordAccount.loadCustomerCart('used_tire', tireCart);
      const normalizedLoaded = normalizeTireCart(loadedCart);
      tireCart = normalizedLoaded.length || !tireCart.length
        ? normalizedLoaded
        : tireCart;
      localStorage.setItem(USED_TIRE_CART_KEY, JSON.stringify(tireCart));
    } catch (error) {
      console.warn('[EastCord tire cart] Saved account cart could not be loaded.', error);
      if (cartMessageEl) cartMessageEl.textContent = error.message;
    }
  }

  if (checkoutAuth) checkoutAuth.hidden = Boolean(currentProfile);
  if (currentProfile) fillCustomerFields(currentProfile);
  renderTireCart();
}

async function refreshCartAvailability() {
  if (!tireCart.length) return;

  try {
    const response = await fetch('/.netlify/functions/get-used-inventory');
    if (!response.ok) throw new Error(`Inventory request failed (${response.status})`);
    const rows = await response.json();
    const rowsById = new Map(rows.map((row) => [Number(row.id), row]));

    tireCart = tireCart.map((item) => {
      const row = rowsById.get(Number(item.inventoryId));
      const stock = Math.max(0, Number(row?.current_stock) || 0);
      if (!row || !stock) return { ...item, unavailable: true, maxStock: 0 };

      return {
        ...item,
        brand: row.brand || item.brand,
        maxStock: stock,
        qty: Math.min(Math.max(1, Number(item.qty) || 1), stock, 4),
        unitPrice: Number(row.selling_price),
        unavailable: false,
      };
    });
    saveTireCart();
  } catch (error) {
    console.warn('[EastCord tire cart] Live availability could not be checked.', error);
    if (cartMessageEl) {
      cartMessageEl.textContent = 'Live availability could not be checked. Please refresh before submitting.';
    }
  }
}

function getFormValue(name) {
  const field = reservationForm?.elements?.namedItem(name);
  return String(field?.value || '').trim();
}

reservationForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!currentProfile) {
    if (checkoutAuth) checkoutAuth.hidden = false;
    if (cartMessageEl) {
      cartMessageEl.textContent = 'Please sign up or log in before buying tires.';
    }
    return;
  }

  if (!tireCart.length || tireCart.some((item) => item.unavailable)) {
    if (cartMessageEl) {
      cartMessageEl.textContent = tireCart.length
        ? 'Remove unavailable tires before checkout.'
        : 'Add at least one tire before checkout.';
    }
    return;
  }

  const customer = {
    customerId: currentProfile.customerId,
    name: getFormValue('Full Name') || currentProfile.name,
    email: getFormValue('Email Address') || currentProfile.email,
    phone: getFormValue('Phone Number') || currentProfile.phone,
  };

  if (!customer.name || !customer.email || !customer.phone) {
    if (cartMessageEl) cartMessageEl.textContent = 'Please complete your name, email, and phone.';
    return;
  }

  try {
    if (reservationSubmit) {
      reservationSubmit.disabled = true;
      reservationSubmit.textContent = 'Opening Stripe...';
    }
    if (cartMessageEl) cartMessageEl.textContent = 'Checking stock and preparing secure checkout...';

    const token = await window.EastCordAccount.getAccessToken();
    const response = await fetch('/.netlify/functions/create-used-tire-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        items: tireCart,
        customer,
        fulfillmentPreference: getFormValue('Fulfillment Preference') || 'Pickup',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) {
      throw new Error(data.message || 'Secure checkout could not be started.');
    }
    window.location.href = data.url;
  } catch (error) {
    if (cartMessageEl) cartMessageEl.textContent = error.message || 'Secure checkout could not be started.';
    if (reservationSubmit) {
      reservationSubmit.textContent = 'Pay with Stripe';
      reservationSubmit.disabled = false;
    }
    renderTireCart();
  }
});

cartItemsEl?.addEventListener('change', (event) => {
  const select = event.target.closest('[data-tire-cart-qty]');
  if (!select) return;

  const item = tireCart.find(
    (entry) => Number(entry.inventoryId) === Number(select.dataset.tireCartQty),
  );
  if (!item) return;

  item.qty = Math.min(Math.max(1, Number(select.value) || 1), Number(item.maxStock) || 1, 4);
  saveTireCart();
  renderTireCart();
});

cartItemsEl?.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-tire]');
  if (!removeButton) return;

  tireCart = tireCart.filter(
    (item) => Number(item.inventoryId) !== Number(removeButton.dataset.removeTire),
  );
  saveTireCart();
  renderTireCart();
});

document.querySelector('[data-clear-tire-cart]')?.addEventListener('click', () => {
  tireCart = [];
  saveTireCart();
  renderTireCart();
});

reservationForm?.addEventListener('change', (event) => {
  if (event.target.name !== 'Fulfillment Preference') return;
  if (installationDirections) {
    installationDirections.hidden = event.target.value !== 'Installation';
  }
});

async function initTireCart() {
  renderTireCart();
  await hydrateCustomerAccount();
  await refreshCartAvailability();
  renderTireCart();
}

window.addEventListener('eastcord:account-carts-hydrated', (event) => {
  const incoming = normalizeTireCart(event.detail?.tireCart);
  if (!incoming.length && tireCart.length) return;
  if (!incoming.length) return;
  tireCart = incoming.length >= tireCart.length ? incoming : tireCart;
  localStorage.setItem(USED_TIRE_CART_KEY, JSON.stringify(tireCart));
  renderTireCart();
});

initTireCart();
