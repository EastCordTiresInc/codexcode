(() => {
  const serviceAreaCities = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);
  const PENDING_APPOINTMENT_KEY = 'eastcord_pending_appointment_v1';
  const APPOINTMENT_RESTORE_URL = '/appointment.html?restore=appointment#appointment-booking';
  const MIN_ADVANCE_MINUTES = 120;
  const TAX_RATE = 0.13;
  const MIN_ADVANCE_MESSAGE = 'Appointments must be booked at least 2 hours in advance to allow technician scheduling and travel time.';
  const REQUIRED_FIELD_MESSAGES = {
    'Vehicle Plate Number': 'Please enter your vehicle plate number.',
    'Vehicle Colour': 'Please enter your vehicle colour.',
  };
  const money = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const state = {
    currentStep: 0,
    currentService: null,
    initialized: false,
    paidBookedSlots: new Set(),
    paidBookedSlotsDate: '',
    paidBookedSlotsLoading: false,
    savedTires: [],
    selectedTireIds: new Set(),
  };

  const els = {};

  function logDeveloperError(context, error) {
    console.error(`[EastCord appointment automation] ${context}`, error);
  }

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function calculateServiceAmounts(subtotal) {
    const serviceSubtotal = roundMoney(subtotal);
    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const deposit = roundMoney(totalWithHst * 0.20);
    const remaining = roundMoney(totalWithHst - deposit);

    return {
      serviceSubtotal,
      hstAmount,
      totalWithHst,
      deposit,
      remaining,
      taxRate: TAX_RATE,
    };
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
    els.hstPrice = document.querySelector('[data-hst-price]');
    els.totalPrice = document.querySelector('[data-total-price]');
    els.depositPrice = document.querySelector('[data-deposit-price]');
    els.balancePrice = document.querySelector('[data-balance-price]');
    els.serviceSelect = document.getElementById('service-select');
    els.serviceIdField = document.querySelector('[data-hidden-service-id]');
    els.serviceNameField = document.querySelector('[data-hidden-service-name]');
    els.startingPriceField = document.querySelector('[data-hidden-starting-price]');
    els.serviceSubtotalField = document.querySelector('[data-hidden-service-subtotal]');
    els.hstAmountField = document.querySelector('[data-hidden-hst-amount]');
    els.totalWithHstField = document.querySelector('[data-hidden-total-with-hst]');
    els.taxRateField = document.querySelector('[data-hidden-tax-rate]');
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
    els.reviewTires = document.querySelector('[data-review-tires]');
    els.reviewPrice = document.querySelector('[data-review-price]');
    els.tireOptions = document.querySelector('[data-appointment-tire-options]');
    els.appointmentCartSummary = document.querySelector('[data-appointment-cart-summary]');
    els.tireCartSummary = document.querySelector('[data-tire-cart-summary]');
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

    const price = roundMoney(option.dataset.price || 0);
    const amounts = calculateServiceAmounts(price);

    return {
      id: option.value,
      name: option.dataset.serviceName || option.textContent.trim(),
      price,
      startingPrice: price,
      ...amounts,
    };
  }

  function updateServicePricing(service = getCurrentService()) {
    if (!service) return;
    state.currentService = service;

    if (els.startingPrice) els.startingPrice.textContent = money.format(service.serviceSubtotal);
    if (els.hstPrice) els.hstPrice.textContent = money.format(service.hstAmount);
    if (els.totalPrice) els.totalPrice.textContent = money.format(service.totalWithHst);
    if (els.depositPrice) els.depositPrice.textContent = money.format(service.deposit);
    if (els.balancePrice) els.balancePrice.textContent = money.format(service.remaining);

    setValue(els.serviceIdField, service.id);
    setValue(els.serviceNameField, service.name);
    setValue(els.startingPriceField, service.serviceSubtotal.toFixed(2));
    setValue(els.serviceSubtotalField, service.serviceSubtotal.toFixed(2));
    setValue(els.hstAmountField, service.hstAmount.toFixed(2));
    setValue(els.totalWithHstField, service.totalWithHst.toFixed(2));
    setValue(els.taxRateField, service.taxRate.toFixed(2));
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

  function getLocalUsedTireCart() {
    try {
      const stored = JSON.parse(localStorage.getItem('eastcord_used_tire_cart_v1') || '[]');
      return Array.isArray(stored)
        ? stored.filter((item) => item?.type === 'used_tire' && item.inventoryId)
        : [];
    } catch (error) {
      logDeveloperError('Used tire cart could not be read.', error);
      return [];
    }
  }

  function getSelectedTires() {
    return state.savedTires.filter((item) => state.selectedTireIds.has(String(item.inventoryId)));
  }

  function formatSavedTireLabel(item) {
    const qty = Math.max(1, Number(item.qty) || 1);
    return `${item.brand || 'Tire'} ${item.size || ''}`.trim() + ` × ${qty}`;
  }

  function getSelectedTiresSummary() {
    const selected = getSelectedTires();
    if (!selected.length) return 'No saved tires selected';
    return selected.map(formatSavedTireLabel).join(', ');
  }

  function applySelectedTiresToForm() {
    const selected = getSelectedTires();
    if (!selected.length || !els.appointmentForm) return;

    const sizes = [...new Set(selected.map((item) => String(item.size || '').trim()).filter(Boolean))];
    const totalQty = Math.min(4, selected.reduce((sum, item) => sum + (Number(item.qty) || 1), 0));
    const sizeField = els.appointmentForm.elements.namedItem('Tire Size');
    const qtyField = els.appointmentForm.elements.namedItem('Number of Tires');

    if (sizeField && sizes.length === 1) sizeField.value = sizes[0];
    if (qtyField && totalQty) qtyField.value = String(totalQty);
  }

  function renderSavedTireOptions() {
    if (!els.tireOptions) return;

    if (!state.savedTires.length) {
      els.tireOptions.innerHTML = '<p>No saved tires found. Add tires to your tire cart, then return here to book installation.</p>';
      return;
    }

    els.tireOptions.innerHTML = state.savedTires.map((item) => {
      const id = String(item.inventoryId);
      const checked = state.selectedTireIds.has(id) ? ' checked' : '';
      return `
        <label class="appointment-tire-option">
          <input type="checkbox" data-appointment-tire-id="${escapeHtml(id)}"${checked} />
          <span>
            <strong>${escapeHtml(formatSavedTireLabel(item))}</strong>
            <small>${escapeHtml(item.season || 'Used tire')} · ${escapeHtml(window.EastCordAccount?.money?.(item.unitPrice) || '')}</small>
          </span>
        </label>
      `;
    }).join('');
  }

  function updateCartLinkSummaries() {
    const appointmentCount = getCartAppointmentItems().length;
    const tireCount = state.savedTires.reduce((total, item) => total + (Number(item.qty) || 0), 0);
    if (els.appointmentCartSummary) {
      els.appointmentCartSummary.textContent = `${appointmentCount} appointment${appointmentCount === 1 ? '' : 's'} saved`;
    }
    if (els.tireCartSummary) {
      els.tireCartSummary.textContent = `${tireCount} tire${tireCount === 1 ? '' : 's'} saved`;
    }
  }

  async function hydrateCustomerTires() {
    let localTires = getLocalUsedTireCart();
    try {
      if (window.EastCordAccount?.loadCustomerCart) {
        const [usedTires, appointmentCart] = await Promise.all([
          window.EastCordAccount.loadCustomerCart('used_tire', localTires),
          window.EastCordAccount.loadCustomerCart('appointment', window.EastCordAccount.getCart?.() || []),
        ]);
        localTires = usedTires;
        localStorage.setItem('eastcord_cart_v1', JSON.stringify(appointmentCart));
      }
    } catch (error) {
      logDeveloperError('Saved tire cart could not be loaded for appointment booking.', error);
    }

    state.savedTires = localTires.filter((item) => !item.unavailable);
    syncSelectedTiresWithSavedCart();
    renderSavedTireOptions();
    updateCartLinkSummaries();
    updateReviewSummary(state.currentService || getCurrentService());
  }

  function syncSelectedTiresWithSavedCart() {
    const validIds = new Set(state.savedTires.map((item) => String(item.inventoryId)));
    state.selectedTireIds = new Set([...state.selectedTireIds].filter((id) => validIds.has(id)));
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

  function getCleanVehicleDetails() {
    const year = getFieldValue('Vehicle Year');
    const make = titleCase(getFieldValue('Vehicle Make'));
    const model = titleCase(getFieldValue('Vehicle Model'));
    const vehicle = [year, make, model].filter(Boolean).join(' ');
    const tireCount = getFieldValue('Number of Tires');

    return {
      vehicle: vehicle || 'Vehicle details',
      plate: formatPlate(getFieldValue('Vehicle Plate Number')),
      colour: titleCase(getFieldValue('Vehicle Colour')),
      tireSize: formatTireSize(getFieldValue('Tire Size')),
      tireCount,
    };
  }

  function buildDetailsHtml(rows) {
    return rows
      .filter(([, value]) => value)
      .map(([label, value]) => `<span>${label}: ${escapeHtml(value)}</span>`)
      .join('<br>');
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
    const vehicleDetails = getCleanVehicleDetails();
    const hasVehicleDetails = [vehicleDetails.vehicle, vehicleDetails.plate, vehicleDetails.colour, vehicleDetails.tireSize, vehicleDetails.tireCount]
      .some((value) => value && value !== 'Vehicle details');
    const address = getFieldValue('Full Service Address');
    const city = getFieldValue('City');
    const postalCode = getFieldValue('Postal Code');
    const date = getFieldValue('Preferred Date');
    const time = getFieldValue('Preferred Time Window');

    if (els.reviewService) {
      els.reviewService.innerHTML = serviceName === 'Not selected yet'
        ? 'Not selected yet'
        : buildDetailsHtml([['Service', serviceName]]);
    }
    if (els.reviewVehicle) {
      els.reviewVehicle.innerHTML = hasVehicleDetails
        ? buildDetailsHtml([
          ['Vehicle', vehicleDetails.vehicle],
          ['Plate Number', vehicleDetails.plate],
          ['Colour', vehicleDetails.colour],
          ['Tire Size', vehicleDetails.tireSize],
          ['Tires', vehicleDetails.tireCount],
        ])
        : 'Not entered yet';
    }
    if (els.reviewLocation) {
      els.reviewLocation.innerHTML = address || city || postalCode
        ? buildDetailsHtml([
          ['Address', address],
          ['City/Postal', [city, postalCode].filter(Boolean).join(', ')],
        ])
        : 'Not entered yet';
    }
    if (els.reviewDate) {
      els.reviewDate.innerHTML = date || time
        ? buildDetailsHtml([
          ['Date', date],
          ['Time', time],
        ])
        : 'Not entered yet';
    }
    if (els.reviewTires) {
      els.reviewTires.textContent = getSelectedTiresSummary();
    }
    if (els.reviewPrice && service) {
      els.reviewPrice.innerHTML = buildDetailsHtml([
        ['Service Subtotal', money.format(service.serviceSubtotal)],
        ['HST 13%', money.format(service.hstAmount)],
        ['Total Including HST', money.format(service.totalWithHst)],
        ['Due Today', money.format(service.deposit)],
        ['Remaining On-Site', money.format(service.remaining)],
      ]);
    }
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
        if (!['form-name', 'Booking Status', 'Service area status', 'Service Name', 'Starting Price', 'Service Subtotal', 'HST Amount', 'Total With HST', 'Tax Rate', 'Booking Deposit', 'Remaining Balance'].includes(key)) {
          fields[key] = String(value || '');
        }
      });
    }

    return {
      serviceId: service?.id || 'seasonal-changeover-rims',
      fields,
      currentStep: state.currentStep,
      selectedTireIds: [...state.selectedTireIds],
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

    state.selectedTireIds = new Set((draft.selectedTireIds || []).map(String));
    syncSelectedTiresWithSavedCart();
    renderSavedTireOptions();

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

    const selectedTires = getSelectedTires();
    const linkedTireNotes = selectedTires.length
      ? `Linked tire cart items: ${selectedTires.map((item) => `${item.brand || 'Tire'} ${item.size || ''} x${item.qty || 1} (ID ${item.inventoryId})`).join('; ')}`
      : '';
    const additionalNotes = [getFieldValue('Additional Notes'), linkedTireNotes].filter(Boolean).join('\n');

    return {
      id: `appointment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'appointment',
      customerId: profile.customerId,
      customerName: profile.name,
      customerEmail: profile.email,
      customerPhone: profile.phone,
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      startingPrice: selectedService.serviceSubtotal,
      serviceSubtotal: selectedService.serviceSubtotal,
      hstAmount: selectedService.hstAmount,
      totalWithHst: selectedService.totalWithHst,
      taxRate: selectedService.taxRate,
      depositAmount: selectedService.deposit,
      remainingBalance: selectedService.remaining,
      preferredDate: getFieldValue('Preferred Date'),
      preferredTimeWindow: getFieldValue('Preferred Time Window'),
      vehicleYear: getFieldValue('Vehicle Year'),
      vehicleMake: titleCase(getFieldValue('Vehicle Make')),
      vehicleModel: titleCase(getFieldValue('Vehicle Model')),
      vehiclePlateNumber: formatPlate(getFieldValue('Vehicle Plate Number')),
      vehicleColour: titleCase(getFieldValue('Vehicle Colour')),
      tireSize: formatTireSize(getFieldValue('Tire Size')),
      tiresAlreadyOnRims: getFieldValue('Tires Already On Rims'),
      numberOfTires: getFieldValue('Number of Tires'),
      fullServiceAddress: getFieldValue('Full Service Address'),
      city: getFieldValue('City'),
      postalCode: getFieldValue('Postal Code'),
      parkingAccessNotes: getFieldValue('Parking Driveway Access Notes'),
      additionalNotes,
      linkedTires: selectedTires,
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
      await window.EastCordAccount.saveCustomerCart('appointment', cart);
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

  async function initializeAppointmentPage() {
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
    els.tireOptions?.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-appointment-tire-id]');
      if (!checkbox) return;
      const tireId = String(checkbox.dataset.appointmentTireId);
      if (checkbox.checked) state.selectedTireIds.add(tireId);
      else state.selectedTireIds.delete(tireId);
      applySelectedTiresToForm();
      updateReviewSummary(state.currentService || getCurrentService());
    });
    els.appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

    window.updateEastCordServicePrice = () => updateServicePricing(getCurrentService());
    window.getCurrentEastCordService = getCurrentService;

    hideLoginRequiredBlock();
    updateAuthActionLinks();
    setMinimumDate();
    await hydrateCustomerTires();
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
