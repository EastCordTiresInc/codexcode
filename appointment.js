const appointmentForm = document.querySelector('[data-appointment-form]');
const citySelect = document.querySelector('[data-city-select]');
const serviceAreaStatusField = document.querySelector('[data-service-area-status]');
const serviceAreaWarning = document.querySelector('[data-service-area-warning]');
const startingPrice = document.querySelector('[data-starting-price]');
const depositPrice = document.querySelector('[data-deposit-price]');
const balancePrice = document.querySelector('[data-balance-price]');
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
const serviceOptionIds = new Set([
  'seasonal-changeover-rims',
  'seasonal-swap-not-mounted',
  'mount-balance-1',
  'mount-balance-2',
  'mount-balance-3',
  'mount-balance-4',
]);
let currentStep = 0;
let visibleServiceSelect = null;

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

function getSelectedOptionText(select) {
  const option = select?.options?.[select.selectedIndex];
  return option?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function isElementVisible(element) {
  if (!element) return false;
  if (element.hidden || element.closest('[hidden]')) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  return element.getClientRects().length > 0;
}

function isServiceSelect(select) {
  if (!select) return false;
  if (select.id === 'service-select' || select.name === 'serviceId') return true;
  return Array.from(select.options || []).some((option) => serviceOptionIds.has(option.value));
}

function getSelectDiagnostics() {
  return Array.from(document.querySelectorAll('select')).map((select, index) => {
    const option = select.options?.[select.selectedIndex];
    const parent = select.parentElement;
    return {
      index: index + 1,
      id: select.id || '(none)',
      name: select.name || '(none)',
      value: select.value || '(empty)',
      selectedIndex: select.selectedIndex,
      selectedText: option?.textContent?.replace(/\s+/g, ' ').trim() || '(none)',
      visible: isElementVisible(select) ? 'visible' : 'hidden',
      parent: parent ? `${parent.tagName.toLowerCase()}${parent.className ? `.${String(parent.className).replace(/\s+/g, '.')}` : ''}` : '(none)',
      isServiceSelect: isServiceSelect(select),
    };
  });
}

function updateSelectDiagnosticsDebug() {
  const diagnostics = getSelectDiagnostics();
  console.table?.(diagnostics);
  setText('[data-debug-select-total]', String(diagnostics.length));

  [0, 1].forEach((offset) => {
    const item = diagnostics[offset];
    const slot = offset + 1;
    setText(`[data-debug-select-${slot}-id]`, item ? `${item.id} / ${item.name} / ${item.visible}` : '(none)');
    setText(`[data-debug-select-${slot}-value]`, item ? `${item.value} / index ${item.selectedIndex}` : '(none)');
    setText(`[data-debug-select-${slot}-text]`, item ? item.selectedText : '(none)');
  });

  console.log('EastCord appointment select diagnostics:', diagnostics);
  return diagnostics;
}

function resolveVisibleServiceSelect() {
  const allSelects = Array.from(document.querySelectorAll('select'));
  const serviceSelects = allSelects.filter(isServiceSelect);
  const visibleServiceSelects = serviceSelects.filter(isElementVisible);
  const preferred = visibleServiceSelects[0] || serviceSelects.find((select) => select.id === 'service-select') || serviceSelects[0] || null;

  if (!preferred) {
    console.error('No service select found');
    visibleServiceSelect = null;
    return null;
  }

  serviceSelects.forEach((select) => {
    if (select === preferred) return;
    select.removeAttribute('id');
    select.setAttribute('data-duplicate-service-select', 'removed-from-pricing');
    select.disabled = true;
    select.hidden = true;
    select.style.display = 'none';
    console.warn('Duplicate service select hidden and removed from pricing:', select);
  });

  preferred.id = 'service-select';
  preferred.name = 'serviceId';
  visibleServiceSelect = preferred;
  updateSelectDiagnosticsDebug();
  return preferred;
}

function getCurrentService() {
  const select = visibleServiceSelect && document.body.contains(visibleServiceSelect)
    ? visibleServiceSelect
    : resolveVisibleServiceSelect();

  if (!select) {
    console.error('service-select not found');
    return null;
  }

  const option = select.options[select.selectedIndex];

  if (!option) {
    console.error('No selected service option found');
    return null;
  }

  const price = Number(option.dataset.price || 0);
  const deposit = Math.round(price * 0.20 * 100) / 100;
  const remaining = Math.round((price - deposit) * 100) / 100;

  return {
    id: option.value,
    name: option.dataset.name || option.textContent.trim(),
    price,
    deposit,
    remaining,
    selectedIndex: select.selectedIndex,
    rawValue: select.value,
    rawDataPrice: option.dataset.price,
  };
}

function updateServiceDebug(current) {
  updateSelectDiagnosticsDebug();
  if (!current) return;

  setText('[data-debug-raw-value]', current.rawValue || '');
  setText('[data-debug-selected-index]', String(current.selectedIndex));
  setText('[data-debug-data-price]', current.rawDataPrice || '');
  setText('[data-debug-service-id]', current.id || '');
  setText('[data-debug-service-price]', money.format(current.price));
  setText('[data-debug-deposit]', money.format(current.deposit));
  setText('[data-debug-remaining]', money.format(current.remaining));
  setText('[data-debug-last-update]', new Date().toLocaleTimeString('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }));
}

function updateServicePricing(current) {
  if (!current) return;

  if (startingPrice) startingPrice.textContent = money.format(current.price);
  if (depositPrice) depositPrice.textContent = money.format(current.deposit);
  if (balancePrice) balancePrice.textContent = money.format(current.remaining);

  setValue(serviceNameField, current.name);
  setValue(startingPriceField, current.price.toFixed(2));
  setValue(depositField, current.deposit.toFixed(2));
  setValue(balanceField, current.remaining.toFixed(2));

  updateServiceDebug(current);
  updateReviewSummary(current);
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

function updateReviewSummary(current = getCurrentService()) {
  if (!appointmentForm) return;
  const serviceName = current?.name || 'Not selected yet';
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
  if (reviewPrice && current) reviewPrice.textContent = `${money.format(current.deposit)} due today, ${money.format(current.remaining)} on-site`;
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
  const current = getCurrentService();
  updateServicePricing(current);

  if (!current) {
    throw new Error('Please choose a service.');
  }

  return {
    id: `appointment-${Date.now()}`,
    type: 'appointment',
    customerId: profile.customerId,
    customerName: profile.name,
    customerEmail: profile.email,
    customerPhone: profile.phone,
    serviceId: current.id,
    serviceName: current.name,
    startingPrice: current.price,
    depositAmount: current.deposit,
    remainingBalance: current.remaining,
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
  const select = resolveVisibleServiceSelect();

  if (!select) {
    console.error('service-select missing on DOMContentLoaded');
    return;
  }

  select.addEventListener('change', () => {
    visibleServiceSelect = select;
    const current = getCurrentService();
    console.log('Service changed:', current);
    updateServicePricing(current);
  });

  select.addEventListener('input', () => {
    visibleServiceSelect = select;
    const current = getCurrentService();
    console.log('Service input:', current);
    updateServicePricing(current);
  });

  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement) {
      updateSelectDiagnosticsDebug();
    }
    if (event.target === visibleServiceSelect) {
      const current = getCurrentService();
      console.log('Service changed from document listener:', current);
      updateServicePricing(current);
    }
  }, true);

  document.querySelector('[data-force-price-recalculate]')?.addEventListener('click', () => {
    visibleServiceSelect = resolveVisibleServiceSelect();
    const current = getCurrentService();
    console.log('Service force recalculated:', current);
    updateServicePricing(current);
  });

  menuToggle?.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    primaryNavigation?.classList.toggle('is-open', !isOpen);
  });

  primaryNavigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
  nextButtons.forEach((button) => button.addEventListener('click', () => validateStep(currentStep) && showStep(currentStep + 1)));
  backButtons.forEach((button) => button.addEventListener('click', () => showStep(currentStep - 1)));
  appointmentForm?.addEventListener('input', () => updateReviewSummary(getCurrentService()));
  appointmentForm?.addEventListener('change', () => updateReviewSummary(getCurrentService()));
  citySelect?.addEventListener('change', validateServiceArea);
  preferredDate?.addEventListener('input', validatePreferredDate);
  appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

  window.updateEastCordServicePrice = () => updateServicePricing(getCurrentService());
  window.updateEastCordServicePriceFromSelect = () => updateServicePricing(getCurrentService());
  window.getCurrentEastCordService = getCurrentService;
  window.getEastCordSelectDiagnostics = getSelectDiagnostics;

  hideLoginRequiredBlock();
  setMinimumDate();
  updateServicePricing(getCurrentService());
  validatePreferredDate();
  validateServiceArea();
  showStep(0, false);
}

document.addEventListener('DOMContentLoaded', initializeAppointmentPage);
