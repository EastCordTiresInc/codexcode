const USED_TIRE_CART_KEY = 'eastcord_used_tire_cart_v1';
const TIRE_CART_TAX_RATE = 0;
const INSTALL_TAX_RATE = 0.13;
const INSTALL_ARRIVAL_START_MINUTES = 13 * 60;
const INSTALL_TIME_WINDOWS = [
  '8:00 AM - 9:00 AM',
  '9:00 AM - 10:00 AM',
  '10:00 AM - 11:00 AM',
  '11:00 AM - 12:00 PM',
  '12:00 PM - 1:00 PM',
  '1:00 PM - 2:00 PM',
  '2:00 PM - 3:00 PM',
  '3:00 PM - 4:00 PM',
  '4:00 PM - 5:00 PM',
  '5:00 PM - 6:00 PM',
  '6:00 PM - 7:00 PM',
  '7:00 PM - 8:00 PM',
];

let tireCart = [];
let currentProfile = null;
let authChecked = false;
let installLocation = '';

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

function checkoutButtonEl() {
  return document.querySelector('[data-tire-checkout-button]');
}

function selectedFulfillment() {
  const selected = reservationForm()?.querySelector('input[name="Fulfillment Preference"]:checked');
  return selected?.value || '';
}

function shopInstallSelected() {
  return selectedFulfillment() === 'Installation' && installLocation === 'shop';
}

function updateTireCheckoutButtonState() {
  const button = checkoutButtonEl();
  if (!button) return;
  const cartReady = Boolean(tireCart.length) && !tireCart.some((item) => item.unavailable);
  const pickup = selectedFulfillment() === 'Pickup';
  const quote = shopInstallSelected() ? offRimInstallQuote() : null;
  button.hidden = !(pickup || shopInstallSelected());
  button.disabled = !cartReady || (quote && !quote.ok);
  if (!button.dataset.busy) button.textContent = 'ORDER';
}

function earliestInstallDateValue() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function timeWindowStartMinutes(value) {
  const match = String(value || '').split('-')[0].trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  return (hours * 60) + minutes;
}

function offRimInstallQuote() {
  const api = window.EastCordAppointmentServices;
  const available = tireCart.filter((item) => !item.unavailable && Number(item.qty) > 0);
  if (!available.length) return { ok: false, message: 'Add a tire so the off-rim swap can use its rim size and quantity.' };
  const groups = new Map();
  for (const item of available) {
    const bandId = api?.sizeBandFromTireSize?.(item.size) || '';
    const band = bandId ? api.SIZE_BANDS[bandId] : null;
    if (!band) {
      return { ok: false, message: `Off-rim swap prices cover 14 to 24 inch rims. The selected size is ${item.size || 'unknown'}.` };
    }
    const qty = Math.max(1, Math.min(4, Number(item.qty) || 1));
    const current = groups.get(bandId) || { band, qty: 0, sizes: [] };
    current.qty += qty;
    if (!current.sizes.includes(item.size)) current.sizes.push(item.size);
    groups.set(bandId, current);
  }
  const lines = [...groups.values()].map((group) => ({
    ...group,
    unitPrice: group.band.unitPrice,
    subtotal: roundMoney(group.band.unitPrice * group.qty),
  }));
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));
  const hst = roundMoney(subtotal * INSTALL_TAX_RATE);
  return {
    ok: true,
    lines,
    subtotal,
    hst,
    total: roundMoney(subtotal + hst),
  };
}

function renderInstallPrice() {
  const box = document.querySelector('[data-install-price]');
  if (!box) return;
  const quote = offRimInstallQuote();
  renderSelectedTires();
  if (!quote.ok) {
    box.innerHTML = `<p>${escapeHtml(quote.message)}</p>`;
    return;
  }
  const rows = quote.lines.map((line) => `
    <div><dt>Rim size</dt><dd>${escapeHtml(line.band.label)}</dd></div>
    <div><dt>Tire size</dt><dd>${escapeHtml(line.sizes.join(', '))}</dd></div>
    <div><dt>Price</dt><dd>${escapeHtml(formatMoney(line.unitPrice))} per tire</dd></div>
    <div><dt>Quantity</dt><dd>${line.qty}</dd></div>
  `).join('');
  box.innerHTML = `
    <p class="new-tire-install-price-title">Off-rim swap + balance</p>
    <dl>
      ${rows}
      <div><dt>Subtotal</dt><dd>${escapeHtml(formatMoney(quote.subtotal))}</dd></div>
      <div><dt>HST (13%)</dt><dd>${escapeHtml(formatMoney(quote.hst))}</dd></div>
      <div class="is-total"><dt>Total</dt><dd>${escapeHtml(formatMoney(quote.total))}</dd></div>
    </dl>
  `;
}

