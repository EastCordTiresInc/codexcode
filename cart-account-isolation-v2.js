(() => {
  const ACTIVE_CART_KEY = 'eastcord_cart_v1';
  const STALE_CART_KEY = 'eastcord_stale_cart_v1';
  const ACTIVE_CUSTOMER_KEY = 'eastcord_active_customer_v1';
  const ACCOUNT_CART_PREFIX = 'eastcord_cart_v1_account_';
  const CART_KEYS = [ACTIVE_CART_KEY, 'cart', 'eastcord_cart', 'appointment_cart', 'eastcord_appointment_cart', 'eastcord_appointment_cart_v1'];
  const DRAFT_KEYS = ['eastcord_pending_appointment_v1', 'eastcord_auth_redirect', 'pendingAppointment', 'pending_appointment', 'appointmentDraft', 'savedAppointment', 'eastcord_appointment_draft', 'eastcord_saved_appointment'];
  const TAX_RATE = 0.13;
  const ACCOUNT_MISMATCH_MESSAGE = 'This appointment was created under a different account. Please log in with the original email used for this booking, or remove this appointment and start a new one.';
  const SERVICE_SUBTOTALS = {
    'seasonal-changeover-rims': 40,
    'seasonal-swap-not-mounted': 80,
    'mount-balance-1': 25,
    'mount-balance-2': 50,
    'mount-balance-3': 75,
    'mount-balance-4': 100,
  };
  const SERVICE_NAMES = {
    'seasonal-changeover-rims': 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims',
    'seasonal-swap-not-mounted': 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims',
    'mount-balance-1': 'Mount & Balance - 1 Tire',
    'mount-balance-2': 'Mount & Balance - 2 Tires',
    'mount-balance-3': 'Mount & Balance - 3 Tires',
    'mount-balance-4': 'Mount & Balance - 4 Tires',
  };

  let wrapped = false;
  let renderQueued = false;

  function log(message, details = {}) {
    console.info(`[EastCord appointment automation] ${message}`, details);
  }

  function readJson(storage, key, fallback = null) {
    try {
      const raw = storage?.getItem?.(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      log(`Stored value could not be read from ${key}.`, { message: error.message });
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage?.setItem?.(key, JSON.stringify(value));
    } catch (error) {
      log(`Stored value could not be written to ${key}.`, { message: error.message });
    }
  }

  function removeKey(storage, key) {
    try {
      storage?.removeItem?.(key);
    } catch (error) {
      log(`Stored value could not be removed from ${key}.`, { message: error.message });
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function titleCase(value) {
    return String(value || '').trim().toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase());
  }

  function formatPlate(value) {
    return String(value || '').trim().toUpperCase();
  }

  function formatTireSize(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const compact = raw.toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
    const slashMatch = compact.match(/^(\d{3})\/?(\d{2})R(\d{2})(?:[1-4])?$/);
    if (slashMatch) return `${slashMatch[1]}/${slashMatch[2]}R${slashMatch[3]}`;
    const noRMatch = compact.match(/^(\d{3})(\d{2})(\d{2})(?:[1-4])?$/);
    if (noRMatch) return `${noRMatch[1]}/${noRMatch[2]}R${noRMatch[3]}`;
    return raw.toUpperCase();
  }

  function money(value) {
    if (window.EastCordAccount?.money) return window.EastCordAccount.money(value);
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function taxBreakdown(subtotal) {
    const serviceSubtotal = roundMoney(subtotal);
    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const depositAmount = roundMoney(totalWithHst * 0.20);
    const remainingBalance = roundMoney(totalWithHst - depositAmount);
    return { serviceSubtotal, hstAmount, totalWithHst, depositAmount, remainingBalance, taxRate: TAX_RATE };
  }

  function first(item, names, fallback = '') {
    for (const name of names) {
      if (item?.[name] !== undefined && item?.[name] !== null && item?.[name] !== '') return item[name];
    }
    return fallback;
  }

  function unwrap(item) {
    if (!item || typeof item !== 'object') return item;
    return item.item || item.appointment || item.booking || item;
  }

  function isAppointmentLike(item) {
    const source = unwrap(item);
    if (!source || typeof source !== 'object') return false;
    return source.type === 'appointment'
      || Boolean(source.serviceId || source.service_id)
      || Boolean(source.serviceName || source.service_name)
      || Boolean(source.bookingId || source.booking_id)
      || Boolean(source.preferredDate || source.preferred_date)
      || Boolean(source.vehicleYear || source.vehicle_year || source.vehicleMake || source.vehicle_make || source.vehicleModel || source.vehicle_model);
  }

  function normalizeItem(item, index = 0) {
    const source = unwrap(item);
    if (!isAppointmentLike(source)) return null;
    const serviceId = first(source, ['serviceId', 'service_id']);
    const subtotal = first(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price', 'price'], SERVICE_SUBTOTALS[serviceId] || 0);
    const tax = taxBreakdown(subtotal);
    return {
      ...source,
      id: first(source, ['id', 'cartId', 'cart_id'], `appointment-${index}`),
      type: 'appointment',
      cartIndex: index,
      customerId: first(source, ['customerId', 'customer_id']),
      customerName: first(source, ['customerName', 'customer_name']),
      customerEmail: first(source, ['customerEmail', 'customer_email']),
      customerPhone: first(source, ['customerPhone', 'customer_phone']),
      serviceId,
      serviceName: first(source, ['serviceName', 'service_name'], SERVICE_NAMES[serviceId] || 'Appointment service'),
      startingPrice: tax.serviceSubtotal,
      serviceSubtotal: tax.serviceSubtotal,
      hstAmount: tax.hstAmount,
      totalWithHst: tax.totalWithHst,
      taxRate: tax.taxRate,
      depositAmount: tax.depositAmount,
      remainingBalance: tax.remainingBalance,
      preferredDate: first(source, ['preferredDate', 'preferred_date']),
      preferredTimeWindow: first(source, ['preferredTimeWindow', 'preferred_time_window']),
      vehicleYear: first(source, ['vehicleYear', 'vehicle_year']),
      vehicleMake: titleCase(first(source, ['vehicleMake', 'vehicle_make'])),
      vehicleModel: titleCase(first(source, ['vehicleModel', 'vehicle_model'])),
      vehiclePlateNumber: formatPlate(first(source, ['vehiclePlateNumber', 'vehicle_plate_number'])),
      vehicleColour: titleCase(first(source, ['vehicleColour', 'vehicle_colour'])),
      tireSize: formatTireSize(first(source, ['tireSize', 'tire_size'])),
      tiresAlreadyOnRims: first(source, ['tiresAlreadyOnRims', 'tires_already_on_rims']),
      numberOfTires: first(source, ['numberOfTires', 'number_of_tires']),
      fullServiceAddress: first(source, ['fullServiceAddress', 'full_service_address']),
      city: first(source, ['city']),
      postalCode: first(source, ['postalCode', 'postal_code']),
      parkingAccessNotes: first(source, ['parkingAccessNotes', 'parking_access_notes']),
      additionalNotes: first(source, ['additionalNotes', 'additional_notes']),
      serviceAreaStatus: first(source, ['serviceAreaStatus', 'service_area_status'], 'In service area'),
      bookingId: first(source, ['bookingId', 'booking_id']),
      bookingStatus: first(source, ['bookingStatus', 'booking_status'], 'Pending Confirmation'),
      paymentStatus: first(source, ['paymentStatus', 'payment_status'], 'pending_checkout'),
      stripeSessionId: first(source, ['stripeSessionId', 'stripe_session_id']),
    };
  }

  function normalizeCollection(value) {
    const rawItems = Array.isArray(value) ? value : value && typeof value === 'object' ? (value.items || value.cart || value.appointments || value.appointmentItems || [value]) : [];
    return rawItems.map(normalizeItem).filter(Boolean);
  }

  function stableKey(item) {
    return [item.bookingId, item.id, item.customerId, item.customerEmail, item.serviceId, item.preferredDate, item.preferredTimeWindow, item.vehicleYear, item.vehicleMake, item.vehicleModel, item.vehiclePlateNumber, item.tireSize, item.fullServiceAddress, item.city]
      .map((part) => String(part || '').trim().toLowerCase()).join('|');
  }

  function unique(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = stableKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function activeCustomer() {
    return readJson(localStorage, ACTIVE_CUSTOMER_KEY, null);
  }

  function setActiveCustomer(profile) {
    if (!profile?.customerId && !profile?.email) {
      removeKey(localStorage, ACTIVE_CUSTOMER_KEY);
      return null;
    }
    const customer = {
      customerId: String(profile.customerId || '').trim(),
      email: String(profile.email || '').trim().toLowerCase(),
      name: profile.name || '',
      phone: profile.phone || '',
    };
    writeJson(localStorage, ACTIVE_CUSTOMER_KEY, customer);
    return customer;
  }

  function accountKey(profile = activeCustomer()) {
    const owner = String(profile?.customerId || profile?.email || '').trim().toLowerCase();
    return owner ? `${ACCOUNT_CART_PREFIX}${owner}` : '';
  }

  function belongsTo(item, profile) {
    if (!profile) return false;
    const itemId = String(item.customerId || '').trim();
    const itemEmail = String(item.customerEmail || '').trim().toLowerCase();
    const profileId = String(profile.customerId || '').trim();
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    if (itemId && profileId) return itemId === profileId;
    if (itemEmail && profileEmail) return itemEmail === profileEmail;
    return false;
  }

  function differentOwner(item, profile) {
    if (!profile) return false;
    const itemId = String(item.customerId || '').trim();
    const itemEmail = String(item.customerEmail || '').trim().toLowerCase();
    const profileId = String(profile.customerId || '').trim();
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    return Boolean((itemId && profileId && itemId !== profileId) || (itemEmail && profileEmail && itemEmail !== profileEmail));
  }

  function readItems(storage, key) {
    return normalizeCollection(readJson(storage, key, []));
  }

  function genericItems() {
    return unique([...CART_KEYS, STALE_CART_KEY].flatMap((key) => [...readItems(localStorage, key), ...readItems(sessionStorage, key)]));
  }

  function accountItems(profile = activeCustomer()) {
    const key = accountKey(profile);
    return key ? readItems(localStorage, key) : [];
  }

  function ownedItems(profile = activeCustomer()) {
    if (!profile) return [];
    return unique([...accountItems(profile), ...genericItems()].filter((item) => belongsTo(item, profile)));
  }

  function mismatchedItems(profile = activeCustomer()) {
    if (!profile) return [];
    return unique(genericItems().filter((item) => differentOwner(item, profile)));
  }

  function writeScopedCart(profile, items) {
    const owned = unique(items.filter((item) => belongsTo(item, profile)));
    const key = accountKey(profile);
    if (key) writeJson(localStorage, key, owned);
    writeJson(localStorage, ACTIVE_CART_KEY, owned);
    return owned;
  }

  function syncForProfile(profile) {
    if (!profile) {
      removeKey(localStorage, ACTIVE_CUSTOMER_KEY);
      writeJson(localStorage, ACTIVE_CART_KEY, []);
      setCartCount(0);
      return [];
    }
    const customer = setActiveCustomer(profile);
    const owned = ownedItems(customer);
    const stale = mismatchedItems(customer);
    writeScopedCart(customer, owned);
    writeJson(localStorage, STALE_CART_KEY, stale);
    setCartCount(owned.length);
    log('Account cart synchronized.', { ownedItems: owned.length, mismatchedItems: stale.length });
    return owned;
  }

  function clearGeneric({ includeDrafts = false } = {}) {
    [...CART_KEYS, STALE_CART_KEY, ...(includeDrafts ? DRAFT_KEYS : [])].forEach((key) => {
      removeKey(localStorage, key);
      removeKey(sessionStorage, key);
    });
  }

  function clearCurrentAccountCart() {
    const key = accountKey();
    if (key) removeKey(localStorage, key);
    clearGeneric({ includeDrafts: true });
    writeJson(localStorage, ACTIVE_CART_KEY, []);
    writeJson(localStorage, STALE_CART_KEY, []);
    setCartCount(0);
    window.dispatchEvent(new CustomEvent('eastcord:cart-cleared'));
  }

  function preserveBeforeLogout() {
    const profile = activeCustomer();
    if (profile) writeScopedCart(profile, ownedItems(profile));
    clearGeneric();
    writeJson(localStorage, ACTIVE_CART_KEY, []);
    writeJson(localStorage, STALE_CART_KEY, []);
    removeKey(localStorage, ACTIVE_CUSTOMER_KEY);
    setCartCount(0);
  }

  function removeMismatch(targetKey) {
    const keep = mismatchedItems().filter((item) => stableKey(item) !== targetKey && item.id !== targetKey && item.bookingId !== targetKey);
    writeJson(localStorage, STALE_CART_KEY, keep);
    CART_KEYS.forEach((key) => [localStorage, sessionStorage].forEach((storage) => {
      const kept = readItems(storage, key).filter((item) => stableKey(item) !== targetKey && item.id !== targetKey && item.bookingId !== targetKey);
      if (kept.length) writeJson(storage, key, kept);
      else removeKey(storage, key);
    }));
    queueRender();
  }

  function setCartCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
      element.textContent = count ? ` (${count})` : '';
    });
  }

  function line(label, value) {
    return value ? `<p>${escapeHtml(label)}: ${escapeHtml(value)}</p>` : '';
  }

  function renderAppointment(item, index) {
    const vehicle = [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ') || 'Vehicle details submitted';
    const cityPostal = [item.city, item.postalCode].filter(Boolean).join(', ');
    return `<article class="cart-line">
      <span>Vehicle ${index + 1} appointment</span>
      <strong>${escapeHtml(item.serviceName || 'Appointment service')}</strong>
      ${line('Vehicle', vehicle)}${line('Plate Number', item.vehiclePlateNumber || 'Not provided')}${line('Colour', item.vehicleColour || 'Not provided')}${line('Tire Size', item.tireSize || 'Not provided')}${line('Tires', item.numberOfTires || 'Not provided')}${line('Address', item.fullServiceAddress)}${line('City/Postal', cityPostal)}${line('Date', item.preferredDate)}${line('Time', item.preferredTimeWindow)}${line('Service Subtotal', money(item.serviceSubtotal))}${line('HST 13%', money(item.hstAmount))}${line('Total Including HST', money(item.totalWithHst))}${line('Deposit Due Today', money(item.depositAmount))}${line('Remaining On-Site', money(item.remainingBalance))}
      <p>Your appointment will be confirmed automatically after successful deposit payment.</p>
      <div class="account-actions cart-line-actions"><button class="button button-secondary" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-index="${index}">Remove this appointment</button></div>
    </article>`;
  }

  function renderMismatch(item) {
    const key = stableKey(item);
    const originalEmail = item.customerEmail ? `Original account: ${item.customerEmail}` : 'This appointment belongs to another customer account.';
    return `<article class="cart-line cart-line-invalid" data-account-mismatch-item>
      <span>Account mismatch</span>
      <strong>${escapeHtml(item.serviceName || 'Appointment from another account')}</strong>
      <p>${escapeHtml(ACCOUNT_MISMATCH_MESSAGE)}</p>
      <p>${escapeHtml(originalEmail)}</p>
      <div class="account-actions cart-line-actions">
        <button class="button button-secondary" type="button" data-switch-account>Log out and switch account</button>
        <button class="button button-secondary" type="button" data-remove-stale-cart-item="${escapeHtml(key)}">Remove this appointment</button>
        <a class="button button-primary" href="/appointment.html" data-start-new-appointment>Start new appointment</a>
      </div>
    </article>`;
  }

  function totals(items) {
    return items.reduce((sum, item) => ({
      subtotal: roundMoney(sum.subtotal + Number(item.serviceSubtotal || 0)),
      hst: roundMoney(sum.hst + Number(item.hstAmount || 0)),
      total: roundMoney(sum.total + Number(item.totalWithHst || 0)),
      deposit: roundMoney(sum.deposit + Number(item.depositAmount || 0)),
      remaining: roundMoney(sum.remaining + Number(item.remainingBalance || 0)),
    }), { subtotal: 0, hst: 0, total: 0, deposit: 0, remaining: 0 });
  }

  function updateTotals(items) {
    const total = totals(items);
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    };
    setText('[data-cart-subtotal]', money(total.subtotal));
    setText('[data-cart-hst]', money(total.hst));
    setText('[data-cart-total]', money(total.total));
    setText('[data-cart-deposit]', money(total.deposit));
    setText('[data-cart-balance]', `${money(total.remaining)} due on-site after service`);
  }

  function message(text, type = 'error') {
    const element = document.querySelector('[data-cart-message]');
    if (!element) return;
    element.textContent = text;
    element.dataset.messageType = type;
  }

  async function renderCartPage() {
    const cartContainer = document.querySelector('[data-cart-items]');
    if (!cartContainer || !window.EastCordAccount) return;

    let profile = null;
    try {
      profile = await window.EastCordAccount.getCurrentProfile();
    } catch (error) {
      log('Cart profile lookup failed during account isolation render.', { message: error.message });
    }

    const customerElement = document.querySelector('[data-cart-customer]');
    const authBlock = document.querySelector('[data-checkout-auth-block]');
    if (customerElement) {
      customerElement.textContent = profile ? `${profile.name || 'Customer'} - ${profile.email}${profile.phone ? ` - ${profile.phone}` : ''}` : 'Please sign up or log in before checkout.';
    }
    if (authBlock) authBlock.classList.toggle('is-visible', !profile);

    const owned = profile ? window.EastCordAccount.getCart() : [];
    const stale = profile ? window.EastCordAccount.getMismatchedCartItems?.() || [] : [];

    cartContainer.innerHTML = owned.length || stale.length
      ? [...owned.map(renderAppointment), ...stale.map(renderMismatch)].join('')
      : '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';

    updateTotals(owned);
    setCartCount(owned.length);
    if (stale.length) message(ACCOUNT_MISMATCH_MESSAGE, 'error');
    else if (!owned.length) message('Your cart is empty. Add an appointment to continue.', 'info');
    else if (document.querySelector('[data-cart-message]')?.textContent === ACCOUNT_MISMATCH_MESSAGE) message('', 'info');
    window.dispatchEvent(new CustomEvent('eastcord:account-cart-rendered'));
  }

  function wrapAccount() {
    if (wrapped || !window.EastCordAccount) return false;
    wrapped = true;
    const account = window.EastCordAccount;
    const originalGetCurrentProfile = account.getCurrentProfile?.bind(account);
    const originalSaveCart = account.saveCart?.bind(account);

    account.getCurrentProfile = async () => {
      const profile = originalGetCurrentProfile ? await originalGetCurrentProfile() : null;
      syncForProfile(profile);
      return profile;
    };
    account.getCart = () => {
      const profile = activeCustomer();
      if (!profile) return [];
      return writeScopedCart(profile, ownedItems(profile));
    };
    account.saveCart = (cart) => {
      const profile = activeCustomer();
      if (!profile) {
        if (originalSaveCart) originalSaveCart([]);
        writeJson(localStorage, ACTIVE_CART_KEY, []);
        setCartCount(0);
        return;
      }
      const normalized = normalizeCollection(cart);
      const owned = writeScopedCart(profile, normalized);
      writeJson(localStorage, STALE_CART_KEY, normalized.filter((item) => differentOwner(item, profile)));
      setCartCount(owned.length);
      queueRender();
    };
    account.clearCartStorage = clearCurrentAccountCart;
    account.clearCart = clearCurrentAccountCart;
    account.getMismatchedCartItems = () => mismatchedItems(activeCustomer());
    account.removeMismatchedCartItem = removeMismatch;
    account.signOutForAccountSwitch = async () => {
      preserveBeforeLogout();
      const client = account.getSupabaseClient?.();
      if (client) await client.auth.signOut();
      window.location.href = '/login.html';
    };
    account.accountMismatchMessage = ACCOUNT_MISMATCH_MESSAGE;
    log('Account cart isolation initialized.');
    return true;
  }

  function bindActions() {
    document.addEventListener('click', (event) => {
      const switchButton = event.target.closest('[data-switch-account]');
      if (switchButton) {
        event.preventDefault();
        window.EastCordAccount?.signOutForAccountSwitch?.();
        return;
      }
      const staleRemoveButton = event.target.closest('[data-remove-stale-cart-item]');
      if (staleRemoveButton) {
        event.preventDefault();
        window.EastCordAccount?.removeMismatchedCartItem?.(staleRemoveButton.dataset.removeStaleCartItem);
        return;
      }
      const startNew = event.target.closest('[data-start-new-appointment]');
      if (startNew) {
        clearGeneric();
        writeJson(localStorage, STALE_CART_KEY, []);
        setCartCount(window.EastCordAccount?.getCart?.().length || 0);
      }
    }, true);

    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-logout-button]')) preserveBeforeLogout();
    }, true);
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.setTimeout(() => {
      renderQueued = false;
      renderCartPage();
    }, 0);
  }

  function init(attempt = 0) {
    if (!wrapAccount()) {
      if (attempt < 50) window.setTimeout(() => init(attempt + 1), 50);
      return;
    }
    bindActions();
    window.EastCordAccount.getCurrentProfile?.().finally(queueRender);
    window.addEventListener('eastcord:cart-cleared', queueRender);
    window.addEventListener('storage', queueRender);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queueRender, { once: true });
    else queueRender();
  }

  window.EastCordCartIsolation = { renderCartPage, syncForProfile, clearCurrentAccountCart, getOwnedItemsForProfile: ownedItems, getMismatchedItemsForProfile: mismatchedItems };
  init();
})();
