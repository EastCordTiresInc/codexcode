const cartCustomer = document.querySelector('[data-cart-customer]');
const cartSubtotal = document.querySelector('[data-cart-subtotal]');
const cartHst = document.querySelector('[data-cart-hst]');
const cartTotal = document.querySelector('[data-cart-total]');
const cartDeposit = document.querySelector('[data-cart-deposit]');
const cartBalance = document.querySelector('[data-cart-balance]');
const cartMessage = document.querySelector('[data-cart-message], [data-appointment-pay-message]');
const checkoutButton = document.querySelector('[data-checkout-button]');
const clearCartButton = document.querySelector('[data-clear-cart]');
const authBlock = document.querySelector('[data-checkout-auth-block], [data-appointment-pay-auth]');
const agreementCheckbox = document.querySelector('[data-agreement-checkbox]');
const agreementOpenButton = document.querySelector('[data-agreement-open]');
const agreementModal = document.querySelector('[data-agreement-modal]');
const agreementCloseButtons = Array.from(document.querySelectorAll('[data-agreement-close]'));
const agreementPanel = agreementModal?.querySelector('.agreement-modal-panel');
const MIN_ADVANCE_MINUTES = 120;
const NEW_TIRE_SHIPPING_DAYS = 4;
const SERVICE_START_MINUTES = 8 * 60;
const SERVICE_END_MINUTES = 20 * 60;
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
let lastKnownCartProfile = null;
let lastRenderedCheckoutItems = [];
let checkoutInProgress = false;

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
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  if (
    item.type === 'appointment'
    || item.serviceId
    || item.service_id
    || item.serviceName
    || item.service_name
    || item.bookingId
    || item.booking_id
  ) {
    return item;
  }
  if (item.item && typeof item.item === 'object' && !Array.isArray(item.item)) {
    return { ...item.item, cartIndex: item.cartIndex ?? item.item.cartIndex };
  }
  if (item.appointment && typeof item.appointment === 'object' && !Array.isArray(item.appointment)) {
    return { ...item.appointment, cartIndex: item.cartIndex ?? item.appointment.cartIndex };
  }
  if (item.booking && typeof item.booking === 'object' && !Array.isArray(item.booking)) {
    return { ...item.booking, cartIndex: item.cartIndex ?? item.booking.cartIndex };
  }
  return item;
}

function isAppointmentLikeItem(item) {
  const source = unwrapCartItem(item);
  if (!source || typeof source !== 'object') return false;
  if (source.type === 'appointment') return true;
  if (source.type === 'used_tire' || source.inventoryId || source.inventory_id) return false;
  return Boolean(source.serviceId || source.service_id)
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

function getCartItemsContainer() {
  return document.querySelector('[data-cart-items]');
}

function readAccountCart() {
  try {
    const cart = window.EastCordAccount?.getCart?.();
    return Array.isArray(cart) ? cart.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
  } catch (error) {
    logDeveloperError('Shared appointment cart could not be read.', error);
    return [];
  }
}

function getCartFromKnownStorage() {
  if (window.EastCordAccount?.getCart) {
    return readAccountCart();
  }

  const candidates = [
    normalizeCartCollection(readStorageJson(localStorage, ACTIVE_CART_KEY)),
  ];

  const storageSources = [localStorage, sessionStorage];
  for (const storage of storageSources) {
    for (const key of CART_STORAGE_KEYS) {
      candidates.push(normalizeCartCollection(readStorageJson(storage, key)));
    }
  }

  return candidates.reduce((best, cart) => {
    const appointmentCart = cart.filter((item) => isAppointmentLikeItem(item));
    return appointmentCart.length > best.length ? appointmentCart : best;
  }, []);
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
    if (window.EastCordAccount?.updateCartCount) {
      window.EastCordAccount.updateCartCount();
    } else {
      document.querySelectorAll('[data-appointment-cart-count], [data-cart-count]').forEach((element) => {
        const href = element.closest('a')?.getAttribute('href') || '';
        if (/tire-cart/.test(href)) return;
        element.textContent = '';
      });
    }
  }

  console.info('[EastCord appointment automation] Cart storage hard cleared.', {
    localKeysAfter: getStorageKeys(localStorage).filter(isCartRelatedStorageKey),
    sessionKeysAfter: getStorageKeys(sessionStorage).filter(isCartRelatedStorageKey),
    cartItemCountAfter: getRawStorageItemCount(),
  });
}