function renderSelectedTires() {
  const article = document.querySelector('[data-used-tire-selected]');
  const label = document.querySelector('[data-used-tire-selected-label]');
  const plus = document.querySelector('.tire-reservation-panel .new-tire-shop-plus');
  if (!article || !label) return;
  const items = tireCart.filter((item) => !item.unavailable && Number(item.qty) > 0);
  article.hidden = !items.length;
  if (plus) plus.hidden = !items.length;
  const title = article.querySelector('span');
  if (title) title.textContent = items.length > 1 ? 'Selected tires' : 'Selected tire';
  label.innerHTML = items.map((item) => {
    const rows = [
      ['Brand', item.brand || '—'],
      ...(item.model ? [['Model', item.model]] : []),
      ['Size', item.size || '—'],
      ['Quantity', String(item.qty)],
      ['Price', formatMoney(itemLineTotal(item))],
    ];
    return rows.map(([name, value]) => (
      `<div class="new-tire-selected-row"><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )).join('');
  }).join('');
}

function renderCheckoutSummary() {
  const summary = document.querySelector('.tire-reservation-panel > .new-tire-price-summary dl');
  const installSummary = document.querySelector('[data-install-price-summary]');
  const tires = getCartTotals();
  if (!shopInstallSelected()) {
    if (installSummary) installSummary.hidden = true;
    if (!summary) return;
    summary.innerHTML = `
      <div><dt>Subtotal</dt><dd data-tire-cart-total>${escapeHtml(formatMoney(tires.subtotal))}</dd></div>
      <div><dt>HST</dt><dd data-tire-cart-hst>${escapeHtml(formatMoney(tires.hstAmount))}</dd></div>
      <div class="is-total"><dt>Total</dt><dd data-tire-cart-grand-total>${escapeHtml(formatMoney(tires.totalWithHst))}</dd></div>
    `;
    return;
  }
  const quote = offRimInstallQuote();
  const install = quote.ok ? quote.total : 0;
  const total = roundMoney(tires.subtotal + install);
  if (summary) {
    summary.innerHTML = `
      <div><dt>Selected tire</dt><dd data-tire-cart-total>${escapeHtml(formatMoney(tires.subtotal))}</dd></div>
      <div><dt>Off-rim swap + balance</dt><dd>${escapeHtml(formatMoney(install))}</dd></div>
      <div class="is-total"><dt>Total</dt><dd data-tire-cart-grand-total>${escapeHtml(formatMoney(total))}</dd></div>
    `;
  }
  if (!installSummary) return;
  installSummary.hidden = !quote.ok;
  if (!quote.ok) return;
  installSummary.innerHTML = `
    <p class="new-tire-install-price-title">Price summary</p>
    <dl>
      <div><dt>${tires.subtotal && tireCart.filter((item) => !item.unavailable && Number(item.qty) > 0).length > 1 ? 'Selected tires' : 'Selected tire'}</dt><dd>${escapeHtml(formatMoney(tires.subtotal))}</dd></div>
      <div><dt>Off-rim swap + balance</dt><dd>${escapeHtml(formatMoney(install))}</dd></div>
      <div class="is-total"><dt>Total</dt><dd>${escapeHtml(formatMoney(total))}</dd></div>
    </dl>
  `;
}

function syncInstallTimes() {
  const dateInput = document.querySelector('[data-install-date]');
  const timeSelect = document.querySelector('[data-install-time]');
  const list = document.querySelector('[data-install-time-list]');
  const toggle = document.querySelector('[data-install-time-toggle]');
  if (!dateInput || !timeSelect || !list || !toggle) return;
  const min = earliestInstallDateValue();
  dateInput.min = min;
  if (dateInput.value && dateInput.value < min) dateInput.value = '';
  const arrivalDay = dateInput.value === min;
  const current = timeSelect.value;
  timeSelect.innerHTML = ['<option value="">Select a time</option>'].concat(INSTALL_TIME_WINDOWS.map((slot) => {
    const start = timeWindowStartMinutes(slot);
    const tooEarly = arrivalDay && start !== null && start < INSTALL_ARRIVAL_START_MINUTES;
    const label = tooEarly ? `${slot} (from 1:00 PM)` : slot;
    return `<option value="${slot}"${tooEarly ? ' disabled' : ''}>${label}</option>`;
  })).join('');
  if ([...timeSelect.options].some((option) => option.value === current && !option.disabled)) timeSelect.value = current;
  list.innerHTML = [...timeSelect.options].filter((option) => option.value).map((option) => (
    `<button type="button" class="new-tire-time-option${option.disabled ? ' is-disabled' : ''}${option.selected ? ' is-selected' : ''}" data-time-value="${escapeHtml(option.value)}"${option.disabled ? ' disabled' : ''}>${escapeHtml(option.textContent)}</button>`
  )).join('');
  const selected = timeSelect.selectedOptions[0];
  toggle.textContent = selected?.value ? selected.textContent : 'Select a time';
}

function syncInstallPanel() {
  const installing = selectedFulfillment() === 'Installation';
  const showShop = shopInstallSelected();
  const locationPanel = document.querySelector('[data-install-location-panel]');
  if (locationPanel) locationPanel.hidden = !installing;
  document.querySelectorAll('[data-install-location-option]').forEach((button) => {
    const selected = installing && button.dataset.installLocationOption === installLocation;
    button.classList.toggle('is-selected', selected);
    if (!button.disabled) button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  document.querySelector('.tire-reservation-panel')?.classList.toggle('is-installing', installing);
  document.querySelector('.tire-reservation-panel')?.classList.toggle('is-shop-booking', showShop);
  const customer = document.querySelector('[data-summary-customer]');
  const booking = document.querySelector('[data-shop-booking]');
  const details = document.querySelector('[data-shop-install-details]');
  const showCustomer = installing || selectedFulfillment() === 'Pickup';
  if (customer) customer.hidden = !showCustomer;
  if (booking) booking.hidden = !showShop;
  if (details) details.hidden = !showShop;
  if (showCustomer && currentProfile) fillCustomerFields(currentProfile);
  if (showShop) {
    syncInstallTimes();
    renderInstallPrice();
  }
  renderCheckoutSummary();
  updateTireCheckoutButtonState();
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
  if (stored.length >= tireCart.length) {
    tireCart = stored;
  } else if (!tireCart.length && stored.length) {
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
  if (window.EastCordAccount?.updateCartCount) {
    window.EastCordAccount.updateCartCount();
    return;
  }
  const count = countTireCart(adoptStoredTireCart());
  document.querySelectorAll('[data-tire-cart-count]').forEach((element) => {
    element.textContent = count ? ` (${count})` : '';
  });
  document.querySelectorAll('[data-appointment-cart-count]').forEach((element) => {
    element.textContent = '';
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

function itemLineTotal(item) {
  if (item?.priceIsFinal && Number(item.listPrice) > 0 && Number(item.maxStock) > 0) {
    const pricing = getPricing();
    if (pricing.priceForSetQuantity) {
      const setCount = pricing.listedSetCount ? pricing.listedSetCount(item.maxStock) : item.maxStock;
      return pricing.priceForSetQuantity(item.listPrice, setCount, item.qty) || 0;
    }
  }
  return (Number(item.unitPrice) || 0) * (Number(item.qty) || 0);
}

function getCartSubtotal() {
  return tireCart.reduce((total, item) => total + itemLineTotal(item), 0);
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
  const available = Math.max(1, Number(item.maxStock) || 1);
  const maxStock = item.priceIsFinal ? available : Math.min(available, 4);
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
    listedSetCount(stock) {
      const count = Math.max(0, Number(stock) || 0);
      if (!count) return 0;
      return count >= 4 ? 4 : count;
    },
    unitPriceFromSet(setPrice, stock) {
      const count = this.listedSetCount(stock);
      const price = Number(setPrice);
      if (!Number.isFinite(price) || price <= 0 || !count) return null;
      return Math.round((price / count) * 100) / 100;
    },
    priceForSetQuantity(setPrice, stock, qty) {
      const price = Number(setPrice);
      const count = Math.max(0, Number(stock) || 0);
      const amount = Math.max(0, Number(qty) || 0);
      if (!Number.isFinite(price) || price <= 0 || !count || !amount) return null;
      if (amount === count) return Math.round(price * 100) / 100;
      return Math.round((price * amount) / count * 100) / 100;
    },
  };
}

function renderTireCartItem(item) {
  const lineTotal = itemLineTotal(item);
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
        <h3>${escapeHtml([item.brand, item.model, item.size].filter(Boolean).join(' '))}</h3>
        ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
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

  syncInstallPanel();
  updateCartCount();
}

function fillCustomerFields(profile) {
  const form = reservationForm();
  if (!form || !profile) return;
  const parts = String(profile.name || '').trim().split(/\s+/).filter(Boolean);
  const first = form.querySelector('[data-customer-first]');
  const last = form.querySelector('[data-customer-last]');
  const email = form.querySelector('[data-customer-email]');
  const phone = form.querySelector('[data-customer-phone]');
  if (first && !first.value && parts[0]) first.value = parts[0];
  if (last && !last.value && parts.length > 1) last.value = parts.slice(1).join(' ');
  if (email && !email.value && profile.email) email.value = profile.email;
  if (phone && !phone.value && profile.phone) phone.value = profile.phone;
}

function readCheckoutCustomer(profile) {
  const first = getFormValue('First Name');
  const last = getFormValue('Last Name');
  const email = getFormValue('Email Address') || profile?.email || '';
  const phone = getFormValue('Phone Number') || profile?.phone || '';
  const contact = getFormValue('Preferred Contact');
  const name = `${first} ${last}`.trim();
  if (!first || !last) return { ok: false, message: 'Enter your first and last name before payment.', focus: '[data-customer-first]' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Enter a valid email address before payment.', focus: '[data-customer-email]' };
  if (phone.replace(/\D/g, '').length < 10) return { ok: false, message: 'Enter a phone number with at least 10 digits before payment.', focus: '[data-customer-phone]' };
  if (contact !== 'email' && contact !== 'phone') return { ok: false, message: 'Choose email or phone as the way to reach you.', focus: '[data-customer-contact]' };
  return {
    ok: true,
    customer: {
      customerId: profile?.customerId || profile?.id || '',
      name,
      email,
      phone,
      contact,
    },
  };
}

function readInstallCustomer(profile) {
  const ready = readCheckoutCustomer(profile);
  if (!ready.ok) return ready;
  const plate = getFormValue('Vehicle Plate Number').toUpperCase();
  const date = getFormValue('Preferred Date');
  const time = getFormValue('Preferred Time Window');
  if (plate.length < 2) return { ok: false, message: 'Enter the license plate for this installation.', focus: '[data-install-plate]' };
  if (!date || date < earliestInstallDateValue() || !time) {
    return { ok: false, message: 'Choose an appointment date and time before payment.', focus: '[data-install-date]' };
  }
  const arrivalDay = date === earliestInstallDateValue();
  const start = timeWindowStartMinutes(time);
  if (!INSTALL_TIME_WINDOWS.includes(time) || (arrivalDay && start !== null && start < INSTALL_ARRIVAL_START_MINUTES)) {
    return { ok: false, message: 'The first installation day starts at 1:00 PM. Choose a later time.', focus: '[data-install-time-toggle]' };
  }
  return {
    ok: true,
    customer: ready.customer,
    installation: {
      location: 'shop',
      plate,
      date,
      time,
      contact: ready.customer.contact,
    },
  };
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
      const priceIsFinal = row.price_is_final === true || String(row.price_is_final || '').toLowerCase() === 'true';
      const unitPrice = priceIsFinal
        ? getPricing().unitPriceFromSet?.(listPrice, stock) ?? null
        : getPricing().getUsedTireUnitPrice(listPrice, stock);
      const markdown = priceIsFinal ? false : getPricing().isMarkdownStock(stock);

      return {
        ...item,
        brand: row.brand || item.brand,
        model: row.model || item.model || '',
        note: row.note || item.note || '',
        priceIsFinal,
        size: item.size || row.size_label || item.size,
        maxStock: stock,
        qty: Math.min(Math.max(1, Number(item.qty) || 1), priceIsFinal ? stock : Math.min(stock, 4)),
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

async function startTireStripeCheckout() {
  if (!tireCart.length || tireCart.some((item) => item.unavailable)) {
    setCartMessage(tireCart.length
      ? 'Remove unavailable tires before paying.'
      : 'Add at least one tire before paying.');
    return;
  }

  const profile = currentProfile || await window.EastCordAccount?.getCurrentProfile?.().catch(() => null);
  let installation = null;
  let ready = readCheckoutCustomer(profile);
  if (selectedFulfillment() === 'Installation') {
    if (installLocation !== 'shop') {
      setCartMessage('Choose the EastCord shop before ordering installation.');
      return;
    }
    ready = readInstallCustomer(profile);
  }
  if (!ready.ok) {
    setCartMessage(ready.message);
    document.querySelector(ready.focus || '[data-customer-first]')?.focus();
    return;
  }
  const customer = ready.customer;
  installation = ready.installation || null;

  const button = checkoutButtonEl();
  if (button) {
    button.disabled = true;
    button.textContent = 'Preparing Stripe checkout...';
  }
  setCartMessage('Saving the order and opening Stripe test checkout...');

  try {
    const token = await window.EastCordAccount?.getAccessToken?.();
    const response = await fetch('/.netlify/functions/create-used-tire-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        customer,
        items: tireCart,
        fulfillmentPreference: selectedFulfillment() || 'Pickup',
        installation,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) {
      throw new Error(data.message || 'Stripe checkout could not be started.');
    }
    window.location.href = data.url;
  } catch (error) {
    setCartMessage(error.message || 'Stripe checkout could not be started.');
    if (button) {
      button.textContent = 'ORDER';
      updateTireCheckoutButtonState();
    }
  }
}

function sameCartItemId(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function bindCartEvents() {
  checkoutButtonEl()?.addEventListener('click', startTireStripeCheckout);

  reservationForm()?.addEventListener('submit', (event) => {
    event.preventDefault();
    startTireStripeCheckout();
  });

  reservationForm()?.addEventListener('click', (event) => {
    const info = event.target.closest('[data-choice-info]');
    if (info) {
      event.preventDefault();
      event.stopPropagation();
      const tip = document.getElementById(info.getAttribute('aria-controls'));
      if (!tip) return;
      const open = tip.hidden;
      tip.hidden = !open;
      info.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }

    const location = event.target.closest('[data-install-location-option]');
    if (location && !location.disabled) {
      installLocation = location.dataset.installLocationOption === 'shop' ? 'shop' : '';
      syncInstallPanel();
      return;
    }

    const timeToggle = event.target.closest('[data-install-time-toggle]');
    if (timeToggle) {
      const list = document.querySelector('[data-install-time-list]');
      if (!list) return;
      const open = list.hidden;
      list.hidden = !open;
      timeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }

    const timeOption = event.target.closest('[data-time-value]');
    if (timeOption && !timeOption.disabled) {
      const timeSelect = document.querySelector('[data-install-time]');
      const list = document.querySelector('[data-install-time-list]');
      const toggle = document.querySelector('[data-install-time-toggle]');
      if (timeSelect) timeSelect.value = timeOption.dataset.timeValue || '';
      if (list) list.hidden = true;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      syncInstallTimes();
    }
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
    if (event.target.name === 'Fulfillment Preference' && event.target.value !== 'Installation') {
      installLocation = '';
    }
    if (event.target.name === 'Fulfillment Preference' || event.target.matches('[data-install-date]')) {
      syncInstallPanel();
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
