const appointmentForm = document.querySelector('#changeover-appointment-form');
const serviceSelect = document.querySelector('[data-service-select]');
const citySelect = document.querySelector('[data-city-select]');
const serviceAreaStatusField = document.querySelector('[data-service-area-status-field]');
const serviceAreaWarning = document.querySelector('[data-service-area-warning]');
const startingPrice = document.querySelector('[data-starting-price]');
const depositPrice = document.querySelector('[data-deposit-price]');
const balancePrice = document.querySelector('[data-balance-price]');
const startingPriceField = document.querySelector('[data-starting-price-field]');
const depositField = document.querySelector('[data-deposit-field]');
const balanceField = document.querySelector('[data-balance-field]');
const preferredDate = document.querySelector('[data-preferred-date]');
const appointmentMessage = document.querySelector('[data-appointment-message]');
const submitButton = document.querySelector('.appointment-submit');
const stepPanels = Array.from(document.querySelectorAll('[data-booking-step]'));
const progressSteps = Array.from(document.querySelectorAll('[data-progress-step]'));
const nextButtons = Array.from(document.querySelectorAll('[data-next-step]'));
const backButtons = Array.from(document.querySelectorAll('[data-back-step]'));
const reviewService = document.querySelector('[data-review-service]');
const reviewVehicle = document.querySelector('[data-review-vehicle]');
const reviewLocation = document.querySelector('[data-review-location]');
const reviewDate = document.querySelector('[data-review-date]');
const reviewCustomer = document.querySelector('[data-review-customer]');
const reviewPrice = document.querySelector('[data-review-price]');
const menuToggle = document.querySelector('.menu-toggle');
const primaryNavigation = document.querySelector('#primary-navigation');

const serviceAreaCities = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);
let currentStep = 0;

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

  updateReviewSummary();
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setMinimumDate() {
  if (!preferredDate) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  preferredDate.min = formatDateInputValue(today);
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

  preferredDate.setCustomValidity('');
  return true;
}

function validateServiceArea() {
  if (!citySelect) return true;

  const city = citySelect.value;
  const isOther = city === 'Other';
  const inServiceArea = serviceAreaCities.has(city);
  const status = inServiceArea ? 'In service area' : isOther ? 'Outside service area' : '';

  if (serviceAreaStatusField) serviceAreaStatusField.value = status;
  if (serviceAreaWarning) serviceAreaWarning.hidden = !isOther;

  if (isOther) {
    citySelect.setCustomValidity('EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.');
    return false;
  }

  citySelect.setCustomValidity('');
  return true;
}

function showAppointmentMessage(message, type = 'error') {
  if (!appointmentMessage) return;

  appointmentMessage.textContent = message;
  appointmentMessage.dataset.messageType = type;
}

function getFieldValue(name) {
  const field = appointmentForm?.elements.namedItem(name);
  return field?.value?.trim() || '';
}

function getStepControls(stepIndex) {
  const step = stepPanels[stepIndex];
  if (!step) return [];

  return Array.from(step.querySelectorAll('input, select, textarea')).filter((control) => {
    return control.type !== 'hidden' && control.name !== 'bot-field' && !control.disabled;
  });
}

function validateStep(stepIndex) {
  updateDepositSummary();
  validatePreferredDate();
  validateServiceArea();

  const controls = getStepControls(stepIndex);
  const firstInvalid = controls.find((control) => !control.checkValidity());

  if (firstInvalid) {
    firstInvalid.reportValidity();
    return false;
  }

  if (stepIndex === 2 && !validateServiceArea()) {
    citySelect?.reportValidity();
    return false;
  }

  return true;
}

function updateProgress() {
  progressSteps.forEach((step, index) => {
    step.classList.toggle('is-active', index === currentStep);
    step.classList.toggle('is-complete', index < currentStep);
  });
}

