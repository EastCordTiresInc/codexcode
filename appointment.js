(() => {
  const serviceAreaCities = new Set(['Milton', 'Oakville', 'Brampton', 'Mississauga']);
  const PENDING_APPOINTMENT_KEY = 'eastcord_pending_appointment_v1';
  const APPOINTMENT_RESTORE_PATH = '/appointment.html';
  const MIN_ADVANCE_MINUTES = 120;
  const NEW_TIRE_SHIPPING_DAYS = 4;
  const SERVICE_START_MINUTES = 8 * 60;
  const SERVICE_END_MINUTES = 20 * 60;
  const TAX_RATE = 0.13;
  const MIN_ADVANCE_MESSAGE = 'Appointments must be booked at least 2 hours in advance to allow technician scheduling and travel time.';
  const SHIPPING_HOLD_MESSAGE = 'New tire installation cannot be booked for the next 4 days after your tire purchase. Please choose a later date. Hours are 8:00 AM to 8:00 PM.';
  const SERVICE_HOURS_MESSAGE = 'Installation hours are 8:00 AM to 8:00 PM. Please choose a time in that window.';
  const SHOP_LOCATION = {
    address: 'EastCord Tires shop',
    city: 'EastCord shop',
    postalCode: '',
    parking: 'Customer will bring the vehicle to the EastCord shop.',
  };
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
    requiredNewTireOrderId: '',
    requiredNewTireOrder: null,
    fromNewTires: false,
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
    els.installLocationField = document.querySelector('[data-install-location]');
    els.installLocationOptions = document.querySelector('[data-install-location-options]');
    els.mobileLocationFields = document.querySelector('[data-mobile-location-fields]');
    els.serviceAreaStatusField = document.querySelector('[data-service-area-status]');
    els.serviceAreaWarning = document.querySelector('[data-service-area-warning]');
    els.startingPrice = document.querySelector('[data-starting-price]');
    els.hstPrice = document.querySelector('[data-hst-price]');
    els.totalPrice = document.querySelector('[data-total-price]');
    els.depositPrice = document.querySelector('[data-deposit-price]');
    els.balancePrice = document.querySelector('[data-balance-price]');
    els.serviceSelect = document.getElementById('service-select');
    els.serviceOptions = document.querySelector('[data-service-options]');
    els.rimsField = document.querySelector('[data-rims-field]');
    els.tireCountField = document.querySelector('[data-tire-count-field]');
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
    els.dateNote = document.querySelector('[data-appointment-date-note]');
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
    els.reviewTiresCard = document.querySelector('[data-review-tires-card]');
    els.reviewPrice = document.querySelector('[data-review-price]');
    els.tireSelector = document.querySelector('[data-appointment-tire-selector]');
    els.linkedTireHint = document.querySelector('[data-linked-tire-hint]');
    els.newTireOrderGate = document.querySelector('[data-new-tire-order-gate]');
    els.tireOptions = document.querySelector('[data-appointment-tire-options]');
    els.loginRequiredBlock = document.querySelector('[data-login-required-block]');
    els.menuToggle = document.querySelector('.menu-toggle');
    els.primaryNavigation = document.querySelector('#primary-navigation');
  }

  function syncServiceOptionButtons(serviceId = els.serviceSelect?.value) {
    els.serviceOptions?.querySelectorAll('[data-service-id]').forEach((button) => {
      const selected = button.dataset.serviceId === serviceId;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function setSelectedService(serviceId) {
    if (els.serviceSelect && serviceId) els.serviceSelect.value = serviceId;
    syncServiceOptionButtons(serviceId);
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

    updateTireSelectorVisibility(service);
    syncServiceVehicleDefaults(service);
    updateReviewSummary(service);
  }

  function getServiceTireCount(service = getCurrentService()) {
    return getMountBalanceTireCount(service) || 4;
  }

  function getServiceTiresOnRims(service = getCurrentService()) {
    return service?.id === 'seasonal-changeover-rims' ? 'Yes' : 'No';
  }

  function syncServiceVehicleDefaults(service = getCurrentService()) {
    if (!els.appointmentForm || !service) return;
    const rimsField = els.appointmentForm.elements.namedItem('Tires Already On Rims');
    const qtyField = els.appointmentForm.elements.namedItem('Number of Tires');
    const tireCount = getServiceTireCount(service);
    const tiresOnRims = getServiceTiresOnRims(service);

    if (rimsField) rimsField.value = tiresOnRims;
    if (qtyField) {
      qtyField.value = String(tireCount);
      qtyField.readOnly = true;
    }
    if (els.rimsField) els.rimsField.hidden = true;
  }

  function getTireLinkId(item) {
    return String(item?.linkId || item?.inventoryId || '');
  }

  function isMountBalanceService(service = getCurrentService()) {
    return String(service?.id || '').startsWith('mount-balance');
  }

  function getMountBalanceTireCount(service = getCurrentService()) {
    const match = String(service?.id || '').match(/^mount-balance-([1-4])$/);
    return match ? Number(match[1]) : 0;
  }

  function updateTireSelectorVisibility(service = getCurrentService()) {
    const hasTiresToLink = state.savedTires.length > 0;
    const canLinkTires = isMountBalanceService(service) || hasTiresToLink;
    if (els.tireSelector) els.tireSelector.hidden = !canLinkTires;
    if (els.reviewTiresCard) els.reviewTiresCard.hidden = !canLinkTires;
    updateLinkedTireHint(service);

    if (!canLinkTires && state.selectedTireIds.size) {
      state.selectedTireIds.clear();
      renderSavedTireOptions();
    } else if (isMountBalanceService(service)) {
      pruneSelectedTiresToService(service);
    }
  }

  function getSelectedTireQuantity(selectedIds = state.selectedTireIds) {
    return state.savedTires
      .filter((item) => selectedIds.has(getTireLinkId(item)))
      .reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
  }

  function updateLinkedTireHint(service = getCurrentService()) {
    if (!els.linkedTireHint) return;
    if (state.requiredNewTireOrderId) {
      els.linkedTireHint.textContent = 'These paid new tires are linked from your confirmed order. Keep them selected so this installation stays on that order.';
      return;
    }
    if (isMountBalanceService(service)) {
      const count = getServiceTireCount(service);
      els.linkedTireHint.textContent = `Link purchased tires from your profile, or tires still in your cart. Select a total of ${count} tire${count === 1 ? '' : 's'} to match this appointment.`;
      return;
    }
    els.linkedTireHint.textContent = 'Link the tires you already paid for so this appointment is connected to your purchase.';
  }

  function pruneSelectedTiresToService(service = getCurrentService()) {
    if (state.requiredNewTireOrderId && state.requiredNewTireOrder) return;
    const limit = getServiceTireCount(service);
    if (!limit || getSelectedTireQuantity() <= limit) return;

    const nextSelection = new Set();
    let runningQty = 0;
    state.savedTires.forEach((item) => {
      const linkId = getTireLinkId(item);
      if (!state.selectedTireIds.has(linkId)) return;
      const qty = Number(item.qty) || 1;
      if (runningQty + qty > limit) return;
      nextSelection.add(linkId);
      runningQty += qty;
    });
    state.selectedTireIds = nextSelection;
    renderSavedTireOptions();
  }

  function getLinkedTireMismatchMessage(service = getCurrentService()) {
    if (state.requiredNewTireOrderId && state.requiredNewTireOrder) {
      const selected = getSelectedTires().filter((item) => item.orderId === state.requiredNewTireOrderId);
      if (!selected.length) {
        return 'Select the paid tires from this confirmed new tire order before booking installation.';
      }
      return '';
    }
    if (!isMountBalanceService(service) || !state.selectedTireIds.size) return '';
    const needed = getServiceTireCount(service);
    const selectedQty = getSelectedTireQuantity();
    if (selectedQty === needed) return '';
    if (selectedQty > needed) {
      return `This appointment is for ${needed} tire${needed === 1 ? '' : 's'}. Linked cart tires currently total ${selectedQty}.`;
    }
    return `Select ${needed - selectedQty} more tire${needed - selectedQty === 1 ? '' : 's'} from your cart so the linked quantity matches this appointment.`;
  }

  function validateLinkedTireQuantity() {
    const message = getLinkedTireMismatchMessage();
    if (!message) return true;
    showAppointmentMessage(message, 'error');
    return false;
  }

  function updateFromSelectedService() {
    const service = getCurrentService();
    console.log('[EastCord appointment automation] Service changed:', service);
    syncServiceOptionButtons(service?.id);
    updateServicePricing(service);
    if (getSelectedTires().length) applySelectedTiresToForm();
    showAppointmentMessage('', 'info');
  }

  function newTireOrderIdFromUrl() {
    return String(new URLSearchParams(window.location.search).get('newTireOrder') || '').trim();
  }

  function isNewTiresInstallSource() {
    return String(new URLSearchParams(window.location.search).get('source') || '').toLowerCase() === 'new-tires'
      || Boolean(state.fromNewTires)
      || Boolean(state.requiredNewTireOrderId);
  }

  function appointmentPageUrl({ restore = false } = {}) {
    const params = new URLSearchParams();
    const orderId = state.requiredNewTireOrderId || newTireOrderIdFromUrl();
    if (isNewTiresInstallSource()) params.set('source', 'new-tires');
    if (orderId) params.set('newTireOrder', orderId);
    if (restore) params.set('restore', 'appointment');
    const query = params.toString();
    return `${APPOINTMENT_RESTORE_PATH}${query ? `?${query}` : ''}#appointment-booking`;
  }

  function getLoginRedirectUrl() {
    return `/login.html?redirect=${encodeURIComponent(appointmentPageUrl({ restore: true }))}`;
  }

  function getSignupRedirectUrl() {
    return `/signup.html?redirect=${encodeURIComponent(appointmentPageUrl({ restore: true }))}`;
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

  function isNewTireInstallationBooking() {
    if (state.requiredNewTireOrder?.id || state.requiredNewTireOrderId) return true;
    return getSelectedTires().some((item) => item.type === 'new_tire' && item.orderId);
  }

  function startOfLocalDay(value = new Date()) {
    const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function torontoYmd(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function addDaysYmd(ymd, days) {
    const [year, month, day] = String(ymd || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    return new Date(Date.UTC(year, month - 1, day + Number(days || 0))).toISOString().slice(0, 10);
  }

  function newTirePurchaseDate() {
    const fromTires = getSelectedTires().find((item) => item.type === 'new_tire' && item.paidAt);
    const raw = state.requiredNewTireOrder?.paid_at
      || state.requiredNewTireOrder?.created_at
      || fromTires?.paidAt
      || '';
    if (raw) {
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) {
        date.setHours(0, 0, 0, 0);
        return date;
      }
    }
    return startOfLocalDay();
  }

  function newTirePurchaseYmd() {
    const fromTires = getSelectedTires().find((item) => item.type === 'new_tire' && item.paidAt);
    const raw = state.requiredNewTireOrder?.paid_at
      || state.requiredNewTireOrder?.created_at
      || fromTires?.paidAt
      || '';
    return raw ? (torontoYmd(raw) || torontoYmd()) : torontoYmd();
  }

  function earliestNewTireInstallYmd() {
    return addDaysYmd(newTirePurchaseYmd(), NEW_TIRE_SHIPPING_DAYS + 1);
  }

  function earliestNewTireInstallDate() {
    return startOfLocalDay(earliestNewTireInstallYmd());
  }

  function newTireHoldCopy() {
    const purchased = formatPaidDate(state.requiredNewTireOrder?.paid_at || state.requiredNewTireOrder?.created_at);
    if (purchased) {
      return `These are new tires. Purchase date: ${purchased}. This booking is linked to that order. You cannot book installation for the next 4 days after that purchase. Hours are 8:00 AM to 8:00 PM.`;
    }
    return 'These are new tires. Installation cannot be booked for the next 4 days after your purchase date. Hours are 8:00 AM to 8:00 PM.';
  }

  function updateDateNote() {
    if (!els.dateNote) return;
    els.dateNote.textContent = isNewTireInstallationBooking()
      ? newTireHoldCopy()
      : 'Appointments must be booked at least 2 hours in advance to allow technician scheduling and travel time. Hours are 8:00 AM to 8:00 PM.';
  }

  function isWithinNewTireShippingHold(dateValue) {
    if (!isNewTireInstallationBooking() || !dateValue) return false;
    return String(dateValue) < earliestNewTireInstallYmd();
  }

  function isOutsideServiceHours(timeWindow) {
    const startMinutes = getTimeWindowStartMinutes(timeWindow);
    if (startMinutes === null) return false;
    return startMinutes < SERVICE_START_MINUTES || startMinutes >= SERVICE_END_MINUTES;
  }

  function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function setMinimumDate() {
    if (!els.preferredDate) return;
    const minDate = isNewTireInstallationBooking() ? earliestNewTireInstallDate() : startOfLocalDay();
    els.preferredDate.min = isNewTireInstallationBooking() ? earliestNewTireInstallYmd() : formatDateInputValue(minDate);
    if (els.preferredDate.value && String(els.preferredDate.value) < els.preferredDate.min) {
      els.preferredDate.value = '';
    }
    updateDateNote();
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
    return state.savedTires.filter((item) => state.selectedTireIds.has(getTireLinkId(item)));
  }

  function cleanSavedTireText(value) {
    const text = String(value || '')
      .replace(/found\s+\d+\s+tires(?:\s+for:?\s*)?/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[:\-–]+\s*/, '')
      .trim();
    if (!text) return '';
    if (/^(tires for:?|price summary|add to cart|see out|revise search|warranty)$/i.test(text)) return '';
    return text;
  }

  function cleanSavedTireSize(value) {
    const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
    const metric = compact.match(/(\d{3}\/\d{2}Z?R\d{2})/);
    if (metric) return metric[1];
    const flotation = compact.match(/(\d{2}X\d{2}(?:\.\d{1,2})?R\d{2})/);
    if (flotation) return flotation[1];
    const text = String(value || '').trim();
    if (!text || /warranty|found\s+\d+\s+tires|tires for/i.test(text)) return '';
    return text;
  }

  function formatSavedTireLabel(item) {
    const qty = Math.max(1, Number(item.qty) || 1);
    const kind = item.type === 'new_tire' ? 'New' : '';
    const brand = cleanSavedTireText(item.brand);
    const model = cleanSavedTireText(item.model);
    const size = cleanSavedTireSize(item.size);
    return `${[kind, brand, model, size].filter(Boolean).join(' ')} × ${qty}`.trim();
  }

  function formatPaidDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function getSelectedTiresSummary() {
    const selected = getSelectedTires();
    const needed = getServiceTireCount();
    if (!selected.length) {
      return isMountBalanceService()
        ? `No tires selected. This appointment is for ${needed} tire${needed === 1 ? '' : 's'}.`
        : 'No purchased tires selected.';
    }
    const selectedQty = getSelectedTireQuantity();
    if (!isMountBalanceService() || selectedQty === needed) return selected.map(formatSavedTireLabel).join(', ');
    return `${selected.map(formatSavedTireLabel).join(', ')} — ${selectedQty} of ${needed} tires selected`;
  }

  function applySelectedTiresToForm() {
    const selected = getSelectedTires();
    if (!selected.length || !els.appointmentForm) return;

    const sizes = [...new Set(selected.map((item) => cleanSavedTireSize(item.size)).filter(Boolean))];
    const sizeField = els.appointmentForm.elements.namedItem('Tire Size');
    if (sizeField && sizes.length === 1) sizeField.value = sizes[0];
  }

  function renderSavedTireOptions() {
    if (!els.tireOptions) return;

    if (!state.savedTires.length) {
      els.tireOptions.innerHTML = '<p>No purchased tires found. After you pay for used or new tires with Stripe, they are saved to your profile so you can link them here. You can also add used tires to your cart first.</p>';
      return;
    }

    els.tireOptions.innerHTML = state.savedTires.map((item) => {
      const id = getTireLinkId(item);
      const checked = state.selectedTireIds.has(id) ? ' checked' : '';
      const sourceLabel = item.type === 'new_tire'
        ? `New tires · Purchased${item.paidAt ? ` ${formatPaidDate(item.paidAt)}` : ''}`
        : item.source === 'purchased'
          ? `Purchased${item.paidAt ? ` ${formatPaidDate(item.paidAt)}` : ''}`
          : 'In tire cart';
      return `
        <label class="appointment-tire-option">
          <input type="checkbox" data-appointment-tire-id="${escapeHtml(id)}"${checked} />
          <span>
            <strong>${escapeHtml(formatSavedTireLabel(item))}</strong>
            <small>${escapeHtml(sourceLabel)}${item.unitPrice ? ` · ${escapeHtml(window.EastCordAccount?.money?.(item.unitPrice) || '')}${item.type === 'new_tire' ? '/tire' : ''}` : ''}</small>
          </span>
        </label>
      `;
    }).join('');
  }

  function applyNewTireOrderVehicle(order) {
    const vehicle = order?.vehicle && typeof order.vehicle === 'object' ? order.vehicle : {};
    const year = vehicle.year || vehicle.Year || '';
    const make = vehicle.make || vehicle.Make || '';
    const model = vehicle.model || vehicle.Model || '';
    const size = (Array.isArray(order?.items) ? order.items : [])
      .map((item) => cleanSavedTireSize(item.size))
      .find(Boolean) || '';
    const field = (name, value) => {
      const input = els.appointmentForm?.elements.namedItem(name);
      if (input && value && !String(input.value || '').trim()) input.value = value;
    };
    field('Vehicle Year', year);
    field('Vehicle Make', make);
    field('Vehicle Model', model);
    field('Tire Size', size);
  }

  function updateNewTireOrderGateMessage(message, isError = false) {
    if (!els.newTireOrderGate) return;
    els.newTireOrderGate.hidden = !message;
    els.newTireOrderGate.textContent = message || '';
    els.newTireOrderGate.classList.toggle('error', Boolean(isError));
  }

  async function applyConfirmedNewTireOrder() {
    const orderId = newTireOrderIdFromUrl();
    state.fromNewTires = isNewTiresInstallSource() || Boolean(orderId);
    state.requiredNewTireOrderId = orderId;
    state.requiredNewTireOrder = null;
    if (!orderId) {
      if (state.fromNewTires) {
        setSelectedService('mount-balance-4');
        updateFromSelectedService();
        setMinimumDate();
        updateNewTireOrderGateMessage('Finish Order on New Tires first. After that purchase is saved to your account, we send you here to book installation for those new tires.', true);
      } else {
        updateNewTireOrderGateMessage('');
      }
      return true;
    }

    const profile = await window.EastCordAccount?.getCurrentProfile?.();
    if (!profile) {
      setSelectedService('mount-balance-4');
      updateFromSelectedService();
      setMinimumDate();
      updateNewTireOrderGateMessage('Log in with the account that bought these new tires. Installation stays linked to that purchase date, and the next 4 days after purchase cannot be booked. Hours are 8:00 AM to 8:00 PM.');
      showLoginRequiredBlock();
      return true;
    }

    let orders = [];
    try {
      orders = await window.EastCordAccount.getPaidNewTireOrders();
    } catch (error) {
      logDeveloperError('Confirmed new tire order could not be loaded.', error);
    }
    const order = orders.find((row) => String(row.id) === orderId);
    if (!order) {
      setSelectedService('mount-balance-4');
      updateFromSelectedService();
      setMinimumDate();
      updateNewTireOrderGateMessage('This new tire order was not found on your account. Log in with the account that purchased the tires, then book installation from My Account.', true);
      return false;
    }

    state.requiredNewTireOrder = order;
    const linked = state.savedTires.filter((item) => item.orderId === orderId && item.type === 'new_tire');
    if (linked.length) {
      const qty = linked.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
      const serviceId = `mount-balance-${Math.min(4, Math.max(1, qty))}`;
      setSelectedService(serviceId);
      updateFromSelectedService();
      state.selectedTireIds = new Set(linked.map((item) => getTireLinkId(item)));
      applyNewTireOrderVehicle(order);
      applySelectedTiresToForm();
    } else {
      setSelectedService('mount-balance-4');
      updateFromSelectedService();
      applyNewTireOrderVehicle(order);
    }
    setMinimumDate();
    const purchased = formatPaidDate(order.paid_at || order.created_at);
    updateNewTireOrderGateMessage(
      purchased
        ? `These are new tires from your purchase on ${purchased}. This booking is linked to that order. You cannot book installation for the next 4 days after that purchase. Hours are 8:00 AM to 8:00 PM.`
        : 'These are new tires linked to your confirmed order. You cannot book installation for the next 4 days after the purchase date. Hours are 8:00 AM to 8:00 PM.',
    );
    return true;
  }

  function normalizeCartTires(items) {
    return (Array.isArray(items) ? items : [])
      .filter((item) => item && !item.unavailable && (item.inventoryId || item.inventory_id))
      .map((item) => ({
        ...item,
        source: 'cart',
        inventoryId: String(item.inventoryId || item.inventory_id).replace(/^used-tire-/i, ''),
        linkId: `cart:${String(item.inventoryId || item.inventory_id).replace(/^used-tire-/i, '')}`,
      }));
  }

  async function hydrateCustomerTires() {
    let paidTires = [];
    let cartTires = normalizeCartTires(getLocalUsedTireCart());

    try {
      if (window.EastCordAccount?.getPaidUsedTires) {
        paidTires = await window.EastCordAccount.getPaidUsedTires();
      }
    } catch (error) {
      logDeveloperError('Paid tires could not be loaded for appointment booking.', error);
    }

    try {
      if (window.EastCordAccount?.loadCustomerCart) {
        cartTires = normalizeCartTires(await window.EastCordAccount.loadCustomerCart('used_tire', cartTires));
        window.EastCordAccount.updateCartCount?.();
      }
    } catch (error) {
      logDeveloperError('Saved tire cart could not be loaded for appointment booking.', error);
    }

    const paidIds = new Set(paidTires.map((item) => String(item.inventoryId)));
    state.savedTires = [
      ...paidTires,
      ...cartTires.filter((item) => !paidIds.has(String(item.inventoryId))),
    ];
    await applyConfirmedNewTireOrder();
    setMinimumDate();
    syncSelectedTiresWithSavedCart();
    renderSavedTireOptions();
    updateTireSelectorVisibility(state.currentService || getCurrentService());
    updateReviewSummary(state.currentService || getCurrentService());
  }

  function syncSelectedTiresWithSavedCart() {
    const validIds = new Set(state.savedTires.map((item) => getTireLinkId(item)));
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
    if (isOutsideServiceHours(timeWindow)) return SERVICE_HOURS_MESSAGE;
    if (isWithinNewTireShippingHold(date)) return SHIPPING_HOLD_MESSAGE;
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
            : /next \d+ days after your tire purchase|shipping/i.test(unavailableMessage)
              ? 'Unavailable for shipping'
              : unavailableMessage.includes('8:00 AM')
                ? 'Outside 8 AM–8 PM'
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

    if (isWithinNewTireShippingHold(els.preferredDate.value)) {
      els.preferredDate.setCustomValidity(SHIPPING_HOLD_MESSAGE);
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

  function selectedInstallLocation() {
    return String(els.installLocationField?.value || getFieldValue('Install Location') || '').trim();
  }

  function isShopInstall() {
    return selectedInstallLocation() === 'shop';
  }

  function locationField(name) {
    return els.appointmentForm?.elements.namedItem(name) || null;
  }

  function setLocationFieldValue(name, value) {
    const field = locationField(name);
    if (field) field.value = value;
  }

  function applyInstallLocation(location, { clearMobile = false } = {}) {
    const next = location === 'shop' || location === 'mobile' ? location : '';
    if (els.installLocationField) els.installLocationField.value = next;
    els.installLocationOptions?.querySelectorAll('[data-install-location-option]').forEach((button) => {
      const selected = button.dataset.installLocationOption === next;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });

    const shop = next === 'shop';
    const mobile = next === 'mobile';
    if (els.mobileLocationFields) els.mobileLocationFields.hidden = !mobile;

    const address = locationField('Full Service Address');
    const city = locationField('City');
    const postal = locationField('Postal Code');
    const parking = locationField('Parking Driveway Access Notes');
    [address, city, postal, parking].forEach((field) => {
      if (!field) return;
      field.required = mobile;
      field.disabled = !mobile;
    });

    if (shop) {
      setLocationFieldValue('Full Service Address', SHOP_LOCATION.address);
      setLocationFieldValue('Postal Code', SHOP_LOCATION.postalCode);
      setLocationFieldValue('Parking Driveway Access Notes', SHOP_LOCATION.parking);
      if (els.serviceAreaStatusField) els.serviceAreaStatusField.value = 'EastCord shop';
      if (els.serviceAreaWarning) els.serviceAreaWarning.hidden = true;
      if (els.citySelect) {
        els.citySelect.value = '';
        els.citySelect.setCustomValidity('');
      }
    } else if (mobile) {
      const addressValue = getFieldValue('Full Service Address');
      if (clearMobile || addressValue === SHOP_LOCATION.address) {
        setLocationFieldValue('Full Service Address', '');
        setLocationFieldValue('City', '');
        setLocationFieldValue('Postal Code', '');
        setLocationFieldValue('Parking Driveway Access Notes', '');
      }
      validateServiceArea();
    } else if (els.serviceAreaStatusField) {
      els.serviceAreaStatusField.value = '';
    }

    updateReviewSummary(state.currentService || getCurrentService());
  }

  function validateServiceArea() {
    if (isShopInstall()) {
      if (els.serviceAreaStatusField) els.serviceAreaStatusField.value = 'EastCord shop';
      if (els.serviceAreaWarning) els.serviceAreaWarning.hidden = true;
      if (els.citySelect) els.citySelect.setCustomValidity('');
      return true;
    }
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
    const metric = compact.match(/(\d{3}\/\d{2}Z?R\d{2})/);
    if (metric) return metric[1];
    const flotation = compact.match(/(\d{2}X\d{2}(?:\.\d{1,2})?R\d{2})/);
    if (flotation) return flotation[1];
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

    if (stepIndex === 0 && !validateLinkedTireQuantity()) {
      return false;
    }

    if (stepIndex === 2 && !selectedInstallLocation()) {
      showAppointmentMessage('Please choose mobile service or the EastCord shop.');
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
    const shop = isShopInstall();
    const address = shop ? SHOP_LOCATION.address : getFieldValue('Full Service Address');
    const city = shop ? SHOP_LOCATION.city : getFieldValue('City');
    const postalCode = shop ? SHOP_LOCATION.postalCode : getFieldValue('Postal Code');
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
      els.reviewLocation.innerHTML = shop
        ? buildDetailsHtml([
          ['Location', 'EastCord Tires shop'],
          ['Type', 'Bring vehicle to the shop'],
        ])
        : address || city || postalCode
          ? buildDetailsHtml([
            ['Address', address],
            ['City/Postal', [city, postalCode].filter(Boolean).join(', ')],
            ['Type', 'Mobile service'],
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
    if (els.reviewTiresCard) els.reviewTiresCard.hidden = !isMountBalanceService(service);
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
      localStorage.setItem('eastcord_auth_redirect', appointmentPageUrl({ restore: true }));
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

    if (draft.serviceId) setSelectedService(draft.serviceId);

    applyInstallLocation(String(draft.fields?.['Install Location'] || '').trim());

    Object.entries(draft.fields || {}).forEach(([name, value]) => {
      const field = els.appointmentForm.elements.namedItem(name);
      if (!field || field.disabled || name === 'Install Location') return;
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
      ? `Linked ${selectedTires.some((item) => item.source === 'purchased') ? 'paid' : 'cart'} tires: ${selectedTires.map((item) => `${item.brand || 'Tire'} ${item.size || ''} x${item.qty || 1} (ID ${item.inventoryId}${item.orderId ? `, order ${item.orderId}` : ''})`).join('; ')}`
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
      fullServiceAddress: isShopInstall() ? SHOP_LOCATION.address : getFieldValue('Full Service Address'),
      city: isShopInstall() ? SHOP_LOCATION.city : getFieldValue('City'),
      postalCode: isShopInstall() ? SHOP_LOCATION.postalCode : getFieldValue('Postal Code'),
      parkingAccessNotes: isShopInstall() ? SHOP_LOCATION.parking : getFieldValue('Parking Driveway Access Notes'),
      installLocation: selectedInstallLocation(),
      additionalNotes,
      linkedTires: selectedTires,
      newTireOrderId: state.requiredNewTireOrderId || selectedTires.find((item) => item.type === 'new_tire' && item.orderId)?.orderId || '',
      newTirePurchasedAt: state.requiredNewTireOrder?.paid_at || state.requiredNewTireOrder?.created_at || selectedTires.find((item) => item.type === 'new_tire' && item.paidAt)?.paidAt || '',
      awaitingNewTireOrder: false,
      source: isNewTiresInstallSource() ? 'new-tires' : '',
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

    if (!validateLinkedTireQuantity()) {
      showStep(0);
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

    if (state.fromNewTires && !state.requiredNewTireOrder?.id) {
      showAppointmentMessage('Finish Order on New Tires first. After that purchase is saved, we will send you here to book installation for those new tires.');
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
      const storedCart = window.EastCordAccount.getCart();
      if (!storedCart.length) {
        throw new Error('Your appointment could not be added to the cart. Please try again.');
      }
      await window.EastCordAccount.saveCustomerCart('appointment', storedCart);
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
    els.serviceOptions?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-service-id]');
      if (!button || !els.serviceSelect) return;
      const serviceId = button.dataset.serviceId;
      if (!serviceId || els.serviceSelect.value === serviceId) {
        syncServiceOptionButtons(els.serviceSelect.value);
        return;
      }
      els.serviceSelect.value = serviceId;
      els.serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
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
      if (event.target?.matches?.('#service-select')) return;
      updateReviewSummary(state.currentService || getCurrentService());
    });
    els.citySelect?.addEventListener('change', validateServiceArea);
    els.installLocationOptions?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-install-location-option]');
      if (!button) return;
      applyInstallLocation(button.dataset.installLocationOption, { clearMobile: true });
    });
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
      if (checkbox.checked) {
        const nextSelection = new Set(state.selectedTireIds);
        nextSelection.add(tireId);
        const needed = getServiceTireCount();
        const nextQty = getSelectedTireQuantity(nextSelection);
        if (isMountBalanceService() && needed && nextQty > needed) {
          checkbox.checked = false;
          showAppointmentMessage(`This appointment is for ${needed} tire${needed === 1 ? '' : 's'}. Linked tires must match that number.`, 'error');
          return;
        }
        state.selectedTireIds.add(tireId);
      } else {
        state.selectedTireIds.delete(tireId);
      }
      applySelectedTiresToForm();
      updateReviewSummary(state.currentService || getCurrentService());
      const mismatch = getLinkedTireMismatchMessage();
      showAppointmentMessage(mismatch, mismatch ? 'error' : 'success');
    });
    els.appointmentForm?.addEventListener('submit', handleAppointmentSubmit);

    window.updateEastCordServicePrice = () => updateServicePricing(getCurrentService());
    window.getCurrentEastCordService = getCurrentService;

    hideLoginRequiredBlock();
    updateAuthActionLinks();
    applyInstallLocation('');
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
