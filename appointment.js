(() => {
  const serviceAreaCities = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);
  const money = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  });

  const state = {
    currentStep: 0,
    currentService: null,
    initialized: false,
  };

  const els = {};

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

  function cacheElements() {
    els.appointmentForm = document.querySelector('[data-appointment-form]');
    els.citySelect = document.querySelector('[data-city-select]');
    els.serviceAreaStatusField = document.querySelector('[data-service-area-status]');
    els.serviceAreaWarning = document.querySelector('[data-service-area-warning]');
    els.startingPrice = document.querySelector('[data-starting-price]');
    els.depositPrice = document.querySelector('[data-deposit-price]');
    els.balancePrice = document.querySelector('[data-balance-price]');
    els.serviceIdField = document.querySelector('[data-hidden-service-id]');
    els.serviceNameField = document.querySelector('[data-hidden-service-name]');
    els.startingPriceField = document.querySelector('[data-hidden-starting-price]');
    els.depositField = document.querySelector('[data-hidden-deposit-price]');
    els.balanceField = document.querySelector('[data-hidden-balance-price]');
    els.preferredDate = document.querySelector('[data-preferred-date]');
    els.appointmentMessage = document.querySelector('[data-appointment-message]');
    els.submitButton = document.querySelector('.appointment-submit');
    els.stepPanels = Array.from(document.querySelectorAll('[data-booking-step]'));
    els.progressSteps = Array.from(document.querySelectorAll('[data-appointment-progress] li'));
    els.nextButtons = Array.from(document.querySelectorAll('[data-next-step]'));
    els.backButtons = Array.from(document.querySelectorAll('[data-back-step]'));
    els.reviewService = document.querySelector('[data-review-service]');
    els.reviewVehicle = document.querySelector('[data-review-vehicle]');
    els.reviewLocation = document.querySelector('[data-review-location]');
    els.reviewDate = document.querySelector('[data-review-date]');
    els.reviewPrice = document.querySelector('[data-review-price]');
    els.loginRequiredBlock = document.querySelector('[data-login-required-block]');
    els.menuToggle = document.querySelector('.menu-toggle');
    els.primaryNavigation = document.querySelector('#primary-navigation');
    els.serviceRadios = Array.from(document.querySelectorAll('input[name="serviceId"]'));
    els.serviceDebug = document.querySelector('[data-service-debug]');
  }

  function ensureRuntimeDebug() {
    if (!els.serviceDebug || els.serviceDebug.querySelector('[data-debug-runtime-status]')) return;
    const runtime = document.createElement('div');
    runtime.style.marginTop = '8px';
    runtime.innerHTML = [
      'Script loaded: <span data-debug-script-loaded>yes</span><br />',
      'initializeAppointmentPage ran: <span data-debug-init-ran>no</span><br />',
      'Service radios found: <span data-debug-radio-count>0</span><br />',
      'Radio listener attached: <span data-debug-listener-attached>no</span><br />',
      'Last change event: <span data-debug-last-change>Not fired yet</span>',
    ].join('');
    runtime.setAttribute('data-debug-runtime-status', '');
    els.serviceDebug.appendChild(runtime);
  }

  function updateRuntimeDebug({ initRan, radioCount, listenerAttached, lastChange } = {}) {
    if (typeof initRan !== 'undefined') setText('[data-debug-init-ran]', initRan ? 'yes' : 'no');
    if (typeof radioCount !== 'undefined') setText('[data-debug-radio-count]', String(radioCount));
    if (typeof listenerAttached !== 'undefined') setText('[data-debug-listener-attached]', listenerAttached ? 'yes' : 'no');
    if (lastChange) setText('[data-debug-last-change]', lastChange);
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
    const time = new Date().toLocaleTimeString('en-CA', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });

    setText('[data-debug-service-id]', service.id || '');
    setText('[data-debug-service-name]', service.name || '');
    setText('[data-debug-service-price]', money.format(service.price));
    setText('[data-debug-deposit]', money.format(service.deposit));
    setText('[data-debug-remaining]', money.format(service.remaining));
    setText('[data-debug-last-selected]', time);
    updateRuntimeDebug({ lastChange: time });
  }

  function updateServicePricing(service = getCurrentService()) {
    if (!service) return;
    state.currentService = service;

    if (els.startingPrice) els.startingPrice.textContent = money.format(service.price);
    if (els.depositPrice) els.depositPrice.textContent = money.format(service.deposit);
    if (els.balancePrice) els.balancePrice.textContent = money.format(service.remaining);

    setValue(els.serviceIdField, service.id);
    setValue(els.serviceNameField, service.name);
    setValue(els.startingPriceField, service.price.toFixed(2));
    setValue(els.depositField, service.deposit.toFixed(2));
    setValue(els.balanceField, service.remaining.toFixed(2));

    updateServiceDebug(service);
    updateReviewSummary(service);
  }

  function updateFromCheckedService() {
    const service = getCurrentService();
    console.log('[EastCord appointment automation] Service radio changed:', service);
    updateServicePricing(service);
    showAppointmentMessage('', 'info');
  }

  function showLoginRequiredBlock() {
    if (!els.loginRequiredBlock) return;
    els.loginRequiredBlock.hidden = false;
    els.loginRequiredBlock.classList.add('is-visible');
  }

  function hideLoginRequiredBlock() {
    if (!els.loginRequiredBlock) return;
    els.loginRequiredBlock.hidden = true;
    els.loginRequiredBlock.classList.remove('is-visible');
  }

  function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setMinimumDate() {
    if (!els.preferredDate) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    els.preferredDate.min = formatDateInputValue(today);
  }

  function validatePreferredDate() {
    if (!els.preferredDate || !els.preferredDate.value) return true;
    const selectedDate = new Date(`${els.preferredDate.value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      els.preferredDate.setCustomValidity('Please choose today or a future date.');
      return false;
    }

    els.preferredDate.setCustomValidity('');
    return true;
  }

  function validateServiceArea() {
    if (!els.citySelect) return true;
    const city = els.citySelect.value;
    const isOther = city === 'Other';
    const inServiceArea = serviceAreaCities.has(city);
    const status = inServiceArea ? 'In service area' : isOther ? 'Outside service area' : '';

    if (els.serviceAreaStatusField) els.serviceAreaStatusField.value = status;
    if (els.serviceAreaWarning) els.serviceAreaWarning.hidden = !isOther;

    if (isOther) {
      els.citySelect.setCustomValidity('EastCord mobile tire service is currently available in Milton, Oakville, Brampton, and Mississauga only.');
      return false;
    }

    els.citySelect.setCustomValidity('');
    return true;
  }

  function showAppointmentMessage(message, type = 'error') {
    if (!els.appointmentMessage) return;
    els.appointmentMessage.textContent = message;
    els.appointmentMessage.classList.toggle('error', type === 'error');
    els.appointmentMessage.classList.toggle('success', type === 'success');
    els.appointmentMessage.dataset.messageType = type;
  }

  function getFieldValue(name) {
    const field = els.appointmentForm?.elements.namedItem(name);
    return field?.value?.trim() || '';
  }

  function getStepControls(stepIndex) {
    const step = els.stepPanels[stepIndex];
    if (!step) return [];
    return Array.from(step.querySelectorAll('input, select, textarea')).filter((control) => {
      return control.type !== 'hidden' && control.name !== 'bot-field' && !control.disabled;
    });
  }

  function validateStep(stepIndex) {
    updateServicePricing(getCurrentService());
    validatePreferredDate();
    validateServiceArea();

    if (stepIndex === 0 && !state.currentService?.id) {
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
      els.citySelect?.reportValidity();
      return false;
    }

    return true;
  }

  function updateProgress() {
    els.progressSteps.forEach((step, index) => {
      step.classList.toggle('is-active', index === state.currentStep);
      step.classList.toggle('is-complete', index < state.currentStep);
    });
  }

  function showStep(index, shouldFocus = true) {
    if (!els.stepPanels.length) return;
    state.currentStep = Math.max(0, Math.min(index, els.stepPanels.length - 1));
    els.stepPanels.forEach((step, stepIndex) => {
      const isActive = stepIndex === state.currentStep;
      step.hidden = !isActive;
      step.classList.toggle('is-active', isActive);
    });
    updateProgress();
    updateServicePricing(getCurrentService());
    showAppointmentMessage('', 'info');
    if (shouldFocus) els.appointmentForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateReviewSummary(service = state.currentService || getCurrentService()) {
    if (!els.appointmentForm) return;
    const serviceName = service?.name || 'Not selected yet';
    const vehicleParts = [getFieldValue('Vehicle Year'), getFieldValue('Vehicle Make'), getFieldValue('Vehicle Model')].filter(Boolean);
    const tireSize = getFieldValue('Tire Size');
    const tireCount = getFieldValue('Number of Tires');
    const address = getFieldValue('Full Service Address');
    const city = getFieldValue('City');
    const postalCode = getFieldValue('Postal Code');
    const date = getFieldValue('Preferred Date');
    const time = getFieldValue('Preferred Time Window');

    if (els.reviewService) els.reviewService.textContent = serviceName;
    if (els.reviewVehicle) {
      els.reviewVehicle.textContent = vehicleParts.length || tireSize || tireCount
        ? `${vehicleParts.join(' ') || 'Vehicle details'}${tireSize ? `, ${tireSize}` : ''}${tireCount ? `, ${tireCount} tire(s)` : ''}`
        : 'Not entered yet';
    }
    if (els.reviewLocation) els.reviewLocation.textContent = address || city || postalCode ? [address, city, postalCode].filter(Boolean).join(', ') : 'Not entered yet';
    if (els.reviewDate) els.reviewDate.textContent = date || time ? [date, time].filter(Boolean).join(' at ') : 'Not entered yet';
    if (els.reviewPrice && service) els.reviewPrice.textContent = `${money.format(service.deposit)} due today, ${money.format(service.remaining)} on-site`;
  }

  function validateAllSteps() {
    for (let index = 0; index < els.stepPanels.length; index += 1) {
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
      serviceAreaStatus: els.serviceAreaStatusField?.value || 'In service area',
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
      if (els.submitButton) {
        els.submitButton.disabled = true;
        els.submitButton.textContent = 'Saving Booking...';
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
      if (els.submitButton) {
        els.submitButton.disabled = false;
        els.submitButton.textContent = 'Add Appointment to Cart';
      }
    }
  }

  function closeMobileMenu() {
    if (!els.menuToggle || !els.primaryNavigation) return;
    els.menuToggle.setAttribute('aria-expanded', 'false');
    els.primaryNavigation.classList.remove('is-open');
  }

  function initializeAppointmentPage() {
    if (state.initialized) return;
    cacheElements();
    ensureRuntimeDebug();
    state.initialized = true;

    console.log('[EastCord appointment automation] appointment.js loaded.');
    console.log('[EastCord appointment automation] Service radios found:', els.serviceRadios.length);
    updateRuntimeDebug({ initRan: true, radioCount: els.serviceRadios.length, listenerAttached: els.serviceRadios.length === 6 });

    els.serviceRadios.forEach((radio) => {
      radio.addEventListener('change', updateFromCheckedService);
    });

    els.menuToggle?.addEventListener('click', () => {
      const isOpen = els.menuToggle.getAttribute('aria-expanded') === 'true';
      els.menuToggle.setAttribute('aria-expanded', String(!isOpen));
      els.primaryNavigation?.classList.toggle('is-open', !isOpen);
    });

    els.primaryNavigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMobileMenu));
    els.nextButtons.forEach((button) => button.addEventListener('click', () => validateStep(state.currentStep) && showStep(state.currentStep + 1)));
    els.backButtons.forEach((button) => button.addEventListener('click', () => showStep(state.currentStep - 1)));
    els.appointmentForm?.addEventListener('input', () => updateReviewSummary(state.currentService || getCurrentService()));
    els.appointmentForm?.addEventListener('change', (event) => {
      if (event.target?.matches?.('input[name="serviceId"]')) return;
      updateReviewSummary(state.currentService || getCurrentService());
    });
    els.citySelect?.addEventListener('change', validateServiceArea);
    els.preferredDate?.addEventListener('input', validatePreferredDate);
    els.appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

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
    document.addEventListener('DOMContentLoaded', initializeAppointmentPage, { once: true });
  } else {
    initializeAppointmentPage();
  }
})();
