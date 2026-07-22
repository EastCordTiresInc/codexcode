const appointmentForm = document.querySelector('#changeover-appointment-form');
const serviceSelect = document.querySelector('[data-service-select]');
const startingPrice = document.querySelector('[data-starting-price]');
const depositPrice = document.querySelector('[data-deposit-price]');
const balancePrice = document.querySelector('[data-balance-price]');
const startingPriceField = document.querySelector('[data-starting-price-field]');
const depositField = document.querySelector('[data-deposit-field]');
const balanceField = document.querySelector('[data-balance-field]');
const preferredDate = document.querySelector('[data-preferred-date]');
const appointmentMessage = document.querySelector('[data-appointment-message]');
const submitButton = document.querySelector('.appointment-submit');
const menuToggle = document.querySelector('.menu-toggle');
const primaryNavigation = document.querySelector('#primary-navigation');

const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

function updateDepositSummary() {
  if (!serviceSelect) return;

  const selectedOption = serviceSelect.selectedOptions[0];
  const price = Number(selectedOption?.dataset.price || 0);
  const deposit = price * 0.2;
  const balance = price - deposit;

  if (startingPrice) startingPrice.textContent = money.format(price);
  if (depositPrice) depositPrice.textContent = money.format(deposit);
  if (balancePrice) balancePrice.textContent = money.format(balance);

  if (startingPriceField) startingPriceField.value = price.toFixed(2);
  if (depositField) depositField.value = deposit.toFixed(2);
  if (balanceField) balanceField.value = balance.toFixed(2);
}

function setMinimumDate() {
  if (!preferredDate) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  preferredDate.min = today.toISOString().split('T')[0];
}

function validatePreferredDate() {
  if (!preferredDate || !preferredDate.value) return true;

  const selectedDate = new Date(`${preferredDate.value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (selectedDate < today) {
    preferredDate.setCustomValidity('Please choose today or a future date.');
    return false;
  }

  if (selectedDate.getDay() === 0) {
    preferredDate.setCustomValidity('Sundays are not available for online appointment requests. Please choose another day.');
    return false;
  }

  preferredDate.setCustomValidity('');
  return true;
}

function showAppointmentMessage(message, type = 'error') {
  if (!appointmentMessage) return;

  appointmentMessage.textContent = message;
  appointmentMessage.dataset.messageType = type;
}

function getBookingPayload(formData) {
  const selectedOption = serviceSelect?.selectedOptions[0];

  return {
    serviceId: selectedOption?.value || '',
    serviceName: selectedOption?.textContent?.trim() || '',
    startingPrice: Number(startingPriceField?.value || 0),
    depositAmount: Number(depositField?.value || 0),
    remainingBalance: Number(balanceField?.value || 0),
    fullName: formData.get('Full Name') || '',
    email: formData.get('Email') || '',
    phone: formData.get('Phone') || '',
    preferredDate: formData.get('Preferred Date') || '',
    preferredTimeWindow: formData.get('Preferred Time Window') || '',
    vehicleDetails: formData.get('Vehicle Details') || '',
    tireSize: formData.get('Tire Size') || '',
    serviceLocation: formData.get('Service Location') || '',
    city: formData.get('City') || '',
    postalCode: formData.get('Postal Code') || '',
    notes: formData.get('Notes') || '',
    bookingStatus: 'Pending Confirmation',
  };
}

async function submitNetlifyForm(formData) {
  const response = await fetch('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(formData).toString(),
  });

  if (!response.ok) {
    throw new Error('We could not save the booking details. Please try again or contact EastCord Tires.');
  }
}

async function createCheckoutSession(booking) {
  const response = await fetch('/.netlify/functions/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.url) {
    throw new Error(data.message || 'Stripe Checkout is not available yet. Please contact EastCord Tires for help.');
  }

  return data.url;
}

function setSubmitState(isSubmitting) {
  if (!submitButton) return;

  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? 'Preparing Stripe Checkout...' : 'Submit Booking & Pay 20% Deposit';
}

async function handleAppointmentSubmit(event) {
  event.preventDefault();
  updateDepositSummary();
  validatePreferredDate();

  if (!appointmentForm?.checkValidity()) {
    appointmentForm?.reportValidity();
    showAppointmentMessage('Please complete all required fields before continuing to Stripe Checkout.');
    return;
  }

  const formData = new FormData(appointmentForm);
  formData.set('payment_status', 'pending_checkout');
  formData.set('stripe_session_id', '');
  formData.set('Booking Status', 'Pending Confirmation');
  formData.set('Starting Price', startingPriceField?.value || '0');
  formData.set('Booking Deposit', depositField?.value || '0');
  formData.set('Remaining Balance', balanceField?.value || '0');

  const booking = getBookingPayload(formData);

  try {
    setSubmitState(true);
    showAppointmentMessage('Saving your booking details and preparing secure Stripe Checkout...', 'info');
    await submitNetlifyForm(formData);
    const checkoutUrl = await createCheckoutSession(booking);
    window.location.href = checkoutUrl;
  } catch (error) {
    showAppointmentMessage(error.message || 'Something went wrong. Please try again or contact EastCord Tires.');
    setSubmitState(false);
  }
}

function closeMobileMenu() {
  if (!menuToggle || !primaryNavigation) return;

  menuToggle.setAttribute('aria-expanded', 'false');
  primaryNavigation.classList.remove('is-open');
}

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  primaryNavigation?.classList.toggle('is-open', !isOpen);
});

primaryNavigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', closeMobileMenu);
});

serviceSelect?.addEventListener('change', updateDepositSummary);
preferredDate?.addEventListener('input', validatePreferredDate);
appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

setMinimumDate();
updateDepositSummary();
validatePreferredDate();
