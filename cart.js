const cartItems = document.querySelector('[data-cart-items]');
const cartCustomer = document.querySelector('[data-cart-customer]');
const cartSubtotal = document.querySelector('[data-cart-subtotal]');
const cartHst = document.querySelector('[data-cart-hst]');
const cartTotal = document.querySelector('[data-cart-total]');
const cartDeposit = document.querySelector('[data-cart-deposit]');
const cartBalance = document.querySelector('[data-cart-balance]');
const cartMessage = document.querySelector('[data-cart-message]');
const checkoutButton = document.querySelector('[data-checkout-button]');
const clearCartButton = document.querySelector('[data-clear-cart]');
const authBlock = document.querySelector('[data-checkout-auth-block]');
const agreementCheckbox = document.querySelector('[data-agreement-checkbox]');
const agreementOpenButton = document.querySelector('[data-agreement-open]');
const agreementModal = document.querySelector('[data-agreement-modal]');
const agreementCloseButtons = Array.from(document.querySelectorAll('[data-agreement-close]'));
const agreementPanel = agreementModal?.querySelector('.agreement-modal-panel');
const MIN_ADVANCE_MINUTES = 120;
const TAX_RATE = 0.13;
const ACTIVE_CART_KEY = 'eastcord_cart_v1';
const SLOT_UNAVAILABLE_MESSAGE = 'One or more appointment times are no longer available. Please choose another time.';
const CART_STORAGE_KEYS = [
  ACTIVE_CART_KEY,
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
let accountCartHydrated = false;

const SERVICE_SUBTOTALS = {
  'seasonal-changeover-rims': 40,
  'seasonal-swap-not-mounted': 80,
  'mount-balance-1': 25,
  'mount-balance-2': 50,
  'mount-balance-3': 75,
  'mount-balance-4': 100,
};

function logDeveloperError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, error);
}

