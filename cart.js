(() => {
  const TAX_RATE = 0.13;
  const MIN_ADVANCE_MINUTES = 120;
  const CHECKOUT_FUNCTION_PATH = '/.netlify/functions/create-appointment-checkout-session';
  const CART_KEY = 'eastcord_cart_v1';
  const STALE_CART_KEY = 'eastcord_stale_cart_v1';
  const ACCOUNT_CART_PREFIX = 'eastcord_cart_v1_account_';
  const SLOT_UNAVAILABLE_MESSAGE = 'One or more appointment times are no longer available. Please choose another time.';
  const ACCOUNT_MISMATCH_MESSAGE = 'This appointment was created under a different account. Please log in with the original email used for this booking, or remove this appointment and start a new one.';
  const MESSAGES = {
    agreement: 'Please agree to the Mobile Service Agreement before checkout.',
    login: 'Please log in before checkout.',
    invalidCart: 'Your cart is empty or invalid. Please start a new appointment.',
    checkoutFailure: 'Checkout could not be started. Please try again or contact EastCord Tires.',
    total: 'Cart total could not be calculated. Please refresh or clear cart.',
  };
  const CART_STORAGE_KEYS = [
    CART_KEY,
    STALE_CART_KEY,
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

  const state = {
    profile: null,
    authLoaded: false,
    validItems: [],
    mismatchedItems: [],
    invalidItems: [],
    totals: emptyTotals(),
    checkoutInProgress: false,
  };

  const els = {};

  function cacheElements() {
    els.cartItems = document.querySelector('[data-cart-items]');
    els.cartCustomer = document.querySelector('[data-cart-customer]');
    els.cartSubtotal = document.querySelector('[data-cart-subtotal]');
    els.cartHst = document.querySelector('[data-cart-hst]');
    els.cartTotal = document.querySelector('[data-cart-total]');
    els.cartDeposit = document.querySelector('[data-cart-deposit]');
    els.cartBalance = document.querySelector('[data-cart-balance]');
    els.cartMessage = document.querySelector('[data-cart-message]');
    els.checkoutButton = document.querySelector('[data-checkout-button]');
    els.clearCartButton = document.querySelector('[data-clear-cart]');
    els.authBlock = document.querySelector('[data-checkout-auth-block]');
    els.agreementCheckbox = document.querySelector('[data-agreement-checkbox]');
    els.agreementOpenButton = document.querySelector('[data-agreement-open]');
    els.agreementModal = document.querySelector('[data-agreement-modal]');
    els.agreementCloseButtons = Array.from(document.querySelectorAll('[data-agreement-close]'));
    els.agreementPanel = els.agreementModal?.querySelector('.agreement-modal-panel');
  }

  function log(message, details = {}) {
    console.info(`[EastCord cart controller] ${message}`, details);
  }

  function logError(message, details = {}) {
    console.error(`[EastCord cart controller] ${message}`, details);
  }

  function emptyTotals() {
    return { subtotal: 0, hst: 0, total: 0, deposit: 0, remaining: 0 };
  }

  function roundMoney(value) {
    const amount = Number(value || 0);
    return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
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

  function calculateTaxBreakdown(subtotal) {
    const serviceSubtotal = roundMoney(subtotal);
    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const depositAmount = roundMoney(totalWithHst * 0.20);
    const remainingBalance = roundMoney(totalWithHst - depositAmount);
    return { serviceSubtotal, hstAmount, totalWithHst, depositAmount, remainingBalance, taxRate: TAX_RATE };
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

  function first(item, names, fallback = '') {
    for (const name of names) {
      if (item?.[name] !== undefined && item?.[name] !== null && item?.[name] !== '') return item[name];
    }
    return fallback;
  }

  function unwrapCartItem(item) {
    if (!item || typeof item !== 'object') return item;
    return item.item || item.appointment || item.booking || item;
  }

  function isAppointmentLike(item) {
    const source = unwrapCartItem(item);
    if (!source || typeof source !== 'object') return false;
    return source.type === 'appointment'
      || Boolean(source.serviceId || source.service_id)
      || Boolean(source.serviceName || source.service_name)
      || Boolean(source.bookingId || source.booking_id)
      || Boolean(source.preferredDate || source.preferred_date)
      || Boolean(source.vehicleYear || source.vehicle_year || source.vehicleMake || source.vehicle_make || source.vehicleModel || source.vehicle_model);
  }

  function normalizeCartItem(item, index = 0) {
    const source = unwrapCartItem(item);
    if (!isAppointmentLike(source)) return null;

    const serviceId = first(source, ['serviceId', 'service_id']);
    const subtotal = Number(first(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price', 'price'], SERVICE_SUBTOTALS[serviceId] || 0));
    const tax = calculateTaxBreakdown(subtotal);
    const customerId = String(first(source, ['customerId', 'customer_id'])).trim();
    const customerEmail = String(first(source, ['customerEmail', 'customer_email'])).trim().toLowerCase();

    return {
      ...source,
      id: first(source, ['id', 'cartId', 'cart_id'], `appointment-${index}`),
      type: 'appointment',
      cartIndex: index,
      customerId,
      customerName: first(source, ['customerName', 'customer_name']),
      customerEmail,
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
      isInvalidCartItem: subtotal <= 0,
      invalidReason: subtotal <= 0 ? 'This appointment is missing service pricing. Please remove it and add the appointment again.' : '',
    };
  }

  function normalizeCartCollection(value) {
    const rawItems = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? (value.items || value.cart || value.appointments || value.appointmentItems || [value])
        : [];
    return rawItems.map((item, index) => normalizeCartItem(item, index)).filter(Boolean);
  }

  function readJson(storage, key, fallback = null) {
    try {
      const raw = storage?.getItem?.(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      logError(`Stored cart value could not be read from ${key}.`, { message: error.message });
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      storage?.setItem?.(key, JSON.stringify(value));
    } catch (error) {
      logError(`Stored cart value could not be written to ${key}.`, { message: error.message });
    }
  }

  function removeKey(storage, key) {
    try {
      storage?.removeItem?.(key);
    } catch (error) {
      logError(`Stored cart value could not be removed from ${key}.`, { message: error.message });
    }
  }

  function storageKeys(storage) {
    const keys = [];
    for (let index = 0; storage && index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function allCartStorageKeys({ includeDrafts = false, includeAccountKeys = true } = {}) {
    const dynamicKeys = includeAccountKeys
      ? storageKeys(localStorage).filter((key) => key.startsWith(ACCOUNT_CART_PREFIX))
      : [];
    return [...new Set([...CART_STORAGE_KEYS, ...dynamicKeys, ...(includeDrafts ? APPOINTMENT_DRAFT_STORAGE_KEYS : [])])];
  }

  function stableKey(item) {
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
      item.numberOfTires,
      item.fullServiceAddress,
      item.city,
      item.postalCode,
    ].map((part) => String(part || '').trim().toLowerCase()).join('|');
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

  function accountCartKey(profile) {
    const owner = String(profile?.customerId || profile?.email || '').trim().toLowerCase();
    return owner ? `${ACCOUNT_CART_PREFIX}${owner}` : '';
  }

  function profileMatchesItem(profile, item) {
    if (!profile || !item) return false;
    const profileId = String(profile.customerId || '').trim();
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    if (item.customerId && profileId) return item.customerId === profileId;
    if (item.customerEmail && profileEmail) return item.customerEmail === profileEmail;
    return false;
  }

  function itemHasDifferentOwner(profile, item) {
    if (!profile || !item) return false;
    const profileId = String(profile.customerId || '').trim();
    const profileEmail = String(profile.email || '').trim().toLowerCase();
    return Boolean(
      (item.customerId && profileId && item.customerId !== profileId)
      || (item.customerEmail && profileEmail && item.customerEmail !== profileEmail)
    );
  }

  function readCartItemsFromStorage() {
    const keys = allCartStorageKeys({ includeAccountKeys: true });
    const items = [];
    keys.forEach((key) => {
      items.push(...normalizeCartCollection(readJson(localStorage, key, [])));
      items.push(...normalizeCartCollection(readJson(sessionStorage, key, [])));
    });
    return unique(items);
  }

  function saveScopedCart(items) {
    const accountKey = accountCartKey(state.profile);
    if (accountKey) writeJson(localStorage, accountKey, items);
    writeJson(localStorage, CART_KEY, items);
    CART_STORAGE_KEYS.filter((key) => key !== CART_KEY && key !== STALE_CART_KEY).forEach((key) => {
      removeKey(localStorage, key);
      removeKey(sessionStorage, key);
    });
    setCartCount(items.length);
  }

  function saveStaleCart(items) {
    if (items.length) writeJson(localStorage, STALE_CART_KEY, items);
    else removeKey(localStorage, STALE_CART_KEY);
  }

  function clearCartStorage({ includeDrafts = false } = {}) {
    allCartStorageKeys({ includeDrafts, includeAccountKeys: true }).forEach((key) => {
      removeKey(localStorage, key);
      removeKey(sessionStorage, key);
    });
    writeJson(localStorage, CART_KEY, []);
    setCartCount(0);
    window.EastCordAccount?.saveCart?.([]);
    window.dispatchEvent(new CustomEvent('eastcord:cart-cleared'));
  }

  function getRawCartSnapshot() {
    const rawItems = readCartItemsFromStorage();
    if (!state.profile) return { validItems: [], mismatchedItems: [], invalidItems: rawItems };

    const validItems = [];
    const mismatchedItems = [];
    const invalidItems = [];

    rawItems.forEach((item) => {
      if (item.isInvalidCartItem) {
        invalidItems.push(item);
        return;
      }
      if (profileMatchesItem(state.profile, item)) {
        validItems.push(item);
        return;
      }
      if (itemHasDifferentOwner(state.profile, item)) {
        mismatchedItems.push(item);
        return;
      }
      invalidItems.push({ ...item, isInvalidCartItem: true, invalidReason: 'This appointment could not be matched to your account. Please remove it and start a new appointment.' });
    });

    return {
      validItems: unique(validItems),
      mismatchedItems: unique(mismatchedItems),
      invalidItems: unique(invalidItems),
    };
  }

  function getTotals(items) {
    return items.reduce((sum, item) => ({
      subtotal: roundMoney(sum.subtotal + Number(item.serviceSubtotal || 0)),
      hst: roundMoney(sum.hst + Number(item.hstAmount || 0)),
      total: roundMoney(sum.total + Number(item.totalWithHst || 0)),
      deposit: roundMoney(sum.deposit + Number(item.depositAmount || 0)),
      remaining: roundMoney(sum.remaining + Number(item.remainingBalance || 0)),
    }), emptyTotals());
  }

  function setCartCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
      element.textContent = count ? ` (${count})` : '';
    });
  }

  function setMessage(message, type = 'error') {
    if (!els.cartMessage) return;
    els.cartMessage.textContent = message || '';
    els.cartMessage.dataset.messageType = type;
  }

  function detailLine(label, value) {
    return value ? `<p>${escapeHtml(label)}: ${escapeHtml(value)}</p>` : '';
  }

  function vehicleDisplay(item) {
    return [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ') || 'Vehicle details submitted';
  }

  function renderAppointmentItem(item, index) {
    const cityPostal = [item.city, item.postalCode].filter(Boolean).join(', ');
    return `
      <article class="cart-line">
        <span>Vehicle ${index + 1} appointment</span>
        <strong>${escapeHtml(item.serviceName || 'Appointment service')}</strong>
        ${detailLine('Vehicle', vehicleDisplay(item))}
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

  function renderInvalidItem(item, index) {
    return `
      <article class="cart-line cart-line-invalid">
        <span>Saved appointment ${index + 1}</span>
        <strong>${escapeHtml(item.serviceName || 'Appointment needs attention')}</strong>
        <p>${escapeHtml(item.invalidReason || 'This saved appointment could not be loaded. Please remove it and add your appointment again.')}</p>
        <div class="account-actions cart-line-actions">
          <button class="button button-secondary" type="button" data-remove-invalid-cart-item="${escapeHtml(stableKey(item))}">Remove this appointment</button>
          <a class="button button-primary" href="/appointment.html">Start new appointment</a>
        </div>
      </article>
    `;
  }

  function renderMismatchItem(item) {
    const originalEmail = item.customerEmail ? `Original account: ${item.customerEmail}` : 'This appointment belongs to another customer account.';
    return `
      <article class="cart-line cart-line-invalid">
        <span>Account mismatch</span>
        <strong>${escapeHtml(item.serviceName || 'Appointment from another account')}</strong>
        <p>${escapeHtml(ACCOUNT_MISMATCH_MESSAGE)}</p>
        <p>${escapeHtml(originalEmail)}</p>
        <div class="account-actions cart-line-actions">
          <button class="button button-secondary" type="button" data-logout-switch-account>Log out and switch account</button>
          <button class="button button-secondary" type="button" data-remove-stale-cart-item="${escapeHtml(stableKey(item))}">Remove this appointment</button>
          <a class="button button-primary" href="/appointment.html" data-start-new-appointment>Start new appointment</a>
        </div>
      </article>
    `;
  }

  function updateTotals() {
    const totals = state.totals;
    if (els.cartSubtotal) els.cartSubtotal.textContent = money(totals.subtotal);
    if (els.cartHst) els.cartHst.textContent = money(totals.hst);
    if (els.cartTotal) els.cartTotal.textContent = money(totals.total);
    if (els.cartDeposit) els.cartDeposit.textContent = money(totals.deposit);
    if (els.cartBalance) els.cartBalance.textContent = `${money(totals.remaining)} due on-site after service`;
  }

  function resetAgreement() {
    if (els.agreementCheckbox) els.agreementCheckbox.checked = false;
  }

  function renderCheckoutCustomer() {
    if (els.cartCustomer) {
      if (!state.authLoaded) els.cartCustomer.textContent = 'Checking account...';
      else if (state.profile) els.cartCustomer.textContent = `${state.profile.name || 'Customer'} - ${state.profile.email}${state.profile.phone ? ` - ${state.profile.phone}` : ''}`;
      else els.cartCustomer.textContent = 'Please sign up or log in before checkout.';
    }
    if (els.authBlock) els.authBlock.classList.toggle('is-visible', state.authLoaded && !state.profile);
  }

  function renderCartPage() {
    const snapshot = getRawCartSnapshot();
    state.validItems = snapshot.validItems;
    state.mismatchedItems = snapshot.mismatchedItems;
    state.invalidItems = snapshot.invalidItems;
    state.totals = getTotals(state.validItems);

    if (state.profile) {
      saveScopedCart(state.validItems);
      saveStaleCart(state.mismatchedItems);
    } else {
      setCartCount(0);
      saveStaleCart([]);
    }

    if (els.cartItems) {
      const validHtml = state.validItems.map(renderAppointmentItem).join('');
      const mismatchHtml = state.mismatchedItems.map(renderMismatchItem).join('');
      const invalidHtml = state.invalidItems.map(renderInvalidItem).join('');
      els.cartItems.innerHTML = validHtml || mismatchHtml || invalidHtml
        ? `${validHtml}${mismatchHtml}${invalidHtml}`
        : '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';
    }

    updateTotals();
    renderCheckoutCustomer();
    updateCheckoutButtonState();

    if (!state.validItems.length && !state.mismatchedItems.length && !state.invalidItems.length) {
      setMessage('Your cart is empty. Add an appointment to continue.', 'info');
    } else if (state.mismatchedItems.length) {
      setMessage(ACCOUNT_MISMATCH_MESSAGE, 'error');
    } else if (state.invalidItems.length && !state.validItems.length) {
      setMessage('Saved cart details could not be loaded. Please clear your cart and add your appointment again.', 'error');
    } else if (state.validItems.length) {
      setMessage('', 'info');
    }

    log('Cart rendered.', {
      authLoaded: state.authLoaded,
      loggedIn: Boolean(state.profile),
      validItems: state.validItems.length,
      mismatchedItems: state.mismatchedItems.length,
      invalidItems: state.invalidItems.length,
      deposit: state.totals.deposit,
    });
  }

  async function loadProfileAndRender() {
    renderCheckoutCustomer();
    try {
      state.profile = await window.EastCordAccount?.getCurrentProfile?.() || null;
    } catch (error) {
      logError('Customer profile could not be loaded for cart.', { message: error.message });
      state.profile = null;
    } finally {
      state.authLoaded = true;
      renderCartPage();
    }
  }

  function getCheckoutState() {
    const agreementAccepted = Boolean(els.agreementCheckbox?.checked);
    const validCartItemsCount = state.validItems.length;
    const depositAmount = state.totals.deposit;
    let failureMessage = '';

    console.info('Agreement checked:', agreementAccepted);
    console.info('Auth session loaded:', Boolean(state.authLoaded && state.profile));
    console.info('Customer profile loaded:', Boolean(state.profile?.customerId || state.profile?.email));
    console.info('Validated cart items count:', validCartItemsCount);
    console.info('Deposit amount:', depositAmount);

    if (!agreementAccepted) failureMessage = MESSAGES.agreement;
    else if (!state.authLoaded || !state.profile) failureMessage = MESSAGES.login;
    else if (!validCartItemsCount) failureMessage = MESSAGES.invalidCart;
    else if (depositAmount <= 0) failureMessage = MESSAGES.total;

    return {
      agreementAccepted,
      validCartItemsCount,
      depositAmount,
      failureMessage,
      canCheckout: !failureMessage && !state.checkoutInProgress,
    };
  }

  function updateCheckoutButtonState() {
    if (!els.checkoutButton) return;
    const checkoutState = getCheckoutState();
    els.checkoutButton.disabled = state.checkoutInProgress;
    els.checkoutButton.setAttribute('aria-disabled', String(!checkoutState.canCheckout));
    els.checkoutButton.dataset.checkoutBlockedReason = checkoutState.failureMessage || '';
    els.checkoutButton.style.pointerEvents = 'auto';
    if (!state.checkoutInProgress) els.checkoutButton.textContent = 'Secure Checkout';
    log('Checkout button state.', {
      canCheckout: checkoutState.canCheckout,
      failureMessage: checkoutState.failureMessage || 'none',
      physicallyDisabled: els.checkoutButton.disabled,
    });
  }

  function getTimeWindowStartMinutes(value) {
    const startText = String(value || '').split('-')[0].trim();
    const match = startText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3].toUpperCase();
    if (period === 'AM' && hours === 12) hours = 0;
    if (period === 'PM' && hours !== 12) hours += 12;
    return (hours * 60) + minutes;
  }

  function getAppointmentStartDate(item) {
    const startMinutes = getTimeWindowStartMinutes(item.preferredTimeWindow);
    if (!item.preferredDate || startMinutes === null) return null;
    const startDate = new Date(`${item.preferredDate}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return null;
    startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    return startDate;
  }

  function validateCartSlots(items) {
    const seenSlots = new Set();
    for (const item of items) {
      const startDate = getAppointmentStartDate(item);
      if (!startDate || startDate.getTime() <= Date.now()) return SLOT_UNAVAILABLE_MESSAGE;
      if (startDate.getTime() - Date.now() < MIN_ADVANCE_MINUTES * 60 * 1000) return SLOT_UNAVAILABLE_MESSAGE;
      const slotKey = `${item.preferredDate}__${item.preferredTimeWindow}`;
      if (seenSlots.has(slotKey)) return SLOT_UNAVAILABLE_MESSAGE;
      seenSlots.add(slotKey);
    }
    return '';
  }

  function buildNetlifyFormData(item, profile) {
    const formData = new FormData();
    formData.set('form-name', 'eastcord-changeover-appointment');
    formData.set('Customer ID', profile.customerId || '');
    formData.set('Customer Name', profile.name || '');
    formData.set('Customer Email', profile.email || '');
    formData.set('Customer Phone', profile.phone || '');
    formData.set('Service Needed', item.serviceName || '');
    formData.set('Starting Price', Number(item.startingPrice || item.serviceSubtotal || 0).toFixed(2));
    formData.set('Service Subtotal', Number(item.serviceSubtotal || 0).toFixed(2));
    formData.set('HST Amount', Number(item.hstAmount || 0).toFixed(2));
    formData.set('Total With HST', Number(item.totalWithHst || 0).toFixed(2));
    formData.set('Tax Rate', Number(item.taxRate || TAX_RATE).toFixed(2));
    formData.set('Booking Deposit', Number(item.depositAmount || 0).toFixed(2));
    formData.set('Remaining Balance', Number(item.remainingBalance || 0).toFixed(2));
    formData.set('Booking Status', 'Pending Confirmation');
    formData.set('Service area status', item.serviceAreaStatus || 'In service area');
    formData.set('stripe_session_id', item.stripeSessionId || '');
    formData.set('payment_status', item.paymentStatus || 'pending_checkout');
    formData.set('Preferred Date', item.preferredDate || '');
    formData.set('Preferred Time Window', item.preferredTimeWindow || '');
    formData.set('Vehicle Year', item.vehicleYear || '');
    formData.set('Vehicle Make', item.vehicleMake || '');
    formData.set('Vehicle Model', item.vehicleModel || '');
    formData.set('Vehicle Plate Number', item.vehiclePlateNumber || '');
    formData.set('Vehicle Colour', item.vehicleColour || '');
    formData.set('Tire Size', item.tireSize || '');
    formData.set('Tires Already On Rims', item.tiresAlreadyOnRims || '');
    formData.set('Number of Tires', item.numberOfTires || '');
    formData.set('Full Service Address', item.fullServiceAddress || '');
    formData.set('City', item.city || '');
    formData.set('Postal Code', item.postalCode || '');
    formData.set('Parking Driveway Access Notes', item.parkingAccessNotes || '');
    formData.set('Additional Notes', item.additionalNotes || '');
    return formData;
  }

  async function submitNetlifyFormBackup(formData) {
    const response = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(formData).toString(),
    });
    if (!response.ok) throw new Error('Netlify Forms backup did not save.');
  }

  async function ensureSupabaseBooking(item) {
    if (item.bookingId) return item;
    if (!window.EastCordAccount?.saveAppointmentBooking) throw new Error('Booking save is unavailable.');
    const bookingId = await window.EastCordAccount.saveAppointmentBooking(item, state.profile);
    return { ...item, bookingId, paymentStatus: 'pending_checkout' };
  }

  async function ensureAllSupabaseBookings(items) {
    const savedItems = [];
    for (const item of items) {
      savedItems.push(await ensureSupabaseBooking(item));
    }
    saveScopedCart(savedItems);
    state.validItems = savedItems;
    return savedItems;
  }

  async function startCheckout() {
    if (state.checkoutInProgress) return;
    const checkoutState = getCheckoutState();
    if (!checkoutState.canCheckout) {
      setMessage(checkoutState.failureMessage || MESSAGES.checkoutFailure, 'error');
      return;
    }

    const slotMessage = validateCartSlots(state.validItems);
    if (slotMessage) {
      setMessage(slotMessage, 'error');
      return;
    }

    try {
      state.checkoutInProgress = true;
      if (els.checkoutButton) {
        els.checkoutButton.disabled = true;
        els.checkoutButton.textContent = 'Preparing secure checkout...';
      }
      setMessage('Saving booking details and preparing secure checkout...', 'info');

      const bookingItems = await ensureAllSupabaseBookings(state.validItems);
      bookingItems.forEach((bookingItem) => {
        submitNetlifyFormBackup(buildNetlifyFormData(bookingItem, state.profile)).catch((error) => {
          logError('Netlify Forms backup failed after Supabase booking save.', { message: error.message });
        });
      });

      const token = await window.EastCordAccount?.getAccessToken?.() || '';
      console.info(`Calling checkout function: ${CHECKOUT_FUNCTION_PATH}`);
      const response = await fetch(CHECKOUT_FUNCTION_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ items: bookingItems, customer: state.profile }),
      });
      console.info(`Checkout function response status: ${response.status}`);
      const data = await response.json().catch(() => ({}));
      console.info(`Checkout URL received: ${Boolean(data.url)}`);

      if (!response.ok || !data.url) {
        logError('Checkout function returned an error.', { status: response.status, response: data });
        throw new Error(MESSAGES.checkoutFailure);
      }

      console.info('Redirecting to Stripe Checkout');
      window.location.href = data.url;
    } catch (error) {
      logError('Checkout could not be started.', { message: error.message });
      state.checkoutInProgress = false;
      setMessage(MESSAGES.checkoutFailure, 'error');
      updateCheckoutButtonState();
    }
  }

  function removeValidItem(index) {
    const nextItems = state.validItems.filter((_, itemIndex) => itemIndex !== index);
    saveScopedCart(nextItems);
    resetAgreement();
    state.validItems = nextItems;
    state.totals = getTotals(nextItems);
    setMessage(nextItems.length ? 'Appointment removed from cart.' : 'Cart is empty.', 'success');
    renderCartPage();
  }

  function removeStoredItemByKey(targetKey) {
    const removeFromStorageKey = (storage, key) => {
      const kept = normalizeCartCollection(readJson(storage, key, [])).filter((item) => stableKey(item) !== targetKey && item.id !== targetKey && item.bookingId !== targetKey);
      if (kept.length) writeJson(storage, key, kept);
      else removeKey(storage, key);
    };

    allCartStorageKeys({ includeAccountKeys: true }).forEach((key) => {
      removeFromStorageKey(localStorage, key);
      removeFromStorageKey(sessionStorage, key);
    });
    resetAgreement();
    renderCartPage();
  }

  async function logoutAndSwitchAccount() {
    clearCartStorage({ includeDrafts: false });
    const client = window.EastCordAccount?.getSupabaseClient?.();
    if (client) await client.auth.signOut();
    window.location.href = '/login.html';
  }

  function openAgreementModal() {
    if (!els.agreementModal) return;
    els.agreementModal.hidden = false;
    document.body.classList.add('agreement-modal-open');
    window.setTimeout(() => els.agreementPanel?.focus(), 0);
  }

  function closeAgreementModal() {
    if (!els.agreementModal) return;
    els.agreementModal.hidden = true;
    document.body.classList.remove('agreement-modal-open');
    els.agreementOpenButton?.focus();
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const checkoutButton = event.target.closest('[data-checkout-button]');
      if (checkoutButton) {
        console.info('Checkout clicked');
        event.preventDefault();
        event.stopImmediatePropagation();
        startCheckout();
        return;
      }

      const removeButton = event.target.closest('[data-remove-cart-item]');
      if (removeButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        removeValidItem(Number(removeButton.dataset.removeCartIndex));
        return;
      }

      const invalidRemove = event.target.closest('[data-remove-invalid-cart-item], [data-remove-stale-cart-item]');
      if (invalidRemove) {
        event.preventDefault();
        event.stopImmediatePropagation();
        removeStoredItemByKey(invalidRemove.dataset.removeInvalidCartItem || invalidRemove.dataset.removeStaleCartItem || '');
        return;
      }

      const clearButton = event.target.closest('[data-clear-cart]');
      if (clearButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearCartStorage({ includeDrafts: true });
        resetAgreement();
        setMessage('Cart cleared.', 'success');
        renderCartPage();
        return;
      }

      const switchButton = event.target.closest('[data-logout-switch-account]');
      if (switchButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        logoutAndSwitchAccount();
        return;
      }

      const logoutButton = event.target.closest('[data-logout-button]');
      if (logoutButton) {
        clearCartStorage({ includeDrafts: false });
      }
    }, true);

    els.agreementCheckbox?.addEventListener('change', () => {
      updateCheckoutButtonState();
      const checkoutState = getCheckoutState();
      if (checkoutState.canCheckout) setMessage('', 'info');
    });
    els.agreementOpenButton?.addEventListener('click', openAgreementModal);
    els.agreementCloseButtons.forEach((button) => button.addEventListener('click', closeAgreementModal));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.agreementModal && !els.agreementModal.hidden) closeAgreementModal();
    });
    window.addEventListener('storage', renderCartPage);
    window.addEventListener('eastcord:cart-cleared', renderCartPage);
    window.addEventListener('eastcord:cart-updated', renderCartPage);
  }

  function init() {
    cacheElements();
    if (!els.cartItems) return;
    log('cart.js unified controller loaded.');
    renderCheckoutCustomer();
    updateTotals();
    bindEvents();
    loadProfileAndRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
