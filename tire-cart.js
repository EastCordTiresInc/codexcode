const USED_TIRE_CART_KEY = 'eastcord_used_tire_cart_v1';
const TIRE_CART_TAX_RATE = 0;

let tireCart = [];
let currentProfile = null;
let authChecked = false;

function cartItemsEl() {
  return document.querySelector('[data-tire-cart-items]');
}

function cartTotalEl() {
  return document.querySelector('[data-tire-cart-total]');
}

function cartHstEl() {
  return document.querySelector('[data-tire-cart-hst]');
}

function cartGrandTotalEl() {
  return document.querySelector('[data-tire-cart-grand-total]');
}

function cartMessageEl() {
  return document.querySelector('[data-tire-cart-message]');
}

function reservationForm() {
  return document.querySelector('[data-tire-reservation-form]');
}

function reservationSubmit() {
  return document.querySelector('[data-tire-reservation-submit]');
}

function installationDirections() {
  return document.querySelector('[data-installation-directions]');
}

function checkoutAuth() {
  return document.querySelector('[data-tire-checkout-auth]');
}

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

function countTireCart(items = tireCart) {
  return items.reduce((total, item) => total + (Number(item.qty) || 0), 0);
}

function adoptStoredTireCart() {
  const stored = readTireCart();
  if (!tireCart.length && stored.length) {
    tireCart = stored;
  }
  return tireCart;
}

function writeTireCart(nextCart, { allowEmpty = false } = {}) {
  const normalized = normalizeTireCart(nextCart);
  if (!normalized.length && !allowEmpty) {
    const stored = readTireCart();
    if (stored.length) {
      tireCart = stored;
      return tireCart;
    }
    if (tireCart.length) return tireCart;
  }
  tireCart = normalized;
  localStorage.setItem(USED_TIRE_CART_KEY, JSON.stringify(tireCart));
  return tireCart;
}

function saveTireCart() {
  writeTireCart(tireCart, { allowEmpty: !tireCart.length });
  updateCartCount();
  window.EastCordAccount?.notifyUsedTireCartChanged?.(tireCart);
  window.EastCordAccount?.saveCustomerCart?.('used_tire', tireCart, { allowEmpty: !tireCart.length }).catch((error) => {
    console.warn('[EastCord tire cart] Account cart sync failed.', error);
    const messageEl = cartMessageEl();
    if (messageEl) messageEl.textContent = error.message;
  });
}