function updateVisibleCartCount(count) {
  if (window.EastCordAccount?.updateCartCount) {
    window.EastCordAccount.updateCartCount();
    return;
  }
  document.querySelectorAll('[data-appointment-cart-count], [data-cart-count]').forEach((element) => {
    const href = element.closest('a')?.getAttribute('href') || '';
    if (/tire-cart/.test(href)) return;
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
  if (message) cartMessage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    .map((item, cartIndex) => {
      try {
        const normalized = normalizeAppointmentItem(item, cartIndex) || item;
        return withTaxBreakdown(normalized, normalized.cartIndex ?? cartIndex);
      } catch (error) {
        logDeveloperError('Cart item could not be normalized.', error);
        return {
          id: item?.id || `cart-item-${cartIndex}`,
          type: 'appointment',
          cartIndex,
          serviceName: item?.serviceName || item?.service_name || 'Appointment',
          isInvalidCartItem: true,
          invalidReason: 'This appointment could not be displayed. Please remove it and add it again.',
        };
      }
    })
    .filter(Boolean);

  logCartDiagnostic('Cart items loaded.', {
    rawCount: rawCart.length,
    validAppointmentCount: appointmentItems.filter((item) => !item.isInvalidCartItem).length,
    invalidAppointmentCount: appointmentItems.filter((item) => item.isInvalidCartItem).length,
    rawItemKeys: rawCart.map((item) => (item && typeof item === 'object' ? Object.keys(item) : [])),
  });

  return appointmentItems;
}

function getCheckoutItems() {
  try {
    const renderedItems = getAppointmentItems().filter((item) => item && !item.isInvalidCartItem);
    if (renderedItems.length) return renderedItems;
  } catch (error) {
    logDeveloperError('Rendered appointment items could not be read for checkout.', error);
  }

  try {
    const storedItems = (window.EastCordAccount?.getCart?.() || [])
      .map((item, cartIndex) => {
        const normalized = normalizeAppointmentItem(item, cartIndex) || item;
        return withTaxBreakdown(normalized, cartIndex);
      })
      .filter((item) => item && (item.serviceId || item.serviceName) && !item.isInvalidCartItem);
    if (storedItems.length) return storedItems;
  } catch (error) {
    logDeveloperError('Stored appointment cart could not be read for checkout.', error);
  }

  return lastRenderedCheckoutItems.filter((item) => item && !item.isInvalidCartItem);
}

function getValidAppointmentItems() {
  return getCheckoutItems();
}

function setCheckoutBusy(isBusy, label = 'Secure Checkout') {
  const button = document.querySelector('[data-checkout-button]') || checkoutButton;
  if (!button) return button;
  button.dataset.checkoutBusy = isBusy ? 'true' : 'false';
  button.disabled = Boolean(isBusy);
  button.toggleAttribute('disabled', Boolean(isBusy));
  button.setAttribute('aria-disabled', String(Boolean(isBusy)));
  button.textContent = isBusy ? 'Preparing secure checkout...' : label;
  return button;
}

function updateCheckoutButtonState() {
  const button = document.querySelector('[data-checkout-button]') || checkoutButton;
  if (!button) return;
  if (button.dataset.checkoutBusy === 'true') return;
  button.disabled = false;
  button.removeAttribute('disabled');
  button.setAttribute('aria-disabled', 'false');
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
  const startText = String(value || '').split(/\s*[-–—]\s*/)[0].trim();
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
  if (!startDate) return false;
  return startDate.getTime() <= Date.now();
}

function isLessThanMinimumAdvance(item) {
  const startDate = getAppointmentStartDate(item);
  if (!startDate) return false;
  return startDate.getTime() - Date.now() < MIN_ADVANCE_MINUTES * 60 * 1000;
}

function isNewTireInstallItem(item) {
  if (String(item?.newTireOrderId || item?.new_tire_order_id || '').trim()) return true;
  if (item?.awaitingNewTireOrder || item?.source === 'new-tires') return true;
  const linked = Array.isArray(item?.linkedTires) ? item.linkedTires : [];
  return linked.some((tire) => String(tire?.type || '') === 'new_tire' && String(tire.orderId || tire.order_id || '').trim());
}

function isOutsideServiceHours(item) {
  const startMinutes = getTimeWindowStartMinutes(item.preferredTimeWindow);
  if (startMinutes === null) return false;
  return startMinutes < SERVICE_START_MINUTES || startMinutes >= SERVICE_END_MINUTES;
}

function torontoYmd(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDaysYmd(ymd, days) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
}

function purchaseIsoFromCartItem(item) {
  const linked = Array.isArray(item?.linkedTires) ? item.linkedTires : [];
  const fromTires = linked.find((tire) => String(tire?.type || '') === 'new_tire' && (tire.paidAt || tire.paid_at));
  return item?.newTirePurchasedAt
    || item?.new_tire_purchased_at
    || fromTires?.paidAt
    || fromTires?.paid_at
    || '';
}

function earliestNewTireInstallYmd(item) {
  const raw = purchaseIsoFromCartItem(item);
  return addDaysYmd(raw ? torontoYmd(raw) : torontoYmd(), NEW_TIRE_SHIPPING_DAYS + 1);
}

function earliestNewTireInstallDate(item) {
  return new Date(`${earliestNewTireInstallYmd(item)}T00:00:00`);
}

function isWithinNewTireShippingHold(item) {
  if (!isNewTireInstallItem(item) || !item.preferredDate) return false;
  return String(item.preferredDate) < earliestNewTireInstallYmd(item);
}

function validateCartSlots(items) {
  const seenSlots = new Set();

  for (const item of items) {
    if (item.preferredDate && item.preferredTimeWindow && !getAppointmentStartDate(item)) {
      return 'Please choose a valid appointment date and time window.';
    }

    if (isPastAppointmentSlot(item) || isLessThanMinimumAdvance(item)) {
      return SLOT_UNAVAILABLE_MESSAGE;
    }
    if (isOutsideServiceHours(item)) {
      return 'Installation hours are 8:00 AM to 8:00 PM. Please choose a time in that window.';
    }
    if (isWithinNewTireShippingHold(item)) {
      return 'New tire installation cannot be booked on the purchase date or the following 4 days. Please choose a later date.';
    }

    const slotKey = `${item.preferredDate}__${item.preferredTimeWindow}`;
    if (seenSlots.has(slotKey)) {
      return SLOT_UNAVAILABLE_MESSAGE;
    }
    seenSlots.add(slotKey);
  }

  return '';
}

function formatAppointmentDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

function formatTimeStart(value) {
  return String(value || '').split(/\s*[-–—]\s*/)[0].trim();
}

function compactAppointmentMeta(item) {
  const vehicle = getVehicleDetails(item).vehicle;
  const date = formatAppointmentDate(item.preferredDate);
  const time = formatTimeStart(item.preferredTimeWindow);
  const place = String(item.installLocation || item.install_location || '').trim() === 'shop'
    || String(item.city || '').trim() === 'EastCord shop'
    ? 'EastCord shop'
    : String(item.city || '').trim();
  return [vehicle, date, time, place].filter(Boolean).join(' · ');
}

function cartLineRemoveButton(item) {
  return `<button class="cart-line-remove" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-index="${escapeHtml(item.cartIndex)}">Remove</button>`;
}

function renderInvalidCartItem(item) {
  return `
    <article class="cart-line cart-line-invalid">
      <div class="cart-line-main">
        <strong>${escapeHtml(item.serviceName || 'Appointment needs attention')}</strong>
        <p class="cart-line-error">${escapeHtml(item.invalidReason || 'This appointment could not be read. Remove it and add it again.')}</p>
      </div>
      <div class="cart-line-side">
        ${cartLineRemoveButton(item)}
      </div>
    </article>
  `;
}

function renderCartItem(item) {
  if (item.isInvalidCartItem) return renderInvalidCartItem(item);

  const meta = compactAppointmentMeta(item);
  return `
    <article class="cart-line">
      <div class="cart-line-main">
        <strong>${escapeHtml(item.serviceName || 'Appointment service')}</strong>
        ${meta ? `<p class="cart-line-meta">${escapeHtml(meta)}</p>` : ''}
      </div>
      <div class="cart-line-side">
        <span class="cart-line-price">${escapeHtml(formatMoney(item.serviceSubtotal))}</span>
        ${cartLineRemoveButton(item)}
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
  if (cartBalance) cartBalance.textContent = formatMoney(balanceTotal);

  const payButton = document.querySelector('[data-appointment-pay-button]');
  if (payButton && !payButton.disabled) {
    const label = depositTotal > 0 ? `Pay ${formatMoney(depositTotal)} deposit` : 'Pay deposit';
    payButton.dataset.idleLabel = label;
    payButton.textContent = label;
  }
}

function renderCartItemsAndTotals() {
  const cartItems = getCartItemsContainer();
  let items = [];
  let rawStoredCount = 0;

  try {
    items = getAppointmentItems();
  } catch (error) {
    logDeveloperError('Appointment cart items could not be loaded.', error);
  }

  try {
    rawStoredCount = getRawStorageItemCount();
  } catch (error) {
    logDeveloperError('Cart storage diagnostics could not be read.', error);
  }

  if (cartItems) {
    if (items.length) {
      cartItems.innerHTML = items.map(renderCartItem).join('');
    } else if (readAccountCart().length) {
      logCartDiagnostic('Shared appointment cart still has items; waiting for the shared renderer.', {
        sharedCartCount: readAccountCart().length,
      });
    } else {
      cartItems.innerHTML = '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';
    }
  }

  if (items.length) lastRenderedCheckoutItems = items;

  if (items.length || !(readAccountCart().length || cartItems?.querySelector('.cart-line'))) {
    renderCartTotals(items);
  }
  updateVisibleCartCount(items.length);

  const invalidCount = items.filter((item) => item.isInvalidCartItem).length;
  const displayedCount = cartItems?.querySelectorAll('.cart-line').length || 0;
  if (invalidCount) {
    showCartMessage('One or more appointments in your cart needs attention. Please remove the item and add it again before checkout.');
  } else if (!items.length && !displayedCount && rawStoredCount) {
    showCartMessage('Some saved cart details could not be loaded. Please clear your cart and add your appointment again.');
  } else if (cartMessage?.textContent?.includes('needs attention') || cartMessage?.textContent?.includes('could not be loaded')) {
    showCartMessage('', 'info');
  }

  updateCheckoutButtonState();
  return items;
}

function applyCartAuthState(profile, { allowSignedOut = false } = {}) {
  if (profile) lastKnownCartProfile = profile;
  else if (allowSignedOut) lastKnownCartProfile = null;

  const activeProfile = profile || lastKnownCartProfile;
  if (cartCustomer) {
    cartCustomer.textContent = activeProfile
      ? `${activeProfile.name || 'Customer'} - ${activeProfile.email}${activeProfile.phone ? ` - ${activeProfile.phone}` : ''}`
      : 'Please sign up or log in before checkout.';
  }
    if (authBlock) {
      authBlock.hidden = Boolean(activeProfile);
      authBlock.classList.toggle('is-visible', !activeProfile);
    }
}

async function hydrateCartProfile() {
  let profile = null;

  try {
    profile = await window.EastCordAccount.getCurrentProfile();
  } catch (error) {
    logDeveloperError('Cart profile lookup failed; cart items were still rendered.', error);
  }

  applyCartAuthState(profile);

  if (profile && !accountCartHydrated) {
    try {
      const localBefore = getCartFromKnownStorage();
      const mergedCart = normalizeCartCollection(
        await window.EastCordAccount.loadCustomerCart('appointment', localBefore),
      ).filter((item) => isAppointmentLikeItem(item));
      const latestLocal = getCartFromKnownStorage();
      if (!latestLocal.length && mergedCart.length) {
        window.EastCordAccount.saveCart(mergedCart);
      }
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
  try {
    renderCartItemsAndTotals();
  } catch (error) {
    logDeveloperError('Cart items could not be rendered.', error);
    const cartItems = getCartItemsContainer();
    if (cartItems && !cartItems.innerHTML.trim()) {
      cartItems.innerHTML = '<p class="empty-cart">Your appointment is saved, but it could not be displayed. Please refresh this page.</p>';
    }
  }
  hydrateCartProfile();
}

window.addEventListener('eastcord:auth-changed', (event) => {
  applyCartAuthState(event.detail?.profile || null, { allowSignedOut: !event.detail?.signedIn });
  if (event.detail?.signedIn && !checkoutInProgress) hydrateCartProfile();
});

window.addEventListener('eastcord:account-carts-hydrated', () => {
  renderCartItemsAndTotals();
  updateVisibleCartCount();
});

window.addEventListener('eastcord:appointment-cart-changed', () => {
  renderCartItemsAndTotals();
  updateVisibleCartCount();
});

function sameAppointmentCartItem(item, itemId) {
  const id = String(itemId || '').trim();
  if (!id) return false;
  return String(item?.id || '') === id
    || String(item?.bookingId || item?.booking_id || '') === id
    || String(item?.cartId || item?.cart_id || '') === id;
}

function removeCartItem(itemId, itemIndex) {
  const currentCart = window.EastCordAccount?.getCart?.() || getCartFromKnownStorage();
  const numericIndex = Number(itemIndex);
  const hasMatchingId = currentCart.some((item) => sameAppointmentCartItem(item, itemId));
  const nextCart = currentCart.filter((item, index) => {
    if (hasMatchingId) return !sameAppointmentCartItem(item, itemId);
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

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timed out')), ms);
    promise.then((value) => {
      window.clearTimeout(timer);
      resolve(value);
    }, (error) => {
      window.clearTimeout(timer);
      reject(error);
    });
  });
}

function profileFromAccessToken(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const customerId = payload.sub || '';
    const email = payload.email || payload.user_metadata?.email || '';
    if (!customerId && !email) return null;
    return {
      customerId,
      email,
      name: payload.user_metadata?.full_name || payload.user_metadata?.name || '',
      phone: payload.user_metadata?.phone || '',
    };
  } catch (error) {
    logDeveloperError('Checkout token could not be read.', error);
    return null;
  }
}

async function startCheckout(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();

  const existingButton = document.querySelector('[data-checkout-button]') || checkoutButton;
  if (existingButton?.dataset.checkoutBusy === 'true') return;

  const button = setCheckoutBusy(true);
  if (!button) {
    showCartMessage('Checkout could not be started. Please refresh and try again.');
    return;
  }

  checkoutInProgress = true;
  let redirectedToStripe = false;
  const watchdog = window.setTimeout(() => {
    if (redirectedToStripe) return;
    checkoutInProgress = false;
    setCheckoutBusy(false);
    showCartMessage('Checkout is taking too long. Please try Secure Checkout again.');
  }, 20000);
  showCartMessage('Opening Stripe checkout...', 'info');

  try {
    const items = getCheckoutItems();
    const validItems = items.filter((item) => item && !item.isInvalidCartItem);

    if (!validItems.length) {
      throw new Error(items.length
        ? 'Please remove the invalid appointment item and add it again before checkout.'
        : 'Add an appointment service before checkout.');
    }

    if (!isAgreementAccepted()) {
      agreementCheckbox?.focus();
      throw new Error('Please review and accept the Mobile Service Agreement before checkout.');
    }

    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      throw new Error(window.EastCordAccount?.setupMessage || 'Account system is being connected. Please check back soon.');
    }

    let token = '';
    try {
      token = await withTimeout(window.EastCordAccount.getAccessToken(), 4000);
    } catch (error) {
      logDeveloperError('Checkout access token lookup timed out.', error);
    }

    let profile = lastKnownCartProfile || profileFromAccessToken(token);
    if (!profile) {
      try {
        profile = await withTimeout(window.EastCordAccount.getCurrentProfile(), 4000);
      } catch (error) {
        logDeveloperError('Checkout profile lookup timed out.', error);
      }
    }

    if (!profile) {
      if (authBlock) {
        authBlock.hidden = false;
        authBlock.classList.add('is-visible');
      }
      throw new Error('Please sign up or log in before checkout.');
    }

    applyCartAuthState(profile);

    const customer = {
      ...profile,
      customerId: profile.customerId || profile.id || '',
      name: profile.name || validItems[0].customerName || '',
      email: profile.email || validItems[0].customerEmail || '',
      phone: profile.phone || validItems[0].customerPhone || '',
    };

    const bookingItems = validItems.map((item) => ({
      ...item,
      bookingId: item.bookingId || item.id || `pending-${Date.now()}`,
    }));

    const response = await fetch('/.netlify/functions/create-appointment-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ items: bookingItems, customer }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.url) {
      logDeveloperError('Checkout function returned an error.', {
        status: response.status,
        response: data,
      });
      throw new Error(data.message || 'Online checkout is being connected. Please check back soon.');
    }

    redirectedToStripe = true;
    window.clearTimeout(watchdog);
    window.location.href = data.url;
  } catch (error) {
    logDeveloperError('Checkout could not be started.', error);
    showCartMessage(error.message || 'Online checkout is being connected. Please check back soon.');
  } finally {
    window.clearTimeout(watchdog);
    checkoutInProgress = false;
    if (!redirectedToStripe) setCheckoutBusy(false);
  }
}

window.getAppointmentItems = getAppointmentItems;
window.renderCart = renderCart;
agreementOpenButton?.addEventListener('click', openAgreementModal);
agreementCloseButtons.forEach((button) => button.addEventListener('click', closeAgreementModal));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && agreementModal && !agreementModal.hidden) closeAgreementModal();
});
clearCartButton?.addEventListener('click', () => {
  hardClearCartStorage();
  resetAgreement();
  showCartMessage('Cart cleared.', 'success');
  renderCart();
});

renderCart();
document.addEventListener('DOMContentLoaded', () => {
  renderCartItemsAndTotals();
});
