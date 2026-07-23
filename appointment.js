const appointmentForm = document.querySelector('[data-appointment-form]');
const citySelect = document.querySelector('[data-city-select]');
const serviceAreaStatusField = document.querySelector('[data-service-area-status]');
const serviceAreaWarning = document.querySelector('[data-service-area-warning]');
const startingPrice = document.querySelector('[data-starting-price]');
const depositPrice = document.querySelector('[data-deposit-price]');
const balancePrice = document.querySelector('[data-balance-price]');
const serviceIdField = document.querySelector('[data-hidden-service-id]');
const serviceNameField = document.querySelector('[data-hidden-service-name]');
const startingPriceField = document.querySelector('[data-hidden-starting-price]');
const depositField = document.querySelector('[data-hidden-deposit-price]');
const balanceField = document.querySelector('[data-hidden-balance-price]');
const preferredDate = document.querySelector('[data-preferred-date]');
const appointmentMessage = document.querySelector('[data-appointment-message]');
const submitButton = document.querySelector('.appointment-submit');
const stepPanels = Array.from(document.querySelectorAll('[data-booking-step]'));
const progressSteps = Array.from(document.querySelectorAll('[data-appointment-progress] li'));
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
let currentService = null;
let appointmentPageInitialized = false;

const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

function logDeveloperError(context, error) {
  console.error(`[EastCord appointment automation] ${context}`, error);
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setValue(element, value) {
  if (element) element.value = value;
}

function getCheckedServiceRadio() {
  return document.querySelector('input[name="serviceId"]:checked');
}

function getCurrentService() {
  const selected = getCheckedServiceRadio();

  if (!selected) {
    console.error('[EastCord appointment automation] No checked serviceId radio found.');
    return null;
  }

  const price = Number(selected.dataset.price || 0);
  const deposit = Math.round(price * 0.20 * 100) / 100;
  const remaining = Math.round((price - deposit) * 100) / 100;

  return {
    id: selected.value,
    name: selected.dataset.serviceName || selected.value,
    price,
    deposit,
    remaining,
  };
}

function updateServiceDebug(service) {
  if (!service) return;
  setText('[data-debug-service-id]', service.id || '');
  setText('[data-debug-service-name]', service.name || '');
  setText('[data-debug-service-price]', money.format(service.price));
  setText('[data-debug-deposit]', money.format(service.deposit));
  setText('[data-debug-remaining]', money.format(service.remaining));
  setText('[data-debug-last-selected]', new Date().toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }));
}

function updateServicePricing(service = getCurrentService()) {
  if (!service) return;
  currentService = service;

  if (startingPrice) startingPrice.textContent = money.format(service.price);
  if (depositPrice) depositPrice.textContent = money.format(service.deposit);
  if (balancePrice) balancePrice.textContent = money.format(service.remaining);

  setValue(serviceIdField, service.id);
  setValue(serviceNameField, service.name);
  setValue(startingPriceField, service.price.toFixed(2));
  setValue(depositField, service.deposit.toFixed(2));
  setValue(balanceField, service.remaining.toFixed(2));

  updateServiceDebug(service);
  updateReviewSummary(service);
}

function updateFromCheckedService() {
  const service = getCurrentService();
  console.log('Service radio changed:', service);
  updateServicePricing(service);
  showAppointmentMessage('', 'info');
}

function showLoginRequiredBlock() {
  if (!loginRequiredBlock) return;
  loginRequiredBlock.hidden = false;
  loginRequiredBlock.classList.add('is-visible');
}

function hideLoginRequiredBlock() {
  if (!loginRequiredBlock) return;
  loginRequiredBlock.hidden = true;
  loginRequiredBlock.classList.remove('is-visible');
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
  appointmentMessage.classList.toggle('error', type === 'error');
  appointmentMessage.classList.toggle('success', type === 'success');
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
  updateServicePricing(getCurrentService());
  validatePreferredDate();
  validateServiceArea();

  if (stepIndex === 0 && !currentService?.id) {
    showAppointmentMessage('Please choose a service before continuing.');
    return false;
  }

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
  updateServicePricing(getCurrentService());
  showAppointmentMessage('', 'info');
  if (shouldFocus) appointmentForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateReviewSummary(service = currentService || getCurrentService()) {
  if (!appointmentForm) return;
  const serviceName = service?.name || 'Not selected yet';
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
  if (reviewPrice && service) reviewPrice.textContent = `${money.format(service.deposit)} due today, ${money.format(service.remaining)} on-site`;
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
  const selectedService = getCurrentService();
  updateServicePricing(selectedService);

  if (!selectedService?.id) {
    throw new Error('Please choose a service.');
  }

  return {
    id: `appointment-${Date.now()}`,
    type: 'appointment',
    customerId: profile.customerId,
    customerName: profile.name,
    customerEmail: profile.email,
    customerPhone: profile.phone,
    serviceId: selectedService.id,
    serviceName: selectedService.name,
    startingPrice: selectedService.price,
    depositAmount: selectedService.deposit,
    remainingBalance: selectedService.remaining,
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
  hideLoginRequiredBlock();
  updateServicePricing(getCurrentService());

  if (!validateAllSteps()) {
    showAppointmentMessage('Please complete all required appointment fields before adding to cart.');
    return;
  }

  if (!validateServiceArea()) {
    showAppointmentMessage('EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.');
    return;
  }

  if (!window.EastCordAccount?.isAuthConfigured?.()) {
    showAppointmentMessage(window.EastCordAccount?.setupMessage || 'Account signup is being connected. Please contact EastCord Tires or check back soon.');
    logDeveloperError('Add Appointment attempted before Supabase env vars were configured.', window.EASTCORD_AUTH_CONFIG || {});
    return;
  }

  const profile = await window.EastCordAccount?.getCurrentProfile?.();
  if (!profile) {
    showLoginRequiredBlock();
    showAppointmentMessage('Please log in or create an account to add an appointment to your cart.');
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
    window.location.href = '/cart.html';
  } catch (error) {
    logDeveloperError('Appointment booking save failed.', error);
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

function initializeAppointmentPage() {
  if (appointmentPageInitialized) return;
  appointmentPageInitialized = true;

  document.querySelectorAll('input[name="serviceId"]').forEach((radio) => {
    radio.addEventListener('change', updateFromCheckedService);
  });

  menuToggle?.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    primaryNavigation?.classList.toggle('is-open', !isOpen);
  });

  primaryNavigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
  nextButtons.forEach((button) => button.addEventListener('click', () => validateStep(currentStep) && showStep(currentStep + 1)));
  backButtons.forEach((button) => button.addEventListener('click', () => showStep(currentStep - 1)));
  appointmentForm?.addEventListener('input', () => updateReviewSummary(currentService || getCurrentService()));
  appointmentForm?.addEventListener('change', (event) => {
    if (event.target?.matches?.('input[name="serviceId"]')) {
      updateFromCheckedService();
      return;
    }
    updateReviewSummary(currentService || getCurrentService());
  });
  citySelect?.addEventListener('change', validateServiceArea);
  preferredDate?.addEventListener('input', validatePreferredDate);
  appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

  window.updateEastCordServicePrice = () => updateServicePricing(getCurrentService());
  window.getCurrentEastCordService = getCurrentService;

  hideLoginRequiredBlock();
  setMinimumDate();
  updateServicePricing(getCurrentService());
  validatePreferredDate();
  validateServiceArea();
  showStep(0, false);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAppointmentPage);
} else {
  initializeAppointmentPage();
}