function showStep(index, shouldFocus = true) {
  if (!stepPanels.length) return;

  currentStep = Math.max(0, Math.min(index, stepPanels.length - 1));

  stepPanels.forEach((step, stepIndex) => {
    const isActive = stepIndex === currentStep;
    step.hidden = !isActive;
    step.classList.toggle('is-active', isActive);
  });

  updateProgress();
  updateReviewSummary();
  showAppointmentMessage('', 'info');

  if (shouldFocus) {
    const activeHeading = stepPanels[currentStep]?.querySelector('h3');
    activeHeading?.setAttribute('tabindex', '-1');
    activeHeading?.focus({ preventScroll: true });
    appointmentForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateReviewSummary() {
  if (!appointmentForm) return;

  const selectedOption = serviceSelect?.selectedOptions[0];
  const serviceName = selectedOption?.textContent?.replace(/\s+/g, ' ').trim() || 'Not selected yet';
  const vehicleParts = [getFieldValue('Vehicle Year'), getFieldValue('Vehicle Make'), getFieldValue('Vehicle Model')].filter(Boolean);
  const tireSize = getFieldValue('Tire Size');
  const tireCount = getFieldValue('Number of Tires');
  const address = getFieldValue('Full Service Address');
  const city = getFieldValue('City');
  const postalCode = getFieldValue('Postal Code');
  const date = getFieldValue('Preferred Date');
  const time = getFieldValue('Preferred Time Window');
  const name = getFieldValue('Full Name');
  const email = getFieldValue('Email');
  const phone = getFieldValue('Phone');

  if (reviewService) reviewService.textContent = serviceName;
  if (reviewVehicle) {
    reviewVehicle.textContent = vehicleParts.length || tireSize || tireCount
      ? `${vehicleParts.join(' ') || 'Vehicle details'}${tireSize ? `, ${tireSize}` : ''}${tireCount ? `, ${tireCount} tire(s)` : ''}`
      : 'Not entered yet';
  }
  if (reviewLocation) {
    reviewLocation.textContent = address || city || postalCode ? [address, city, postalCode].filter(Boolean).join(', ') : 'Not entered yet';
  }
  if (reviewDate) reviewDate.textContent = date || time ? [date, time].filter(Boolean).join(' at ') : 'Not entered yet';
  if (reviewCustomer) reviewCustomer.textContent = name || email || phone ? [name, email, phone].filter(Boolean).join(', ') : 'Not entered yet';
  if (reviewPrice) {
    reviewPrice.textContent = `${money.format(Number(depositField?.value || 0))} due today, ${money.format(Number(balanceField?.value || 0))} on-site`;
  }
}

function validateAllSteps() {
  for (let index = 0; index < stepPanels.length; index += 1) {
    if (!validateStep(index)) {
      showStep(index);
      return false;
    }
  }

  return true;
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
    vehicleYear: formData.get('Vehicle Year') || '',
    vehicleMake: formData.get('Vehicle Make') || '',
    vehicleModel: formData.get('Vehicle Model') || '',
    tireSize: formData.get('Tire Size') || '',
    tiresAlreadyOnRims: formData.get('Tires Already On Rims') || '',
    numberOfTires: formData.get('Number of Tires') || '',
    fullServiceAddress: formData.get('Full Service Address') || '',
    city: formData.get('City') || '',
    serviceAreaStatus: formData.get('Service area status') || '',
    postalCode: formData.get('Postal Code') || '',
    parkingAccessNotes: formData.get('Parking Driveway Access Notes') || '',
    additionalNotes: formData.get('Additional Notes') || '',
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
  const response = await fetch('/.netlify/functions/create-appointment-checkout-session', {
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

  if (!validateAllSteps()) {
    showAppointmentMessage('Please complete all required fields before continuing to Stripe Checkout.');
    return;
  }

  const formData = new FormData(appointmentForm);
  formData.set('payment_status', 'pending_checkout');
  formData.set('stripe_session_id', '');
  formData.set('Booking Status', 'Pending Confirmation');
  formData.set('Service area status', serviceAreaStatusField?.value || 'In service area');
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

nextButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    showStep(currentStep + 1);
  });
});

backButtons.forEach((button) => {
  button.addEventListener('click', () => {
    showStep(currentStep - 1);
  });
});

appointmentForm?.addEventListener('input', updateReviewSummary);
appointmentForm?.addEventListener('change', updateReviewSummary);
serviceSelect?.addEventListener('change', updateDepositSummary);
citySelect?.addEventListener('change', validateServiceArea);
preferredDate?.addEventListener('input', validatePreferredDate);
appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

setMinimumDate();
updateDepositSummary();
validatePreferredDate();
validateServiceArea();
showStep(0, false);