(() => {
  const serviceAreaCities = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);
  const PENDING_APPOINTMENT_KEY = 'eastcord_pending_appointment_v1';
  const APPOINTMENT_RESTORE_URL = '/appointment.html?restore=appointment#appointment-booking';
  const MIN_ADVANCE_MINUTES = 120;
  const MIN_ADVANCE_MESSAGE = 'Appointments must be booked at least 2 hours in advance to allow technician scheduling and travel time.';
  const REQUIRED_FIELD_MESSAGES = {
    'Vehicle Plate Number': 'Please enter your vehicle plate number.',
    'Vehicle Colour': 'Please enter your vehicle colour.',
  };
  const money = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  });

  const state = {
    currentStep: 0,
    currentService: null,
    initialized: false,
    paidBookedSlots: new Set(),
    paidBookedSlotsDate: '',
    paidBookedSlotsLoading: false,
  };

  const els = {};

  function logDeveloperError(context, error) {
    console.error(`[EastCord appointment automation] ${context}`, error);
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
    els.serviceSelect = document.getElementById('service-select');
    els.serviceIdField = document.querySelector('[data-hidden-service-id]');
    els.serviceNameField = document.querySelector('[data-hidden-service-name]');
    els.startingPriceField = document.querySelector('[data-hidden-starting-price]');
    els.depositField = document.querySelector('[data-hidden-deposit-price]');
    els.balanceField = document.querySelector('[data-hidden-balance-price]');
    els.preferredDate = document.querySelector('[data-preferred-date]');
    els.preferredTimeWindow = els.appointmentForm?.elements.namedItem('Preferred Time Window');
    els.todayTimeWarning = document.querySelector('[data-today-time-warning]');
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
  }

  function getCurrentService() {
    const select = els.serviceSelect || document.getElementById('service-select');
    if (!select) {
      console.error('[EastCord appointment automation] service-select not found.');
      return null;
    }

    const option = select.options[select.selectedIndex];
    if (!option) {
      console.error('[EastCord appointment automation] No selected service option found.');
      return null;
    }

    const price = Number(option.dataset.price || 0);
    const deposit = Math.round(price * 0.20 * 100) / 100;
    const remaining = Math.round((price - deposit) * 100) / 100;

    return {
      id: option.value,
      name: option.dataset.serviceName || option.textContent.trim(),
      price,
      deposit,
      remaining,
    };
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

    updateReviewSummary(service);
  }

  function updateFromSelectedService() {
    const service = getCurrentService();
    console.log('[EastCord appointment automation] Service changed:', service);
    updateServicePricing(service);
    showAppointmentMessage('', 'info');
  }

  function getLoginRedirectUrl() {
    return `/login.html?redirect=${encodeURIComponent(APPOINTMENT_RESTORE_URL)}`;
  }

  function getSignupRedirectUrl() {
    return `/signup.html?redirect=${encodeURIComponent(APPOINTMENT_RESTORE_URL)}`;
  }

  function updateAuthActionLinks() {
    if (!els.loginRequiredBlock) return;
    const loginLink = els.loginRequiredBlock.querySelector('a[href*="login.html"]');
    const signupLink = els.loginRequiredBlock.querySelector('a[href*="signup.html"]');
    if (loginLink) loginLink.href = getLoginRedirectUrl();
    if (signupLink) signupLink.href = getSignupRedirectUrl();
  }

  function showLoginRequiredBlock() {
    if (!els.loginRequiredBlock) return;
    updateAuthActionLinks();
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

  function isSameInputDate(dateValue, date) {
    return dateValue === formatDateInputValue(date);
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

  function getAppointmentStartDate(date, timeWindow) {
    const startMinutes = getTimeWindowStartMinutes(timeWindow);
    if (!date || startMinutes === null) return null;

    const startDate = new Date(`${date}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return null;

    startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    return startDate;
  }

  function isPastTimeSlot(date, timeWindow) {
    const startDate = getAppointmentStartDate(date, timeWindow);
    if (!startDate) return false;
    return startDate.getTime() <= Date.now();
  }

  function isLessThanMinimumAdvance(date, timeWindow) {
    const startDate = getAppointmentStartDate(date, timeWindow);
    if (!startDate) return false;
    return startDate.getTime() - Date.now() < MIN_ADVANCE_MINUTES * 60 * 1000;
  }

  function getSlotKey(date, timeWindow) {
    return `${date || ''}__${timeWindow || ''}`;
  }

  function getCartAppointmentItems() {
    try {
      return window.EastCordAccount?.getCart?.().filter((item) => item.type === 'appointment') || [];
    } catch (error) {
      logDeveloperError('Cart could not be read for slot blocking.', error);
      return [];
    }
  }

  function getCartBlockedSlots(date) {
    return new Set(
      getCartAppointmentItems()
        .filter((item) => item.preferredDate === date && item.preferredTimeWindow)
        .map((item) => getSlotKey(item.preferredDate, item.preferredTimeWindow))
    );
  }

  function getSlotUnavailableReason(date, timeWindow) {
    if (!date || !timeWindow) return '';
    const key = getSlotKey(date, timeWindow);

    if (isPastTimeSlot(date, timeWindow)) return 'Please choose a future time window.';
    if (isLessThanMinimumAdvance(date, timeWindow)) return MIN_ADVANCE_MESSAGE;
    if (getCartBlockedSlots(date).has(key)) return 'This time is already in your cart. Please choose another time slot for this vehicle.';
    if (state.paidBookedSlotsDate === date && state.paidBookedSlots.has(key)) return 'This time is already booked. Please choose another time slot.';
    return '';
  }

  async function fetchPaidBookedSlots(date) {
    const client = window.EastCordAccount?.getSupabaseClient?.();
    if (!client || !date) return new Set();

    const { data, error } = await client
      .from('appointment_bookings')
      .select('preferred_date, preferred_time_window, payment_status, booking_status')
      .eq('preferred_date', date)
      .eq('payment_status', 'paid_deposit')
      .eq('booking_status', 'Confirmed');

    if (error) {
      logDeveloperError('Confirmed paid appointment slots could not be loaded.', error);
      return new Set();
    }

    return new Set((data || []).map((row) => getSlotKey(row.preferred_date, row.preferred_time_window)));
  }

  async function refreshPaidBookedSlotsForSelectedDate() {
    if (!els.preferredDate?.value) {
      state.paidBookedSlots = new Set();
      state.paidBookedSlotsDate = '';
      updateAvailableTimeWindows();
      return;
    }

    const selectedDate = els.preferredDate.value;
    state.paidBookedSlotsLoading = true;
    state.paidBookedSlots = await fetchPaidBookedSlots(selectedDate);
    state.paidBookedSlotsDate = selectedDate;
    state.paidBookedSlotsLoading = false;
    updateAvailableTimeWindows();
  }

  function ensureTodayTimeWarning() {
    if (els.todayTimeWarning || !els.preferredTimeWindow) return els.todayTimeWarning;

    const warning = document.createElement('p');
    warning.className = 'appointment-service-area-warning';
    warning.dataset.todayTimeWarning = '';
    warning.hidden = true;
    warning.textContent = 'No appointment times are available for today. Please choose the next available date.';

    const fieldGrid = els.preferredTimeWindow.closest('.appointment-field-grid');
    if (fieldGrid) fieldGrid.insertAdjacentElement('afterend', warning);
    els.todayTimeWarning = warning;
    return warning;
  }

  function setTimeOptionState(option, isAvailable, reason) {
    option.dataset.originalLabel = option.dataset.originalLabel || option.textContent;
    option.disabled = !isAvailable;
    option.hidden = false;
    option.textContent = reason ? `${option.dataset.originalLabel} (${reason})` : option.dataset.originalLabel;
  }

  function updateAvailableTimeWindows() {
    if (!els.preferredDate || !els.preferredTimeWindow) return true;

    const selectedDate = els.preferredDate.value;
    const warning = ensureTodayTimeWarning();
    const options = Array.from(els.preferredTimeWindow.options).filter((option) => option.value);

    options.forEach((option) => setTimeOptionState(option, true, ''));
    els.preferredTimeWindow.setCustomValidity('');
    if (warning) warning.hidden = true;

    if (!selectedDate) {
      updateReviewSummary(state.currentService || getCurrentService());
      return true;
    }

    let availableCount = 0;

    options.forEach((option) => {
      const unavailableMessage = getSlotUnavailableReason(selectedDate, option.value);
      const isAvailable = !unavailableMessage;
      const labelReason = unavailableMessage.includes('cart')
        ? 'Already in your cart'
        : unavailableMessage.includes('booked')
          ? 'Booked'
          : unavailableMessage.includes('2 hours')
            ? '2-hour notice required'
            : unavailableMessage
              ? 'Unavailable'
              : '';
      setTimeOptionState(option, isAvailable, labelReason);
      if (isAvailable) availableCount += 1;
    });

    const selectedOption = els.preferredTimeWindow.options[els.preferredTimeWindow.selectedIndex];
    if (selectedOption?.disabled) els.preferredTimeWindow.value = '';

    if (!availableCount) {
      els.preferredTimeWindow.value = '';
      const noTimesMessage = isSameInputDate(selectedDate, new Date())
        ? 'No appointment times are available for today. Please choose the next available date.'
        : 'No appointment times are available for this date. Please choose another date.';
      els.preferredTimeWindow.setCustomValidity(noTimesMessage);
      if (warning) {
        warning.textContent = noTimesMessage;
        warning.hidden = false;
      }
      updateReviewSummary(state.currentService || getCurrentService());
      return false;
    }

    updateReviewSummary(state.currentService || getCurrentService());
    return true;
  }

  function validatePreferredDate() {
    if (!els.preferredDate || !els.preferredDate.value) {
      updateAvailableTimeWindows();
      return true;
    }

    const selectedDate = new Date(`${els.preferredDate.value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      els.preferredDate.setCustomValidity('Please choose today or a future date.');
      updateAvailableTimeWindows();
      return false;
    }

    els.preferredDate.setCustomValidity('');
    return updateAvailableTimeWindows();
  }

  function validatePreferredTimeWindow() {
    if (!els.preferredDate || !els.preferredTimeWindow) return true;
    updateAvailableTimeWindows();

    if (!els.preferredDate.value || !els.preferredTimeWindow.value) return true;

    const unavailableMessage = getSlotUnavailableReason(els.preferredDate.value, els.preferredTimeWindow.value);
    if (unavailableMessage) {
      els.preferredTimeWindow.value = '';
      els.preferredTimeWindow.setCustomValidity(unavailableMessage);
      updateReviewSummary(state.currentService || getCurrentService());
      return false;
    }

    els.preferredTimeWindow.setCustomValidity('');
    return true;
  }

  async function validateSelectedSlotAvailability() {
    if (!els.preferredDate?.value || !els.preferredTimeWindow?.value) return false;
    const selectedDate = els.preferredDate.value;
    const selectedTimeWindow = els.preferredTimeWindow.value;
    await refreshPaidBookedSlotsForSelectedDate();

    const unavailableMessage = getSlotUnavailableReason(selectedDate, selectedTimeWindow);
    if (unavailableMessage) {
      els.preferredTimeWindow.value = '';
      els.preferredTimeWindow.setCustomValidity(unavailableMessage);
      showAppointmentMessage(unavailableMessage);
      updateReviewSummary(state.currentService || getCurrentService());
      return false;
    }

    els.preferredTimeWindow.setCustomValidity('');
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

  function applyCustomRequiredMessages(controls) {
    controls.forEach((control) => {
      if (!Object.prototype.hasOwnProperty.call(REQUIRED_FIELD_MESSAGES, control.name)) return;
      const isMissing = control.required && !String(control.value || '').trim();
      control.setCustomValidity(isMissing ? REQUIRED_FIELD_MESSAGES[control.name] : '');
    });
  }

  function validateStep(stepIndex) {
    updateServicePricing(getCurrentService());
    const dateIsValid = validatePreferredDate();
    const timeIsValid = validatePreferredTimeWindow();
    validateServiceArea();

    if (stepIndex === 0 && !state.currentService?.id) {
      showAppointmentMessage('Please choose a service before continuing.');
      return false;
    }

    const controls = getStepControls(stepIndex);
    applyCustomRequiredMessages(controls);
    const firstInvalid = controls.find((control) => !control.checkValidity());
    if (firstInvalid) {
      firstInvalid.reportValidity();
      return false;
    }

    if (stepIndex === 2 && !validateServiceArea()) {
      els.citySelect?.reportValidity();
      return false;
    }

    if (stepIndex === 3 && (!dateIsValid || !timeIsValid)) {
      (els.preferredTimeWindow || els.preferredDate)?.reportValidity();
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
    validatePreferredDate();
    showAppointmentMessage('', 'info');
    if (shouldFocus) els.appointmentForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateReviewSummary(service = state.currentService || getCurrentService()) {
    if (!els.appointmentForm) return;
    const serviceName = service?.name || 'Not selected yet';
    const vehicleParts = [getFieldValue('Vehicle Year'), getFieldValue('Vehicle Make'), getFieldValue('Vehicle Model')].filter(Boolean);
    const vehiclePlate = getFieldValue('Vehicle Plate Number');
    const vehicleColour = getFieldValue('Vehicle Colour');
    const tireSize = getFieldValue('Tire Size');
    const tireCount = getFieldValue('Number of Tires');
    const address = getFieldValue('Full Service Address');
    const city = getFieldValue('City');
    const postalCode = getFieldValue('Postal Code');
    const date = getFieldValue('Preferred Date');
    const time = getFieldValue('Preferred Time Window');

    if (els.reviewService) els.reviewService.textContent = serviceName;
    if (els.reviewVehicle) {
      const details = [
        vehicleParts.join(' ') || 'Vehicle details',
        vehiclePlate ? `Plate: ${vehiclePlate}` : '',
        vehicleColour ? `Colour: ${vehicleColour}` : '',
        tireSize || '',
        tireCount ? `${tireCount} tire(s)` : '',
      ].filter(Boolean);
      els.reviewVehicle.textContent = vehicleParts.length || vehiclePlate || vehicleColour || tireSize || tireCount
        ? details.join(', ')
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

  function collectAppointmentDraft() {
    const service = getCurrentService();
    const fields = {};
    if (els.appointmentForm) {
      new FormData(els.appointmentForm).forEach((value, key) => {
        if (!['form-name', 'Booking Status', 'Service area status', 'Service Name', 'Starting Price', 'Booking Deposit', 'Remaining Balance'].includes(key)) {
          fields[key] = String(value || '');
        }
      });
    }

    return {
      serviceId: service?.id || 'seasonal-changeover-rims',
      fields,
      currentStep: state.currentStep,
      savedAt: new Date().toISOString(),
    };
  }

  function savePendingAppointmentDraft() {
    try {
      localStorage.setItem(PENDING_APPOINTMENT_KEY, JSON.stringify(collectAppointmentDraft()));
      localStorage.setItem('eastcord_auth_redirect', APPOINTMENT_RESTORE_URL);
    } catch (error) {
      logDeveloperError('Pending appointment draft could not be saved.', error);
    }
  }

  function clearPendingAppointmentDraft() {
    localStorage.removeItem(PENDING_APPOINTMENT_KEY);
  }

  function restorePendingAppointmentDraft() {
    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(PENDING_APPOINTMENT_KEY) || 'null');
    } catch (error) {
      logDeveloperError('Pending appointment draft could not be read.', error);
    }

    if (!draft || !els.appointmentForm) return false;

    if (els.serviceSelect && draft.serviceId) {
      els.serviceSelect.value = draft.serviceId;
    }

    Object.entries(draft.fields || {}).forEach(([name, value]) => {
      const field = els.appointmentForm.elements.namedItem(name);
      if (!field || field.type === 'hidden') return;
      field.value = value;
    });

    updateServicePricing(getCurrentService());
    validateServiceArea();
    validatePreferredDate();
    refreshPaidBookedSlotsForSelectedDate();
    updateReviewSummary(state.currentService || getCurrentService());
    return true;
  }

  function buildAppointmentItem(profile) {
    const selectedService = getCurrentService();
    updateServicePricing(selectedService);

    if (!selectedService?.id) {
      throw new Error('Please choose a service.');
    }

    if (!validatePreferredDate() || !validatePreferredTimeWindow()) {
      throw new Error('Please choose a valid future appointment date and time window.');
    }

    return {
      id: `appointment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      vehiclePlateNumber: getFieldValue('Vehicle Plate Number'),
      vehicleColour: getFieldValue('Vehicle Colour'),
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

    if (!validatePreferredDate() || !validatePreferredTimeWindow()) {
      showAppointmentMessage('Please choose a valid future appointment date and time window.');
      return;
    }

    if (!(await validateSelectedSlotAvailability())) {
      return;
    }

    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      savePendingAppointmentDraft();
      showLoginRequiredBlock();
      showAppointmentMessage(window.EastCordAccount?.setupMessage || 'Account signup is being connected. Please contact EastCord Tires or check back soon.');
      logDeveloperError('Add Appointment attempted before Supabase env vars were configured.', window.EASTCORD_AUTH_CONFIG || {});
      return;
    }

    const profile = await window.EastCordAccount?.getCurrentProfile?.();
    if (!profile) {
      savePendingAppointmentDraft();
      showLoginRequiredBlock();
      showAppointmentMessage('Your appointment details are saved on this device. Please log in or create an account, then you will return to review this appointment.');
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

      const cart = window.EastCordAccount.getCart();
      cart.push(appointmentItem);
      window.EastCordAccount.saveCart(cart);
      clearPendingAppointmentDraft();
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
    state.initialized = true;

    console.log('[EastCord appointment automation] appointment.js loaded.');
    console.log('[EastCord appointment automation] Service select found:', Boolean(els.serviceSelect));

    els.serviceSelect?.addEventListener('change', updateFromSelectedService);

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
      if (event.target?.matches?.('#service-select')) return;
      updateReviewSummary(state.currentService || getCurrentService());
    });
    els.citySelect?.addEventListener('change', validateServiceArea);
    els.preferredDate?.addEventListener('input', () => {
      validatePreferredDate();
      refreshPaidBookedSlotsForSelectedDate();
    });
    els.preferredDate?.addEventListener('change', () => {
      validatePreferredDate();
      refreshPaidBookedSlotsForSelectedDate();
    });
    els.preferredTimeWindow?.addEventListener('change', validatePreferredTimeWindow);
    els.appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

    window.updateEastCordServicePrice = () => updateServicePricing(getCurrentService());
    window.getCurrentEastCordService = getCurrentService;

    hideLoginRequiredBlock();
    updateAuthActionLinks();
    setMinimumDate();
    const restored = restorePendingAppointmentDraft();
    updateServicePricing(getCurrentService());
    validatePreferredDate();
    validateServiceArea();
    refreshPaidBookedSlotsForSelectedDate();
    const shouldRestoreToReview = restored && new URLSearchParams(window.location.search).get('restore') === 'appointment';
    showStep(shouldRestoreToReview ? 4 : 0, false);
    if (shouldRestoreToReview) showAppointmentMessage('Your saved appointment details have been restored. Please review and add this appointment to cart.', 'success');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAppointmentPage, { once: true });
  } else {
    initializeAppointmentPage();
  }
})();