function updateCartCount() {
  const count = countTireCart(adoptStoredTireCart());
  if (window.EastCordAccount?.updateCartCount) {
    window.EastCordAccount.updateCartCount();
  }
  document.querySelectorAll('[data-tire-cart-count]').forEach((element) => {
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
  const hstAmount = roundMoney(subtotal * TIRE_CART_TAX_RATE);
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

function getPricing() {
  return window.EastCordUsedTirePricing || {
    MARKDOWN_RATE: 0.15,
    MARKDOWN_PERCENT: 15,
    isMarkdownStock(stock) {
      const count = Math.max(0, Number(stock) || 0);
      return count > 0 && count < 4;
    },
    getUsedTireUnitPrice(listPrice, stock) {
      const price = Number(listPrice);
      if (!Number.isFinite(price) || price <= 0) return null;
      const rounded = Math.round(price * 100) / 100;
      return this.isMarkdownStock(stock) ? Math.round(price * 0.85 * 100) / 100 : rounded;
    },
  };
}

function renderTireCartItem(item) {
  const lineTotal = (Number(item.unitPrice) || 0) * (Number(item.qty) || 0);
  const markdown = Boolean(item.markdown) || getPricing().isMarkdownStock(item.maxStock);
  const listPrice = Number(item.listPrice);
  const availability = item.unavailable
    ? '<p class="tire-cart-unavailable">Currently unavailable — remove this tire before submitting.</p>'
    : '';
  const markdownNote = markdown && !item.unavailable
    ? '<p class="tire-cart-markdown">15% off low-stock tire</p>'
    : '';

  return `
    <article class="tire-cart-item${item.unavailable ? ' is-unavailable' : ''}${markdown ? ' is-markdown' : ''}">
      <div>
        <h3>${escapeHtml(item.brand)} ${escapeHtml(item.size)}</h3>
        ${markdownNote}
        <dl class="tire-cart-item-summary">
          <div>
            <dt>Per tire</dt>
            <dd>
              ${escapeHtml(formatMoney(item.unitPrice))}
              ${markdown && Number.isFinite(listPrice) && listPrice > Number(item.unitPrice)
    ? `<span class="tire-cart-was">Was ${escapeHtml(formatMoney(listPrice))}</span>`
    : ''}
            </dd>
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
  adoptStoredTireCart();
  const listEl = cartItemsEl();
  if (listEl) {
    if (!tireCart.length) {
      listEl.innerHTML = '<div class="tire-cart-empty">Your tire cart is empty. Search used tires to add a set.</div>';
    } else {
      listEl.innerHTML = tireCart.map((item) => {
        try {
          return renderTireCartItem(item);
        } catch (error) {
          console.warn('[EastCord tire cart] A cart item could not be displayed.', error, item);
          return `<article class="tire-cart-item"><div><h3>${escapeHtml(item?.brand || 'Used tire')} ${escapeHtml(item?.size || '')}</h3><p>This tire could not be fully displayed.</p></div><button class="tire-cart-remove" type="button" data-remove-tire="${escapeHtml(item?.inventoryId)}">Remove</button></article>`;
        }
      }).join('');
    }
  }

  const totals = getCartTotals();
  if (cartTotalEl()) cartTotalEl().textContent = formatMoney(totals.subtotal);
  if (cartHstEl()) cartHstEl().textContent = formatMoney(totals.hstAmount);
  if (cartGrandTotalEl()) cartGrandTotalEl().textContent = formatMoney(totals.totalWithHst);
  const submit = reservationSubmit();
  if (submit) {
    submit.disabled = !tireCart.length || tireCart.some((item) => item.unavailable);
  }
  updateCartCount();
}

function fillCustomerFields(profile) {
  const form = reservationForm();
  if (!form || !profile) return;
  const values = {
    'Full Name': profile.name || '',
    'Email Address': profile.email || '',
    'Phone Number': profile.phone || '',
  };

  Object.entries(values).forEach(([name, value]) => {
    if (!value) return;
    const input = form.elements.namedItem(name);
    if (input && 'value' in input) input.value = value;
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
      const loadedCart = await window.EastCordAccount.loadCustomerCart('used_tire', readTireCart());
      const merged = normalizeTireCart([
        ...(Array.isArray(loadedCart) ? loadedCart : []),
        ...readTireCart(),
        ...tireCart,
      ]);
      writeTireCart(merged);
    } catch (error) {
      console.warn('[EastCord tire cart] Saved account cart could not be loaded.', error);
      if (cartMessageEl()) cartMessageEl().textContent = error.message;
      adoptStoredTireCart();
    }
  }

  if (checkoutAuth()) checkoutAuth().hidden = Boolean(currentProfile);
  if (currentProfile) fillCustomerFields(currentProfile);
  renderTireCart();
}

async function refreshCartAvailability() {
  adoptStoredTireCart();
  if (!tireCart.length) return;

  try {
    const response = await fetch('/.netlify/functions/get-used-inventory');
    if (!response.ok) throw new Error(`Inventory request failed (${response.status})`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Inventory request failed.');
    const rowsById = new Map(rows.map((row) => [String(row.id), row]));

    writeTireCart(tireCart.map((item) => {
      const row = rowsById.get(String(item.inventoryId))
        || rowsById.get(String(item.inventoryId).replace(/^used-tire-/i, ''));
      const stock = Math.max(0, Number(row?.current_stock) || 0);
      if (!row || !stock) return { ...item, unavailable: true, maxStock: 0 };

      const listPrice = Number(row.selling_price);
      const unitPrice = getPricing().getUsedTireUnitPrice(listPrice, stock);
      const markdown = getPricing().isMarkdownStock(stock);

      return {
        ...item,
        brand: row.brand || item.brand,
        size: item.size || row.size_label || item.size,
        maxStock: stock,
        qty: Math.min(Math.max(1, Number(item.qty) || 1), stock, 4),
        listPrice,
        unitPrice,
        markdown,
        unavailable: false,
      };
    }));
    updateCartCount();
    window.EastCordAccount?.notifyUsedTireCartChanged?.(tireCart);
    window.EastCordAccount?.saveCustomerCart?.('used_tire', tireCart).catch((error) => {
      console.warn('[EastCord tire cart] Account cart sync failed.', error);
    });
  } catch (error) {
    console.warn('[EastCord tire cart] Live availability could not be checked.', error);
    if (cartMessageEl()) {
      cartMessageEl().textContent = 'Live availability could not be checked. Please refresh before submitting.';
    }
  }
}

function getFormValue(name) {
  const field = reservationForm()?.elements?.namedItem(name);
  return String(field?.value || '').trim();
}

function setCartMessage(message) {
  const messageEl = cartMessageEl();
  if (messageEl) messageEl.textContent = message;
}

function openMailApp(mailto) {
  const link = document.createElement('a');
  link.href = mailto;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showReservationFallback({ mailto, gmail, body, emailed }) {
  const fallback = document.querySelector('[data-reservation-fallback]');
  const status = document.querySelector('[data-reservation-fallback-status]');
  const mailtoLink = document.querySelector('[data-reservation-mailto]');
  const gmailLink = document.querySelector('[data-reservation-gmail]');
  const bodyEl = document.querySelector('[data-reservation-body]');
  if (!fallback) return;

  fallback.hidden = false;
  if (status) {
    status.textContent = emailed
      ? 'EastCord Tires has received this request. You can still copy it for your records.'
      : 'This computer has no email app set as default. Open Gmail or copy the message and send it to info@eastcordtires.ca.';
  }
  if (mailtoLink) mailtoLink.href = mailto;
  if (gmailLink) gmailLink.href = gmail;
  if (bodyEl) bodyEl.value = `To: info@eastcordtires.ca\nSubject: Used tire reservation request\n\n${body}`;
}

function sameCartItemId(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function bindCartEvents() {
  reservationForm()?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!tireCart.length || tireCart.some((item) => item.unavailable)) {
      setCartMessage(tireCart.length
        ? 'Remove unavailable tires before sending this request.'
        : 'Add at least one tire before sending this request.');
      return;
    }

    const customer = {
      name: getFormValue('Full Name') || currentProfile?.name || '',
      email: getFormValue('Email Address') || currentProfile?.email || '',
      phone: getFormValue('Phone Number') || currentProfile?.phone || '',
    };

    if (!customer.name || !customer.email || !customer.phone) {
      setCartMessage('Please complete your name, email, and phone.');
      return;
    }

    const totals = getCartTotals();
    const itemLines = tireCart.map((item) => (
      `${item.qty} x ${item.brand || ''} ${item.size || ''} (ID ${item.inventoryId})`
    ));
    const body = [
      `Name: ${customer.name}`,
      `Email: ${customer.email}`,
      `Phone: ${customer.phone}`,
      `Fulfillment: ${getFormValue('Fulfillment Preference') || 'Pickup'}`,
      '',
      'Tires:',
      ...itemLines,
      '',
      `Subtotal: ${formatMoney(totals.subtotal)}`,
      `Total: ${formatMoney(totals.totalWithHst)}`,
    ].join('\n');

    const subject = 'Used tire reservation request';
    const mailto = [
      'mailto:info@eastcordtires.ca',
      '?subject=',
      encodeURIComponent(subject),
      '&body=',
      encodeURIComponent(body),
    ].join('');
    const gmail = [
      'https://mail.google.com/mail/?view=cm&fs=1&tf=1',
      '&to=',
      encodeURIComponent('info@eastcordtires.ca'),
      '&su=',
      encodeURIComponent(subject),
      '&body=',
      encodeURIComponent(body),
    ].join('');

    const submit = reservationSubmit();
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Sending request...';
    }

    let emailed = false;
    try {
      const response = await fetch('/.netlify/functions/request-used-tire-reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          fulfillment: getFormValue('Fulfillment Preference') || 'Pickup',
          items: tireCart,
          totals: {
            subtotal: formatMoney(totals.subtotal),
            hst: formatMoney(totals.hstAmount),
            total: formatMoney(totals.totalWithHst),
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      emailed = Boolean(response.ok && data.emailed);
    } catch (error) {
      emailed = false;
    }

    showReservationFallback({ mailto, gmail, body, emailed });
    if (!emailed) {
      openMailApp(mailto);
    }
    setCartMessage(emailed
      ? 'Reservation request sent to EastCord Tires.'
      : 'If your email app did not open, use Gmail or copy the message below.');

    if (submit) {
      submit.disabled = !tireCart.length;
      submit.textContent = 'Email reservation request';
    }
    renderTireCart();
  });

  cartItemsEl()?.addEventListener('change', (event) => {
    const select = event.target.closest('[data-tire-cart-qty]');
    if (!select) return;

    const item = tireCart.find((entry) => sameCartItemId(entry.inventoryId, select.dataset.tireCartQty));
    if (!item) return;

    item.qty = Math.min(Math.max(1, Number(select.value) || 1), Number(item.maxStock) || 1, 4);
    saveTireCart();
    renderTireCart();
  });

  cartItemsEl()?.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-tire]');
    if (!removeButton) return;

    tireCart = tireCart.filter((item) => !sameCartItemId(item.inventoryId, removeButton.dataset.removeTire));
    saveTireCart();
    renderTireCart();
  });

  document.querySelector('[data-clear-tire-cart]')?.addEventListener('click', () => {
    tireCart = [];
    saveTireCart();
    renderTireCart();
  });

  reservationForm()?.addEventListener('change', (event) => {
    if (event.target.name !== 'Fulfillment Preference') return;
    const directions = installationDirections();
    if (directions) directions.hidden = event.target.value !== 'Installation';
  });

  document.querySelector('[data-reservation-copy]')?.addEventListener('click', async () => {
    const bodyEl = document.querySelector('[data-reservation-body]');
    const text = bodyEl?.value || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCartMessage('Message copied. Paste it into an email to info@eastcordtires.ca.');
    } catch (error) {
      bodyEl?.select();
      setCartMessage('Select the message and copy it, then email info@eastcordtires.ca.');
    }
  });
}

async function initTireCart() {
  bindCartEvents();
  tireCart = readTireCart();
  renderTireCart();
  await hydrateCustomerAccount();
  await refreshCartAvailability();
  renderTireCart();
  startCartAvailabilityRefresh();
}

function applyIncomingTireCart(incoming) {
  writeTireCart([
    ...tireCart,
    ...normalizeTireCart(incoming),
    ...readTireCart(),
  ]);
  renderTireCart();
}

function startCartAvailabilityRefresh() {
  window.setInterval(() => {
    if (document.hidden) return;
    refreshCartAvailability().then(() => renderTireCart());
  }, 8000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refreshCartAvailability().then(() => renderTireCart());
  });
}

window.addEventListener('eastcord:account-carts-hydrated', (event) => {
  applyIncomingTireCart(event.detail?.tireCart);
});

window.addEventListener('eastcord:used-tire-cart-changed', (event) => {
  applyIncomingTireCart(event.detail?.tireCart || readTireCart());
});

window.addEventListener('storage', (event) => {
  if (event.key !== USED_TIRE_CART_KEY) return;
  tireCart = readTireCart();
  renderTireCart();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTireCart, { once: true });
} else {
  initTireCart();
}
