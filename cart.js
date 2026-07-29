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
const SLOT_UNAVAILABLE_MESSAGE = 'One or more appointment times are no longer available. Please choose another time.';

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

function getServiceSubtotal(item) {
  const directSubtotal = numberOrZero(item.serviceSubtotal);
  if (directSubtotal > 0) return directSubtotal;

  const startingPrice = numberOrZero(item.startingPrice);
  if (startingPrice > 0) return startingPrice;

  const servicePrice = SERVICE_SUBTOTALS[item.serviceId];
  if (servicePrice > 0) return servicePrice;

  return 0;
}

function isAppointmentLikeItem(item) {
  if (!item || typeof item !== 'object') return false;
  return item.type === 'appointment'
    || Boolean(item.serviceId)
    || Boolean(item.serviceName)
    || Boolean(item.bookingId)
    || Boolean(item.preferredDate)
    || Boolean(item.vehicleYear || item.vehicleMake || item.vehicleModel);
}

function withTaxBreakdown(item, cartIndex = 0) {
  const serviceSubtotal = getServiceSubtotal(item);
  const id = item.id || `cart-item-${cartIndex}`;

  if (!serviceSubtotal) {
    return {
      ...item,
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
    ...item,
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
  const rawCart = window.EastCordAccount?.getCart?.() || [];
  const appointmentItems = rawCart
    .map((item, cartIndex) => ({ item, cartIndex }))
    .filter(({ item }) => isAppointmentLikeItem(item))
    .map(({ item, cartIndex }) => withTaxBreakdown(item, cartIndex));

  if (rawCart.length && !appointmentItems.length) {
    logDeveloperError('Cart storage contains items, but none matched appointment item shape.', {
      cartLength: rawCart.length,
      itemKeys: rawCart.map((item) => Object.keys(item || {})),
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
      ${detailLine('Service Subtotal', window.EastCordAccount.money(item.serviceSubtotal))}
      ${detailLine('HST 13%', window.EastCordAccount.money(item.hstAmount))}
      ${detailLine('Total Including HST', window.EastCordAccount.money(item.totalWithHst))}
      ${detailLine('Deposit Due Today', window.EastCordAccount.money(item.depositAmount))}
      ${detailLine('Remaining On-Site', window.EastCordAccount.money(item.remainingBalance))}
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

  if (cartSubtotal) cartSubtotal.textContent = window.EastCordAccount.money(subtotalTotal);
  if (cartHst) cartHst.textContent = window.EastCordAccount.money(hstTotal);
  if (cartTotal) cartTotal.textContent = window.EastCordAccount.money(totalWithHst);
  if (cartDeposit) cartDeposit.textContent = window.EastCordAccount.money(depositTotal);
  if (cartBalance) cartBalance.textContent = `${window.EastCordAccount.money(balanceTotal)} due on-site after service`;
}

function renderCartItemsAndTotals() {
  const items = getAppointmentItems();

  if (cartItems) {
    cartItems.innerHTML = items.length
      ? items.map(renderCartItem).join('')
      : '<p class="empty-cart">Your cart is empty. Add an appointment service to continue.</p>';
  }

  renderCartTotals(items);

  const invalidCount = items.filter((item) => item.isInvalidCartItem).length;
  if (invalidCount) {
    showCartMessage('One or more appointments in your cart needs attention. Please remove the item and add it again before checkout.');
  } else if (cartMessage?.textContent?.includes('needs attention')) {
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

function removeCartItem(itemId, itemIndex) {
  const currentCart = window.EastCordAccount.getCart();
  const numericIndex = Number(itemIndex);
  const nextCart = currentCart.filter((item, index) => {
    if (itemId) return item.id !== itemId;
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
  const cart = window.EastCordAccount.getCart().map((cartItem, index) => (index === item.cartIndex || cartItem.id === item.id ? updatedItem : cartItem));
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
  window.EastCordAccount.clearCart();
  resetAgreement();
  showCartMessage('Cart cleared.', 'success');
  renderCart();
});

updateCheckoutButtonState();
renderCart();