function logCartDiagnostic(message, details = {}) {
  console.info(`[EastCord appointment automation] ${message}`, details);
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

function numberOrZero(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function getFirstValue(item, names, fallback = '') {
  for (const name of names) {
    if (item[name] !== undefined && item[name] !== null && item[name] !== '') return item[name];
  }
  return fallback;
}

function unwrapCartItem(item) {
  if (!item || typeof item !== 'object') return item;
  if (item.item && typeof item.item === 'object') return { ...item.item, cartIndex: item.cartIndex ?? item.item.cartIndex };
  if (item.appointment && typeof item.appointment === 'object') return { ...item.appointment, cartIndex: item.cartIndex ?? item.appointment.cartIndex };
  if (item.booking && typeof item.booking === 'object') return { ...item.booking, cartIndex: item.cartIndex ?? item.booking.cartIndex };
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

function normalizeAppointmentItem(item, cartIndex = 0) {
  const source = unwrapCartItem(item);
  if (!source || typeof source !== 'object') return null;

  const serviceId = getFirstValue(source, ['serviceId', 'service_id']);
  const serviceSubtotal = getFirstValue(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price'], SERVICE_SUBTOTALS[serviceId] || 0);

  return {
    ...source,
    id: getFirstValue(source, ['id', 'cartId', 'cart_id'], `cart-item-${cartIndex}`),
    type: source.type || 'appointment',
    cartIndex: source.cartIndex ?? cartIndex,
    customerId: getFirstValue(source, ['customerId', 'customer_id']),
    customerName: getFirstValue(source, ['customerName', 'customer_name']),
    customerEmail: getFirstValue(source, ['customerEmail', 'customer_email']),
    customerPhone: getFirstValue(source, ['customerPhone', 'customer_phone']),
    serviceId,
    serviceName: getFirstValue(source, ['serviceName', 'service_name']),
    startingPrice: getFirstValue(source, ['startingPrice', 'starting_price'], serviceSubtotal),
    serviceSubtotal,
    hstAmount: getFirstValue(source, ['hstAmount', 'hst_amount']),
    totalWithHst: getFirstValue(source, ['totalWithHst', 'total_with_hst']),
    taxRate: getFirstValue(source, ['taxRate', 'tax_rate'], TAX_RATE),
    depositAmount: getFirstValue(source, ['depositAmount', 'deposit_amount']),
    remainingBalance: getFirstValue(source, ['remainingBalance', 'remaining_balance']),
    preferredDate: getFirstValue(source, ['preferredDate', 'preferred_date']),
    preferredTimeWindow: getFirstValue(source, ['preferredTimeWindow', 'preferred_time_window']),
    vehicleYear: getFirstValue(source, ['vehicleYear', 'vehicle_year']),
    vehicleMake: getFirstValue(source, ['vehicleMake', 'vehicle_make']),
    vehicleModel: getFirstValue(source, ['vehicleModel', 'vehicle_model']),
    vehiclePlateNumber: getFirstValue(source, ['vehiclePlateNumber', 'vehicle_plate_number']),
    vehicleColour: getFirstValue(source, ['vehicleColour', 'vehicle_colour']),
    tireSize: getFirstValue(source, ['tireSize', 'tire_size']),
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
  const normalizeList = (items) => items
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => normalizeAppointmentItem(item, index))
    .filter(Boolean);

  if (Array.isArray(value)) return normalizeList(value);

  if (value && typeof value === 'object') {
    const nestedCart = value.items || value.cart || value.appointments || value.appointmentItems;
    if (Array.isArray(nestedCart)) return normalizeList(nestedCart);
    if (isAppointmentLikeItem(value)) return normalizeList([value]);
  }

  return [];
}

function readStorageJson(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    logDeveloperError(`Stored cart value could not be parsed for ${key}.`, error);
    return null;
  }
}

function getStorageKeys(storage) {
  const keys = [];
  if (!storage) return keys;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  return keys;
}

function isCartRelatedStorageKey(key) {
  return CART_RESET_STORAGE_KEYS.includes(key)
    || /appointment/i.test(key)
    || /pendingAppointment/i.test(key)
    || /appointmentDraft/i.test(key)
    || /savedAppointment/i.test(key);
}

function getRawStorageItemCount() {
  const storages = [localStorage, sessionStorage];
  return storages.reduce((count, storage) => {
    return count + getStorageKeys(storage)
      .filter(isCartRelatedStorageKey)
      .reduce((storageCount, key) => {
        const normalized = normalizeCartCollection(readStorageJson(storage, key));
        return storageCount + normalized.length;
      }, 0);
  }, 0);
}

function hasAppointmentLikeItems(items) {
  return items.some((item) => isAppointmentLikeItem(item));
}

function getCartFromKnownStorage() {
  const activeCart = normalizeCartCollection(readStorageJson(localStorage, ACTIVE_CART_KEY));
  if (hasAppointmentLikeItems(activeCart)) return activeCart;

  const sharedCart = normalizeCartCollection(window.EastCordAccount?.getCart?.());
  if (hasAppointmentLikeItems(sharedCart)) return sharedCart;

  const storageSources = [localStorage, sessionStorage];
  for (const storage of storageSources) {
    for (const key of CART_STORAGE_KEYS) {
      const normalized = normalizeCartCollection(readStorageJson(storage, key));
      if (hasAppointmentLikeItems(normalized)) return normalized;
    }
  }

  return [];
}

function hardClearCartStorage() {
  const localKeysBefore = getStorageKeys(localStorage).filter(isCartRelatedStorageKey);
  const sessionKeysBefore = getStorageKeys(sessionStorage).filter(isCartRelatedStorageKey);

  console.info('[EastCord appointment automation] Hard clearing cart storage.', {
    localKeysBefore,
    sessionKeysBefore,
    cartItemCountBefore: getRawStorageItemCount(),
  });

  localKeysBefore.forEach((key) => localStorage.removeItem(key));
  sessionKeysBefore.forEach((key) => sessionStorage.removeItem(key));
  localStorage.setItem(ACTIVE_CART_KEY, '[]');

  if (window.EastCordAccount?.saveCart) {
    window.EastCordAccount.saveCart([]);
  } else {
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
      element.textContent = '';
    });
  }

  console.info('[EastCord appointment automation] Cart storage hard cleared.', {
    localKeysAfter: getStorageKeys(localStorage).filter(isCartRelatedStorageKey),
    sessionKeysAfter: getStorageKeys(sessionStorage).filter(isCartRelatedStorageKey),
    cartItemCountAfter: getRawStorageItemCount(),
  });
}

function updateVisibleCartCount(count) {
  document.querySelectorAll('[data-cart-count]').forEach((element) => {
    element.textContent = count ? ` (${count})` : '';
  });
}

function getServiceSubtotal(item) {
  const normalized = normalizeAppointmentItem(item, item.cartIndex || 0) || item;
  const directSubtotal = numberOrZero(normalized.serviceSubtotal);
  if (directSubtotal > 0) return directSubtotal;

  const startingPrice = numberOrZero(normalized.startingPrice);
  if (startingPrice > 0) return startingPrice;

  const servicePrice = SERVICE_SUBTOTALS[normalized.serviceId];
  if (servicePrice > 0) return servicePrice;

  return 0;
}

function withTaxBreakdown(item, cartIndex = 0) {
  const normalizedItem = normalizeAppointmentItem(item, cartIndex) || item;
  const serviceSubtotal = getServiceSubtotal(normalizedItem);
  const id = normalizedItem.id || `cart-item-${cartIndex}`;

  if (!serviceSubtotal) {
    return {
      ...normalizedItem,
      id,
      cartIndex,
      type: 'appointment',
      isInvalidCartItem: true,
      invalidReason: 'This appointment is missing service pricing. Please remove it and add the appointment again.',
      startingPrice: 0,
      serviceSubtotal: 0,
      hstAmount: 0,
      totalWithHst: 0,
      taxRate: TAX_RATE,
      depositAmount: 0,
      remainingBalance: 0,
    };
  }

  const calculated = calculateTaxBreakdown(serviceSubtotal);

  return {
    ...normalizedItem,
    id,
    cartIndex,
    type: 'appointment',
    startingPrice: calculated.serviceSubtotal,
    serviceSubtotal: calculated.serviceSubtotal,
    hstAmount: calculated.hstAmount,
    totalWithHst: calculated.totalWithHst,
    taxRate: calculated.taxRate,
    depositAmount: calculated.depositAmount,
    remainingBalance: calculated.remainingBalance,
  };
}

function formatMoney(value) {
  if (window.EastCordAccount?.money) return window.EastCordAccount.money(value);
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function showCartMessage(message, type = 'error') {
  if (!cartMessage) return;
  cartMessage.textContent = message;
  cartMessage.dataset.messageType = type;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
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

function detailLine(label, value, fallback = '') {
  const displayValue = value || fallback;
  if (!displayValue) return '';
  return `<p>${escapeHtml(label)}: ${escapeHtml(displayValue)}</p>`;
}

function getVehicleDetails(item) {
  return {
    vehicle: [item.vehicleYear, titleCase(item.vehicleMake), titleCase(item.vehicleModel)].filter(Boolean).join(' ') || 'Vehicle details submitted',
    plate: formatPlate(item.vehiclePlateNumber) || 'Not provided',
    colour: titleCase(item.vehicleColour) || 'Not provided',
    tireSize: formatTireSize(item.tireSize) || 'Not provided',
    tireCount: item.numberOfTires || 'Not provided',
  };
}

function isAgreementAccepted() {
  return Boolean(agreementCheckbox?.checked);
}

function resetAgreement() {
  if (agreementCheckbox) agreementCheckbox.checked = false;
  updateCheckoutButtonState();
}

function getAppointmentItems() {
  const rawCart = getCartFromKnownStorage();
  const appointmentItems = rawCart
    .map((item, cartIndex) => normalizeAppointmentItem(item, cartIndex))
    .filter((item) => {
      const isAppointment = isAppointmentLikeItem(item);
      if (!isAppointment) {
        logCartDiagnostic('Cart item skipped because it did not match appointment shape.', {
          keys: item && typeof item === 'object' ? Object.keys(item) : [],
        });
      }
      return isAppointment;
    })
    .map((item, cartIndex) => withTaxBreakdown(item, item.cartIndex ?? cartIndex));

  logCartDiagnostic('Cart items loaded.', {
    rawCount: rawCart.length,
    validAppointmentCount: appointmentItems.filter((item) => !item.isInvalidCartItem).length,
    invalidAppointmentCount: appointmentItems.filter((item) => item.isInvalidCartItem).length,
    rawItemKeys: rawCart.map((item) => (item && typeof item === 'object' ? Object.keys(item) : [])),
  });

  if (getRawStorageItemCount() && !appointmentItems.length) {
    logDeveloperError('Cart storage contains saved values, but none matched appointment item shape.', {
      cartRelatedStorageKeys: [
        ...getStorageKeys(localStorage).filter(isCartRelatedStorageKey),
        ...getStorageKeys(sessionStorage).filter(isCartRelatedStorageKey),
      ],
    });
  }

  return appointmentItems;
}

function getValidAppointmentItems() {
  return getAppointmentItems().filter((item) => !item.isInvalidCartItem);
}

function updateCheckoutButtonState() {
  if (!checkoutButton) return;
  const hasValidItems = getValidAppointmentItems().length > 0;
  checkoutButton.disabled = !isAgreementAccepted() || !hasValidItems;
}

function openAgreementModal() {
  if (!agreementModal) return;
  agreementModal.hidden = false;
  document.body.classList.add('agreement-modal-open');
  window.setTimeout(() => agreementPanel?.focus(), 0);
}

function closeAgreementModal() {
  if (!agreementModal) return;
  agreementModal.hidden = true;
  document.body.classList.remove('agreement-modal-open');
  agreementOpenButton?.focus();
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

function isPastAppointmentSlot(item) {
  const startDate = getAppointmentStartDate(item);
  if (!startDate) return true;
  return startDate.getTime() <= Date.now();
}

function isLessThanMinimumAdvance(item) {
  const startDate = getAppointmentStartDate(item);
  if (!startDate) return true;
  return startDate.getTime() - Date.now() < MIN_ADVANCE_MINUTES * 60 * 1000;
}

function validateCartSlots(items) {
  const seenSlots = new Set();

  for (const item of items) {
    if (isPastAppointmentSlot(item) || isLessThanMinimumAdvance(item)) {
      return SLOT_UNAVAILABLE_MESSAGE;
    }

    const slotKey = `${item.preferredDate}__${item.preferredTimeWindow}`;
    if (seenSlots.has(slotKey)) {
      return SLOT_UNAVAILABLE_MESSAGE;
    }
    seenSlots.add(slotKey);
  }

  return '';
}

function renderInvalidCartItem(item, index) {
  return `
    <article class="cart-line cart-line-invalid">
      <span>Vehicle ${index + 1} appointment</span>
      <strong>${escapeHtml(item.serviceName || 'Appointment item needs attention')}</strong>
      <p>${escapeHtml(item.invalidReason || 'This appointment item could not be read. Please remove it and add the appointment again.')}</p>
      <div class="account-actions cart-line-actions">
        <button class="button button-secondary" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-index="${escapeHtml(item.cartIndex)}">Remove this appointment</button>
      </div>
    </article>
  `;
}

function renderCartItem(item, index) {
  if (item.isInvalidCartItem) return renderInvalidCartItem(item, index);

  const vehicle = getVehicleDetails(item);
  const cityPostal = [item.city, item.postalCode].filter(Boolean).join(', ');
  return `
    <article class="cart-line">
      <span>Vehicle ${index + 1} appointment</span>
      <strong>${escapeHtml(item.serviceName || 'Appointment service')}</strong>
      ${detailLine('Vehicle', vehicle.vehicle)}
      ${detailLine('Plate Number', vehicle.plate)}
      ${detailLine('Colour', vehicle.colour)}
      ${detailLine('Tire Size', vehicle.tireSize)}
      ${detailLine('Tires', vehicle.tireCount)}
      ${detailLine('Address', item.fullServiceAddress)}
      ${detailLine('City/Postal', cityPostal)}
      ${detailLine('Date', item.preferredDate)}
      ${detailLine('Time', item.preferredTimeWindow)}
      ${detailLine('Service Subtotal', formatMoney(item.serviceSubtotal))}
      ${detailLine('HST 13%', formatMoney(item.hstAmount))}
      ${detailLine('Total Including HST', formatMoney(item.totalWithHst))}
      ${detailLine('Deposit Due Today', formatMoney(item.depositAmount))}
      ${detailLine('Remaining On-Site', formatMoney(item.remainingBalance))}
      <p>Your appointment will be confirmed automatically after successful deposit payment.</p>
      <div class="account-actions cart-line-actions">
        <button class="button button-secondary" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-index="${escapeHtml(item.cartIndex)}">Remove this appointment</button>
      </div>
    </article>
  `;
}

function renderCartTotals(items) {
  const validItems = items.filter((item) => !item.isInvalidCartItem);
  const subtotalTotal = roundMoney(validItems.reduce((sum, item) => sum + Number(item.serviceSubtotal || 0), 0));
  const hstTotal = roundMoney(validItems.reduce((sum, item) => sum + Number(item.hstAmount || 0), 0));
  const totalWithHst = roundMoney(validItems.reduce((sum, item) => sum + Number(item.totalWithHst || 0), 0));
  const depositTotal = roundMoney(validItems.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0));
  const balanceTotal = roundMoney(validItems.reduce((sum, item) => sum + Number(item.remainingBalance || 0), 0));

  if (cartSubtotal) cartSubtotal.textContent = formatMoney(subtotalTotal);
  if (cartHst) cartHst.textContent = formatMoney(hstTotal);
  if (cartTotal) cartTotal.textContent = formatMoney(totalWithHst);
  if (cartDeposit) cartDeposit.textContent = formatMoney(depositTotal);
  if (cartBalance) cartBalance.textContent = `${formatMoney(balanceTotal)} due on-site after service`;
}

function renderCartItemsAndTotals() {
  const items = getAppointmentItems();
  const rawStoredCount = getRawStorageItemCount();

  if (cartItems) {
    if (items.length) {
      cartItems.innerHTML = items.map(renderCartItem).join('');
    } else if (rawStoredCount) {
      cartItems.innerHTML = '<p class="empty-cart">Some saved cart details could not be loaded. Please clear your cart and add your appointment again.</p>';
    } else {
      cartItems.innerHTML = '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';
    }
  }

  renderCartTotals(items);
  updateVisibleCartCount(items.length);

  const invalidCount = items.filter((item) => item.isInvalidCartItem).length;
  if (invalidCount) {
    showCartMessage('One or more appointments in your cart needs attention. Please remove the item and add it again before checkout.');
  } else if (rawStoredCount && !items.length) {
    showCartMessage('Some saved cart details could not be loaded. Please clear your cart and add your appointment again.');
  } else if (cartMessage?.textContent?.includes('needs attention') || cartMessage?.textContent?.includes('could not be loaded')) {
    showCartMessage('', 'info');
  }

  updateCheckoutButtonState();
  return items;
}

async function hydrateCartProfile() {
  let profile = null;

  try {
    profile = await window.EastCordAccount.getCurrentProfile();
  } catch (error) {
    logDeveloperError('Cart profile lookup failed; cart items were still rendered.', error);
  }

  if (cartCustomer) {
    cartCustomer.textContent = profile
      ? `${profile.name || 'Customer'} - ${profile.email}${profile.phone ? ` - ${profile.phone}` : ''}`
      : 'Please sign up or log in before checkout.';
  }
  if (authBlock) authBlock.classList.toggle('is-visible', !profile);

  if (profile && !accountCartHydrated) {
    try {
      const mergedCart = await window.EastCordAccount.loadCustomerCart('appointment', getCartFromKnownStorage());
      localStorage.setItem(ACTIVE_CART_KEY, JSON.stringify(mergedCart));
      accountCartHydrated = true;
      renderCartItemsAndTotals();
    } catch (error) {
      logDeveloperError('Saved appointment cart could not be loaded from the customer account.', error);
      showCartMessage(error.message || 'Your saved account cart could not be loaded.', 'info');
    }
  }

  if (!window.EastCordAccount.isAuthConfigured()) {
    showCartMessage(window.EastCordAccount.setupMessage || 'Account system is being connected. Please check back soon.', 'info');
  }

  updateCheckoutButtonState();
  return profile;
}

function renderCart() {
  renderCartItemsAndTotals();
  hydrateCartProfile();
}

window.addEventListener('eastcord:account-carts-hydrated', () => {
  renderCartItemsAndTotals();
});

function removeCartItem(itemId, itemIndex) {
  const currentCart = getCartFromKnownStorage();
  const numericIndex = Number(itemIndex);
  const hasMatchingId = Boolean(itemId) && currentCart.some((item) => item.id === itemId);
  const nextCart = currentCart.filter((item, index) => {
    if (hasMatchingId) return item.id !== itemId;
    return index !== numericIndex;
  });

  if (nextCart.length === currentCart.length) {
    showCartMessage('This appointment could not be found in your cart. Please refresh and try again.');
    return;
  }

  window.EastCordAccount.saveCart(nextCart);
  resetAgreement();
  showCartMessage('Appointment removed from cart.', 'success');
  renderCart();
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

  if (!response.ok) {
    throw new Error('Netlify Forms backup did not save.');
  }
}

async function ensureSupabaseBooking(item, profile) {
  if (item.bookingId) return item;
  const normalizedItem = withTaxBreakdown(item, item.cartIndex || 0);
  const bookingId = await window.EastCordAccount.saveAppointmentBooking(normalizedItem, profile);
  const updatedItem = { ...normalizedItem, bookingId, paymentStatus: 'pending_checkout' };
  const cart = getCartFromKnownStorage().map((cartItem, index) => (index === item.cartIndex || cartItem.id === item.id ? updatedItem : cartItem));
  window.EastCordAccount.saveCart(cart);
  return updatedItem;
}

async function ensureAllSupabaseBookings(items, profile) {
  const savedItems = [];
  for (const item of items) {
    savedItems.push(await ensureSupabaseBooking(item, profile));
  }
  return savedItems;
}

async function startCheckout() {
  const items = getAppointmentItems();
  const validItems = items.filter((item) => !item.isInvalidCartItem);

  if (!isAgreementAccepted()) {
    showCartMessage('Please review and accept the Mobile Service Agreement before checkout.');
    return;
  }

  if (!validItems.length) {
    showCartMessage(items.length ? 'Please remove the invalid appointment item and add it again before checkout.' : 'Add an appointment service before checkout.');
    return;
  }

  if (validItems.length !== items.length) {
    showCartMessage('Please remove the invalid appointment item and add it again before checkout.');
    return;
  }

  if (!window.EastCordAccount.isAuthConfigured()) {
    showCartMessage(window.EastCordAccount.setupMessage || 'Account system is being connected. Please check back soon.');
    logDeveloperError('Checkout attempted before Supabase env vars were configured.', window.EASTCORD_AUTH_CONFIG || {});
    return;
  }

  const profile = await window.EastCordAccount.getCurrentProfile();

  if (!profile) {
    if (authBlock) authBlock.classList.add('is-visible');
    showCartMessage('Please sign up or log in before checkout.');
    return;
  }

  const cartSlotMessage = validateCartSlots(validItems);
  if (cartSlotMessage) {
    showCartMessage(cartSlotMessage);
    return;
  }

  try {
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Preparing secure checkout...';
    showCartMessage('Saving booking details and preparing secure checkout...', 'info');

    const bookingItems = await ensureAllSupabaseBookings(validItems, profile);

    bookingItems.forEach((bookingItem) => {
      submitNetlifyFormBackup(buildNetlifyFormData(bookingItem, profile)).catch((error) => {
        logDeveloperError('Netlify Forms backup failed after Supabase booking save.', error);
      });
    });

    const token = await window.EastCordAccount.getAccessToken();
    const response = await fetch('/.netlify/functions/create-appointment-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ items: bookingItems, customer: profile }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.url) {
      logDeveloperError('Checkout function returned an error.', {
        status: response.status,
        response: data,
      });
      throw new Error(data.message || 'Online checkout is being connected. Please check back soon.');
    }

    window.location.href = data.url;
  } catch (error) {
    logDeveloperError('Checkout could not be started.', error);
    showCartMessage(error.message || 'Online checkout is being connected. Please check back soon.');
    checkoutButton.textContent = 'Secure Checkout';
    updateCheckoutButtonState();
  }
}

cartItems?.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-cart-item]');
  if (!removeButton) return;
  removeCartItem(removeButton.dataset.removeCartItem, removeButton.dataset.removeCartIndex);
});
agreementCheckbox?.addEventListener('change', updateCheckoutButtonState);
agreementOpenButton?.addEventListener('click', openAgreementModal);
agreementCloseButtons.forEach((button) => button.addEventListener('click', closeAgreementModal));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && agreementModal && !agreementModal.hidden) closeAgreementModal();
});
checkoutButton?.addEventListener('click', startCheckout);
clearCartButton?.addEventListener('click', () => {
  hardClearCartStorage();
  resetAgreement();
  showCartMessage('Cart cleared.', 'success');
  renderCart();
});

updateCheckoutButtonState();
renderCart();
