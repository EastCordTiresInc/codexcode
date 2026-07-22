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
const reviewPrice = document.querySelector('[data-review-price]');
const loginRequiredBlock = document.querySelector('[data-login-required-block]');
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
  if (shouldFocus) appointmentForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  if (reviewService) reviewService.textContent = serviceName;
  if (reviewVehicle) {
    reviewVehicle.textContent = vehicleParts.length || tireSize || tireCount
      ? `${vehicleParts.join(' ') || 'Vehicle details'}${tireSize ? `, ${tireSize}` : ''}${tireCount ? `, ${tireCount} tire(s)` : ''}`
      : 'Not entered yet';
  }
  if (reviewLocation) reviewLocation.textContent = address || city || postalCode ? [address, city, postalCode].filter(Boolean).join(', ') : 'Not entered yet';
  if (reviewDate) reviewDate.textContent = date || time ? [date, time].filter(Boolean).join(' at ') : 'Not entered yet';
  if (reviewPrice) reviewPrice.textContent = `${money.format(Number(depositField?.value || 0))} due today, ${money.format(Number(balanceField?.value || 0))} on-site`;
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

function buildAppointmentItem(profile) {
  const selectedOption = serviceSelect?.selectedOptions[0];
  return {
    id: `appointment-${Date.now()}`,
    type: 'appointment',
    customerId: profile.customerId,
    customerName: profile.name,
    customerEmail: profile.email,
    customerPhone: profile.phone,
    serviceId: selectedOption?.value || '',
    serviceName: selectedOption?.textContent?.trim() || '',
    startingPrice: Number(startingPriceField?.value || 0),
    depositAmount: Number(depositField?.value || 0),
    remainingBalance: Number(balanceField?.value || 0),
    preferredDate: getFieldValue('Preferred Date'),
    preferredTimeWindow: getFieldValue('Preferred Time Window'),
    vehicleYear: getFieldValue('Vehicle Year'),
    vehicleMake: getFieldValue('Vehicle Make'),
    vehicleModel: getFieldValue('Vehicle Model'),
    tireSize: getFieldValue('Tire Size'),
    tiresAlreadyOnRims: getFieldValue('Tires Already On Rims'),
    numberOfTires: getFieldValue('Number of Tires'),
    fullServiceAddress: getFieldValue('Full Service Address'),
    city: getFieldValue('City'),
    postalCode: getFieldValue('Postal Code'),
    parkingAccessNotes: getFieldValue('Parking Driveway Access Notes'),
    additionalNotes: getFieldValue('Additional Notes'),
    serviceAreaStatus: serviceAreaStatusField?.value || 'In service area',
    bookingStatus: 'Pending Confirmation',
    paymentStatus: 'pending_checkout',
    stripeSessionId: '',
  };
}

async function handleAppointmentSubmit(event) {
  event.preventDefault();
  if (!validateAllSteps()) {
    showAppointmentMessage('Please complete all required appointment fields before adding to cart.');
    return;
  }

  if (!validateServiceArea()) {
    showAppointmentMessage('EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.');
    return;
  }

  const profile = await window.EastCordAccount?.getCurrentProfile?.();
  if (!profile) {
    if (loginRequiredBlock) loginRequiredBlock.classList.add('is-visible');
    showAppointmentMessage('Please sign up or log in before adding this appointment to cart.');
    return;
  }

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Saving Booking...';
    }
    showAppointmentMessage('Saving your booking details...', 'info');

    const appointmentItem = buildAppointmentItem(profile);
    appointmentItem.bookingId = await window.EastCordAccount.saveAppointmentBooking(appointmentItem, profile);

    const cart = window.EastCordAccount.getCart().filter((item) => item.type !== 'appointment');
    cart.push(appointmentItem);
    window.EastCordAccount.saveCart(cart);
    window.location.href = '/cart';
  } catch (error) {
    showAppointmentMessage(error.message || 'Booking could not be saved. Please try again.');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Add Appointment to Cart';
    }
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

primaryNavigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
nextButtons.forEach((button) => button.addEventListener('click', () => validateStep(currentStep) && showStep(currentStep + 1)));
backButtons.forEach((button) => button.addEventListener('click', () => showStep(currentStep - 1)));
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
