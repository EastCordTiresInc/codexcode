const cartItems = document.querySelector('[data-cart-items]');
const cartCustomer = document.querySelector('[data-cart-customer]');
const cartDeposit = document.querySelector('[data-cart-deposit]');
const cartBalance = document.querySelector('[data-cart-balance]');
const cartMessage = document.querySelector('[data-cart-message]');
const checkoutButton = document.querySelector('[data-checkout-button]');
const clearCartButton = document.querySelector('[data-clear-cart]');
const authBlock = document.querySelector('[data-checkout-auth-block]');

function showCartMessage(message, type = 'error') {
  if (!cartMessage) return;
  cartMessage.textContent = message;
  cartMessage.dataset.messageType = type;
}

function getAppointmentItems() {
  return window.EastCordAccount.getCart().filter((item) => item.type === 'appointment');
}

function renderCartItem(item) {
  return `
    <article class="cart-line">
      <span>Appointment service</span>
      <strong>${item.serviceName}</strong>
      <p>${item.vehicleYear} ${item.vehicleMake} ${item.vehicleModel} - ${item.tireSize}</p>
      <p>${item.city}, ${item.postalCode} - ${item.preferredDate} at ${item.preferredTimeWindow}</p>
      <p>Starting price: ${window.EastCordAccount.money(item.startingPrice)} | Deposit due today: ${window.EastCordAccount.money(item.depositAmount)} | Remaining on-site: ${window.EastCordAccount.money(item.remainingBalance)}</p>
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
  formData.set('stripe_session_id', '');
  formData.set('payment_status', 'pending_checkout');
  formData.set('Preferred Date', item.preferredDate || '');
  formData.set('Preferred Time Window', item.preferredTimeWindow || '');
  formData.set('Vehicle Year', item.vehicleYear || '');
  formData.set('Vehicle Make', item.vehicleMake || '');
  formData.set('Vehicle Model', item.vehicleModel || '');
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

async function submitNetlifyForm(formData) {
  const response = await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(formData).toString(),
  });

  if (!response.ok) {
    throw new Error('Booking details could not be saved. Please try again.');
  }
}

async function startCheckout() {
  const items = getAppointmentItems();
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

  try {
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Preparing Stripe Checkout...';
    showCartMessage('Saving booking details and preparing Stripe Checkout...', 'info');

    await submitNetlifyForm(buildNetlifyFormData(items[0], profile));

    const response = await fetch('/.netlify/functions/create-appointment-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...items[0], customer: profile }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.url) {
      throw new Error(data.message || 'Stripe Checkout is not available yet.');
    }

    window.location.href = data.url;
  } catch (error) {
    showCartMessage(error.message || 'Checkout could not be started.');
    checkoutButton.disabled = false;
    checkoutButton.textContent = 'Checkout with Stripe';
  }
}

checkoutButton?.addEventListener('click', startCheckout);
clearCartButton?.addEventListener('click', () => {
  window.EastCordAccount.clearCart();
  renderCart();
});

renderCart();
