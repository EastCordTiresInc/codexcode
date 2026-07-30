(() => {
  const ACTIVE_CART_KEY = 'eastcord_cart_v1';
  const STALE_CART_KEY = 'eastcord_stale_cart_v1';
  const ACTIVE_CUSTOMER_KEY = 'eastcord_active_customer_v1';
  const ACCOUNT_CART_PREFIX = 'eastcord_cart_v1_account_';
  const CART_STORAGE_KEYS = [
    ACTIVE_CART_KEY,
    'cart',
    'eastcord_cart',
    'appointment_cart',
    'eastcord_appointment_cart',
    'eastcord_appointment_cart_v1',
  ];
  const DRAFT_STORAGE_KEYS = [
    'eastcord_pending_appointment_v1',
    'eastcord_auth_redirect',
    'pendingAppointment',
    'pending_appointment',
    'appointmentDraft',
    'savedAppointment',
    'eastcord_appointment_draft',
    'eastcord_saved_appointment',
  ];
  const TAX_RATE = 0.13;
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
  const ACCOUNT_MISMATCH_MESSAGE = 'This appointment was created under a different account. Please log in with the original email used for this booking, or remove this appointment and start a new one.';

  let wrapped = false;

  function log(message, details = {}) {
    console.info(`[EastCord appointment automation] ${message}`, details);
  }

  function getStorageKeys(storage) {
    const keys = [];
    for (let index = 0; storage && index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function readJson(storage, key, fallback = null) {
    try {
      const raw = storage?.getItem?.(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
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

  function removeStorageKey(storage, key) {
    try {
      storage?.removeItem?.(key);
    } catch (error) {
      log(`Stored value could not be removed from ${key}.`, { message: error.message });
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
    return { serviceSubtotal, hstAmount, totalWithHst, depositAmount, remainingBalance, taxRate: TAX_RATE };
  }

  function getFirstValue(item, names, fallback = '') {
    for (const name of names) {
      if (item?.[name] !== undefined && item?.[name] !== null && item?.[name] !== '') return item[name];
    }
    return fallback;
  }

  function unwrapCartItem(item) {
    if (!item || typeof item !== 'object') return item;
    if (item.item && typeof item.item === 'object') return item.item;
    if (item.appointment && typeof item.appointment === 'object') return item.appointment;
    if (item.booking && typeof item.booking === 'object') return item.booking;
    return item;
  }

  function isAppointmentLikeItem(item) {
    const source = unwrapCartItem(item);
    if (!source || typeof source !== 'object') return false;
    return source.type === 'appointment'
      || Boolean(source.serviceId || source.service_id)
      || Boolean(source.serviceName || source.service_name)
      || Boolean(source.bookingId || source.booking_id)
      || Boolean(source.preferredDate || source.preferred_date)
      || Boolean(source.vehicleYear || source.vehicle_year || source.vehicleMake || source.vehicle_make || source.vehicleModel || source.vehicle_model);
  }

  function normalizeAppointmentItem(item, index = 0) {
    const source = unwrapCartItem(item);
    if (!source || typeof source !== 'object' || !isAppointmentLikeItem(source)) return null;

    const serviceId = getFirstValue(source, ['serviceId', 'service_id']);
    const serviceName = getFirstValue(source, ['serviceName', 'service_name'], SERVICE_NAMES[serviceId] || 'Appointment service');
    const subtotal = getFirstValue(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price', 'price'], SERVICE_SUBTOTALS[serviceId] || 0);
    const calculated = calculateTaxBreakdown(subtotal);

    return {
      ...source,
      id: getFirstValue(source, ['id', 'cartId', 'cart_id'], `appointment-${index}`),
      type: 'appointment',
      cartIndex: index,
      customerId: getFirstValue(source, ['customerId', 'customer_id']),
      customerName: getFirstValue(source, ['customerName', 'customer_name']),
      customerEmail: getFirstValue(source, ['customerEmail', 'customer_email']),
      customerPhone: getFirstValue(source, ['customerPhone', 'customer_phone']),
      serviceId,
      serviceName,
      startingPrice: calculated.serviceSubtotal,
      serviceSubtotal: calculated.serviceSubtotal,
      hstAmount: calculated.hstAmount,
      totalWithHst: calculated.totalWithHst,
      taxRate: calculated.taxRate,
      depositAmount: calculated.depositAmount,
      remainingBalance: calculated.remainingBalance,
      preferredDate: getFirstValue(source, ['preferredDate', 'preferred_date']),
      preferredTimeWindow: getFirstValue(source, ['preferredTimeWindow', 'preferred_time_window']),
      vehicleYear: getFirstValue(source, ['vehicleYear', 'vehicle_year']),
      vehicleMake: titleCase(getFirstValue(source, ['vehicleMake', 'vehicle_make'])),
      vehicleModel: titleCase(getFirstValue(source, ['vehicleModel', 'vehicle_model'])),
      vehiclePlateNumber: formatPlate(getFirstValue(source, ['vehiclePlateNumber', 'vehicle_plate_number'])),
      vehicleColour: titleCase(getFirstValue(source, ['vehicleColour', 'vehicle_colour'])),
      tireSize: formatTireSize(getFirstValue(source, ['tireSize', 'tire_size'])),
      tiresAlreadyOnRims: getFirstValue(source, ['tiresAlreadyOnRims', 'tires_already_on_rims']),
      numberOfTires: getFirstValue(source, ['numberOfTires', 'number_of_tires']),
      fullServiceAddress: getFirstValue(source, ['fullServiceAddress', 'full_service_address']),
      city: getFirstValue(source, ['city']),
      postalCode: getFirstValue(source, ['postalCode', 'postal_code']),
      parkingAccessNotes: getFirstValue(source, ['parkingAccessNotes', 'parking_access_notes']),
      additionalNotes: getFirstValue(source, ['additionalNotes', 'additional_notes']),
      serviceAreaStatus: getFirstValue(source, ['serviceAreaStatus', 'service_area_status'], 'In service area'),
      bookingId: getFirstValue(source, ['bookingId', 'booking_id']),
      bookingStatus: getFirstValue(source, ['bookingStatus', 'booking_status'], 'Pending Confirmation'),
      paymentStatus: getFirstValue(source, ['paymentStatus', 'payment_status'], 'pending_checkout'),
      stripeSessionId: getFirstValue(source, ['stripeSessionId', 'stripe_session_id']),
    };
  }

  function normalizeCartCollection(value) {
    const rawItems = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? (value.items || value.cart || value.appointments || value.appointmentItems || [value])
        : [];
    return rawItems.map(normalizeAppointmentItem).filter(Boolean);
  }

  function stableItemKey(item) {
    return [
      item.bookingId,
      item.id,
      item.customerId,
      item.customerEmail,
      item.serviceId,
      item.preferredDate,
      item.preferredTimeWindow,
      item.vehicleYear,
      item.vehicleMake,
      item.vehicleModel,
      item.vehiclePlateNumber,
      item.tireSize,
      item.fullServiceAddress,
      item.city,
    ].map((part) => String(part || '').trim().toLowerCase()).join('|');
  }

  function uniqueItems(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = stableItemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function getActiveCustomer() {
    return readJson(localStorage, ACTIVE_CUSTOMER_KEY, null);
  }

  function setActiveCustomer(profile) {
    if (!profile?.customerId && !profile?.email) {
      removeStorageKey(localStorage, ACTIVE_CUSTOMER_KEY);
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

  function accountCartKey(profile = getActiveCustomer()) {
    const owner = String(profile?.customerId || profile?.email || '').trim().toLowerCase();
    return owner ? `${ACCOUNT_CART_PREFIX}${owner}` : '';
  }

  function itemBelongsToProfile(item, profile) {
    if (!profile) return false;
    const itemCustomerId = String(item.customerId || '').trim();
    const itemEmail = String(item.customerEmail || '').trim().toLowerCase();
    const profileId = String(profile.customerId || '').trim();
    const profileEmail = String(profile.email || '').trim().toLowerCase();

    if (itemCustomerId && profileId) return itemCustomerId === profileId;
    if (itemEmail && profileEmail) return itemEmail === profileEmail;
    return false;
  }

  function itemHasDifferentOwner(item, profile) {
    if (!profile) return false;
    const itemCustomerId = String(item.customerId || '').trim();
    const itemEmail = String(item.customerEmail || '').trim().toLowerCase();
    const profileId = String(profile.customerId || '').trim();
    const profileEmail = String(profile.email || '').trim().toLowerCase();

    if (itemCustomerId && profileId && itemCustomerId !== profileId) return true;
    if (itemEmail && profileEmail && itemEmail !== profileEmail) return true;
    return false;
  }

  function readItemsFromKey(storage, key) {
    return normalizeCartCollection(readJson(storage, key, []));
  }

  function readGenericCartItems() {
    const keys = [...new Set([...CART_STORAGE_KEYS, STALE_CART_KEY])];
    return uniqueItems(keys.flatMap((key) => [
      ...readItemsFromKey(localStorage, key),
      ...readItemsFromKey(sessionStorage, key),
    ]));
  }

  function readAccountCartItems(profile = getActiveCustomer()) {
    const key = accountCartKey(profile);
    return key ? readItemsFromKey(localStorage, key) : [];
  }

  function getOwnedItemsForProfile(profile = getActiveCustomer()) {
    if (!profile) return [];
    const accountItems = readAccountCartItems(profile).filter((item) => itemBelongsToProfile(item, profile));
    const genericOwnedItems = readGenericCartItems().filter((item) => itemBelongsToProfile(item, profile));
    return uniqueItems([...accountItems, ...genericOwnedItems]);
  }

  function getMismatchedItemsForProfile(profile = getActiveCustomer()) {
    if (!profile) return [];
    return uniqueItems(readGenericCartItems().filter((item) => itemHasDifferentOwner(item, profile)));
  }

  function writeScopedCart(profile, items) {
    const ownedItems = uniqueItems(items.filter((item) => itemBelongsToProfile(item, profile)));
    const key = accountCartKey(profile);
    if (key) writeJson(localStorage, key, ownedItems);
    writeJson(localStorage, ACTIVE_CART_KEY, ownedItems);
    return ownedItems;
  }

  function syncCartForProfile(profile) {
    if (!profile) {
      writeJson(localStorage, ACTIVE_CART_KEY, []);
      updateVisibleCartCount(0);
      return [];
    }

    const customer = setActiveCustomer(profile);
    const ownedItems = getOwnedItemsForProfile(customer);
    const mismatchedItems = getMismatchedItemsForProfile(customer);
    writeScopedCart(customer, ownedItems);
    writeJson(localStorage, STALE_CART_KEY, mismatchedItems);
    updateVisibleCartCount(ownedItems.length);
    log('Account cart synchronized.', {
      owner: customer.email || customer.customerId,
      ownedItems: ownedItems.length,
      mismatchedItems: mismatchedItems.length,
    });
    return ownedItems;
  }

  function clearGenericCartKeys({ includeDrafts = false } = {}) {
    const keys = includeDrafts ? [...CART_STORAGE_KEYS, STALE_CART_KEY, ...DRAFT_STORAGE_KEYS] : [...CART_STORAGE_KEYS, STALE_CART_KEY];
    const allKeys = [...new Set([
      ...keys,
      ...getStorageKeys(localStorage).filter((key) => CART_STORAGE_KEYS.includes(key) || key === STALE_CART_KEY),
      ...getStorageKeys(sessionStorage).filter((key) => CART_STORAGE_KEYS.includes(key) || key === STALE_CART_KEY),
    ])];
    allKeys.forEach((key) => {
      removeStorageKey(localStorage, key);
      removeStorageKey(sessionStorage, key);
    });
  }

  function clearCurrentAccountCart() {
    const profile = getActiveCustomer();
    const key = accountCartKey(profile);
    if (key) removeStorageKey(localStorage, key);
    clearGenericCartKeys({ includeDrafts: true });
    writeJson(localStorage, ACTIVE_CART_KEY, []);
    writeJson(localStorage, STALE_CART_KEY, []);
    updateVisibleCartCount(0);
    window.dispatchEvent(new CustomEvent('eastcord:cart-updated'));
  }

  function preserveCurrentAccountCartBeforeLogout() {
    const profile = getActiveCustomer();
    if (profile) writeScopedCart(profile, getOwnedItemsForProfile(profile));
    clearGenericCartKeys({ includeDrafts: false });
    writeJson(localStorage, ACTIVE_CART_KEY, []);
    writeJson(localStorage, STALE_CART_KEY, []);
    removeStorageKey(localStorage, ACTIVE_CUSTOMER_KEY);
    updateVisibleCartCount(0);
  }

  function removeMismatchedCartItem(targetKey) {
    const profile = getActiveCustomer();
    const mismatchedItems = getMismatchedItemsForProfile(profile);
    const nextMismatched = mismatchedItems.filter((item) => stableItemKey(item) !== targetKey && item.id !== targetKey && item.bookingId !== targetKey);
    writeJson(localStorage, STALE_CART_KEY, nextMismatched);

    CART_STORAGE_KEYS.forEach((key) => {
      [localStorage, sessionStorage].forEach((storage) => {
        const keptItems = readItemsFromKey(storage, key).filter((item) => stableItemKey(item) !== targetKey && item.id !== targetKey && item.bookingId !== targetKey);
        if (keptItems.length) writeJson(storage, key, keptItems);
        else removeStorageKey(storage, key);
      });
    });

    window.dispatchEvent(new CustomEvent('eastcord:cart-updated'));
  }

  function updateVisibleCartCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
      element.textContent = count ? ` (${count})` : '';
    });
  }

  function detailLine(label, value) {
    if (!value) return '';
    return `<p>${escapeHtml(label)}: ${escapeHtml(value)}</p>`;
  }

  function renderAppointmentItem(item, index) {
    const vehicle = [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ') || 'Vehicle details submitted';
    const cityPostal = [item.city, item.postalCode].filter(Boolean).join(', ');
    return `
      <article class="cart-line">
        <span>Vehicle ${index + 1} appointment</span>
        <strong>${escapeHtml(item.serviceName || 'Appointment service')}</strong>
        ${detailLine('Vehicle', vehicle)}
        ${detailLine('Plate Number', item.vehiclePlateNumber || 'Not provided')}
        ${detailLine('Colour', item.vehicleColour || 'Not provided')}
        ${detailLine('Tire Size', item.tireSize || 'Not provided')}
        ${detailLine('Tires', item.numberOfTires || 'Not provided')}
        ${detailLine('Address', item.fullServiceAddress)}
        ${detailLine('City/Postal', cityPostal)}
        ${detailLine('Date', item.preferredDate)}
        ${detailLine('Time', item.preferredTimeWindow)}
        ${detailLine('Service Subtotal', money(item.serviceSubtotal))}
        ${detailLine('HST 13%', money(item.hstAmount))}
        ${detailLine('Total Including HST', money(item.totalWithHst))}
        ${detailLine('Deposit Due Today', money(item.depositAmount))}
        ${detailLine('Remaining On-Site', money(item.remainingBalance))}
        <p>Your appointment will be confirmed automatically after successful deposit payment.</p>
        <div class="account-actions cart-line-actions">
          <button class="button button-secondary" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-index="${index}">Remove this appointment</button>
        </div>
      </article>
    `;
  }

  function renderMismatchedItem(item) {
    const key = stableItemKey(item);
    const originalEmail = item.customerEmail ? `Original account: ${item.customerEmail}` : 'This appointment belongs to another customer account.';
    return `
      <article class="cart-line cart-line-invalid" data-account-mismatch-item>
        <span>Account mismatch</span>
        <strong>${escapeHtml(item.serviceName || 'Appointment from another account')}</strong>
        <p>${escapeHtml(ACCOUNT_MISMATCH_MESSAGE)}</p>
        <p>${escapeHtml(originalEmail)}</p>
        <div class="account-actions cart-line-actions">
          <button class="button button-secondary" type="button" data-switch-account>Log out and switch account</button>
          <button class="button button-secondary" type="button" data-remove-stale-cart-item="${escapeHtml(key)}">Remove this appointment</button>
          <a class="button button-primary" href="/appointment.html" data-start-new-appointment>Start new appointment</a>
        </div>
      </article>
    `;
  }

  function calculateTotals(items) {
    return items.reduce((sum, item) => ({
      subtotal: roundMoney(sum.subtotal + Number(item.serviceSubtotal || 0)),
      hst: roundMoney(sum.hst + Number(item.hstAmount || 0)),
      total: roundMoney(sum.total + Number(item.totalWithHst || 0)),
      deposit: roundMoney(sum.deposit + Number(item.depositAmount || 0)),
      remaining: roundMoney(sum.remaining + Number(item.remainingBalance || 0)),
    }), { subtotal: 0, hst: 0, total: 0, deposit: 0, remaining: 0 });
  }

  function updateCartTotals(items) {
    const totals = calculateTotals(items);
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    };
    setText('[data-cart-subtotal]', money(totals.subtotal));
    setText('[data-cart-hst]', money(totals.hst));
    setText('[data-cart-total]', money(totals.total));
    setText('[data-cart-deposit]', money(totals.deposit));
    setText('[data-cart-balance]', `${money(totals.remaining)} due on-site after service`);
  }

  function showCartMessage(message, type = 'error') {
    const element = document.querySelector('[data-cart-message]');
    if (!element) return;
    element.textContent = message;
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
      customerElement.textContent = profile
        ? `${profile.name || 'Customer'} - ${profile.email}${profile.phone ? ` - ${profile.phone}` : ''}`
        : 'Please sign up or log in before checkout.';
    }
    if (authBlock) authBlock.classList.toggle('is-visible', !profile);

    const ownedItems = profile ? window.EastCordAccount.getCart() : [];
    const mismatchedItems = profile ? window.EastCordAccount.getMismatchedCartItems?.() || [] : [];

    if (ownedItems.length || mismatchedItems.length) {
      cartContainer.innerHTML = [
        ...ownedItems.map(renderAppointmentItem),
        ...mismatchedItems.map(renderMismatchedItem),
      ].join('');
    } else {
      cartContainer.innerHTML = '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';
    }

    updateCartTotals(ownedItems);
    updateVisibleCartCount(ownedItems.length);

    if (mismatchedItems.length) showCartMessage(ACCOUNT_MISMATCH_MESSAGE, 'error');
    else if (!ownedItems.length) showCartMessage('Your cart is empty. Add an appointment to continue.', 'info');
    else if (document.querySelector('[data-cart-message]')?.textContent === ACCOUNT_MISMATCH_MESSAGE) showCartMessage('', 'info');

    window.dispatchEvent(new CustomEvent('eastcord:account-cart-rendered'));
    window.dispatchEvent(new CustomEvent('eastcord:cart-updated'));
  }

  function wrapEastCordAccount() {
    if (wrapped || !window.EastCordAccount) return false;
    wrapped = true;
    const account = window.EastCordAccount;
    const originalGetCurrentProfile = account.getCurrentProfile?.bind(account);
    const originalGetCart = account.getCart?.bind(account);
    const originalSaveCart = account.saveCart?.bind(account);
    const originalClearCart = account.clearCart?.bind(account);
    const originalClearCartStorage = account.clearCartStorage?.bind(account);

    account.getCurrentProfile = async function getCurrentProfileWithCartIsolation() {
      const profile = originalGetCurrentProfile ? await originalGetCurrentProfile() : null;
      if (profile) syncCartForProfile(profile);
      else {
        removeStorageKey(localStorage, ACTIVE_CUSTOMER_KEY);
        writeJson(localStorage, ACTIVE_CART_KEY, []);
        updateVisibleCartCount(0);
      }
      return profile;
    };

    account.getCart = function getAccountScopedCart() {
      const profile = getActiveCustomer();
      if (!profile) return [];
      const ownedItems = getOwnedItemsForProfile(profile);
      writeScopedCart(profile, ownedItems);
      return ownedItems;
    };

    account.saveCart = function saveAccountScopedCart(cart) {
      const profile = getActiveCustomer();
      if (!profile) {
        if (originalSaveCart) originalSaveCart([]);
        writeJson(localStorage, ACTIVE_CART_KEY, []);
        updateVisibleCartCount(0);
        return;
      }
      const normalized = normalizeCartCollection(cart);
      const ownedItems = writeScopedCart(profile, normalized);
      writeJson(localStorage, STALE_CART_KEY, normalized.filter((item) => itemHasDifferentOwner(item, profile)));
      updateVisibleCartCount(ownedItems.length);
      window.dispatchEvent(new CustomEvent('eastcord:cart-updated'));
    };

    account.clearCartStorage = function clearAccountScopedCartStorage() {
      clearCurrentAccountCart();
      if (originalClearCartStorage) log('Original shared cart clear bypassed after account-scoped clear.', { preserved: true });
    };

    account.clearCart = function clearAccountScopedCart() {
      clearCurrentAccountCart();
      if (originalClearCart) log('Original shared cart clear bypassed after account-scoped clear.', { preserved: true });
      window.dispatchEvent(new CustomEvent('eastcord:cart-cleared'));
    };

    account.getMismatchedCartItems = () => getMismatchedItemsForProfile(getActiveCustomer());
    account.removeMismatchedCartItem = removeMismatchedCartItem;
    account.signOutForAccountSwitch = async () => {
      preserveCurrentAccountCartBeforeLogout();
      const client = account.getSupabaseClient?.();
      if (client) await client.auth.signOut();
      window.location.href = '/login.html';
    };
    account.accountMismatchMessage = ACCOUNT_MISMATCH_MESSAGE;

    if (originalGetCart && !getActiveCustomer()) {
      const legacyCount = normalizeCartCollection(originalGetCart()).length;
      if (legacyCount) log('Legacy shared cart found before profile was loaded.', { legacyCount });
    }

    log('Account cart isolation initialized.');
    return true;
  }

  function bindRecoveryActions() {
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
        renderCartPage();
        return;
      }

      const startNew = event.target.closest('[data-start-new-appointment]');
      if (startNew) {
        clearGenericCartKeys({ includeDrafts: false });
        writeJson(localStorage, STALE_CART_KEY, []);
        updateVisibleCartCount(window.EastCordAccount?.getCart?.().length || 0);
      }
    }, true);

    document.addEventListener('click', (event) => {
      const logoutButton = event.target.closest('[data-logout-button]');
      if (!logoutButton) return;
      preserveCurrentAccountCartBeforeLogout();
    }, true);
  }

  function scheduleCartRender() {
    window.setTimeout(renderCartPage, 0);
    window.setTimeout(renderCartPage, 200);
    window.setTimeout(renderCartPage, 700);
  }

  function initializeWhenAccountReady(attempt = 0) {
    if (!wrapEastCordAccount()) {
      if (attempt < 40) window.setTimeout(() => initializeWhenAccountReady(attempt + 1), 50);
      return;
    }

    bindRecoveryActions();
    window.EastCordAccount.getCurrentProfile?.().finally(scheduleCartRender);
    window.addEventListener('eastcord:cart-updated', scheduleCartRender);
    window.addEventListener('eastcord:cart-cleared', scheduleCartRender);
    window.addEventListener('storage', scheduleCartRender);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleCartRender, { once: true });
    } else {
      scheduleCartRender();
    }
  }

  window.EastCordCartIsolation = {
    renderCartPage,
    syncCartForProfile,
    clearCurrentAccountCart,
    getOwnedItemsForProfile,
    getMismatchedItemsForProfile,
  };

  initializeWhenAccountReady();
})();
