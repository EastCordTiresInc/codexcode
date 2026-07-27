const cartItems = document.querySelector('[data-cart-items]');
const cartCustomer = document.querySelector('[data-cart-customer]');
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
const SLOT_UNAVAILABLE_MESSAGE = 'One or more appointment times are no longer available. Please choose another time.';

function logDeveloperError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, error);
}

function showCartMessage(message, type = 'error') {
  if (!cartMessage) return;
  cartMessage.textContent = message;
  cartMessage.dataset.messageType = type;
}

function isAgreementAccepted() {
  return Boolean(agreementCheckbox?.checked);
}

function resetAgreement() {
  if (agreementCheckbox) agreementCheckbox.checked = false;
  updateCheckoutButtonState();
}

function updateCheckoutButtonState() {
  if (!checkoutButton) return;
  checkoutButton.disabled = !isAgreementAccepted();
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

function getAppointmentItems() {
  return window.EastCordAccount.getCart().filter((item) => item.type === 'appointment');
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

function renderCartItem(item, index) {
  const vehicle = [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ') || 'Vehicle details submitted';
  return `
    <article class="cart-line">
      <span>Vehicle ${index + 1} appointment</span>
      <strong>${item.serviceName}</strong>
      <p>Vehicle: ${vehicle}</p>
      <p>Plate Number: ${item.vehiclePlateNumber || 'Not provided'}</p>
      <p>Vehicle Colour: ${item.vehicleColour || 'Not provided'}</p>
      <p>Tire Size: ${item.tireSize}</p>
      <p>${item.city}, ${item.postalCode} - ${item.preferredDate} at ${item.preferredTimeWindow}</p>
      <p>Starting price: ${window.EastCordAccount.money(item.startingPrice)} | Deposit due today: ${window.EastCordAccount.money(item.depositAmount)} | Remaining on-site: ${window.EastCordAccount.money(item.remainingBalance)}</p>
      <p>Your appointment will be confirmed automatically after successful deposit payment.</p>
      <div class="account-actions cart-line-actions">
        <button class="button button-secondary" type="button" data-remove-cart-item="${item.id}">Remove this appointment</button>
      </div>
    </article>
  `;
}

async function renderCart() {
  const items = getAppointmentItems();
  const profile = await window.EastCordAccount.getCurrentProfile();
  const depositTotal = items.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0);
  const balanceTotal = items.reduce((sum, item) => sum + Number(item.remainingBalance || 0), 0);

  if (cartItems) {
    cartItems.innerHTML = items.length
      ? items.map(renderCartItem).join('')
      : '<p class="empty-cart">Your cart is empty. Add an appointment service to continue.</p>';
  }

  if (cartCustomer) {
    cartCustomer.textContent = profile
      ? `${profile.name || 'Customer'} - ${profile.email}${profile.phone ? ` - ${profile.phone}` : ''}`
      : 'Please sign up or log in before checkout.';
  }
  if (cartDeposit) cartDeposit.textContent = window.EastCordAccount.money(depositTotal);
  if (cartBalance) cartBalance.textContent = `${window.EastCordAccount.money(balanceTotal)} due on-site after service`;
  if (authBlock) authBlock.classList.toggle('is-visible', !profile);

  if (!window.EastCordAccount.isAuthConfigured()) {
    showCartMessage(window.EastCordAccount.setupMessage || 'Account system is being connected. Please check back soon.', 'info');
  }

  updateCheckoutButtonState();
}

function removeCartItem(itemId) {
  const currentCart = window.EastCordAccount.getCart();
  const nextCart = currentCart.filter((item) => item.id !== itemId);

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
  formData.set('Starting Price', Number(item.startingPrice || 0).toFixed(2));
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
  const bookingId = await window.EastCordAccount.saveAppointmentBooking(item, profile);
  const updatedItem = { ...item, bookingId, paymentStatus: 'pending_checkout' };
  const cart = window.EastCordAccount.getCart().map((cartItem) => (cartItem.id === item.id ? updatedItem : cartItem));
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

  if (!isAgreementAccepted()) {
    showCartMessage('Please review and accept the Mobile Service Agreement before checkout.');
    return;
  }

  if (!window.EastCordAccount.isAuthConfigured()) {
    showCartMessage(window.EastCordAccount.setupMessage || 'Account system is being connected. Please check back soon.');
    logDeveloperError('Checkout attempted before Supabase env vars were configured.', window.EASTCORD_AUTH_CONFIG || {});
    return;
  }

  const profile = await window.EastCordAccount.getCurrentProfile();

  if (!items.length) {
    showCartMessage('Add an appointment service before checkout.');
    return;
  }

  if (!profile) {
    if (authBlock) authBlock.classList.add('is-visible');
    showCartMessage('Please sign up or log in before checkout.');
    return;
  }

  const cartSlotMessage = validateCartSlots(items);
  if (cartSlotMessage) {
    showCartMessage(cartSlotMessage);
    return;
  }

  try {
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Preparing Stripe Checkout...';
    showCartMessage('Saving booking details and preparing Stripe Checkout...', 'info');

    const bookingItems = await ensureAllSupabaseBookings(items, profile);

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
    checkoutButton.textContent = 'Checkout with Stripe';
    updateCheckoutButtonState();
  }
}

cartItems?.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-cart-item]');
  if (!removeButton) return;
  removeCartItem(removeButton.dataset.removeCartItem);
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
