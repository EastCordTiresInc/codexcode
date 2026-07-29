(() => {
  const ACTIVE_CART_KEY = 'eastcord_cart_v1';
  const TAX_RATE = 0.13;
  const KNOWN_CART_KEYS = [
    ACTIVE_CART_KEY,
    'cart',
    'eastcord_cart',
    'appointment_cart',
    'eastcord_appointment_cart',
    'eastcord_appointment_cart_v1',
  ];
  const KNOWN_DRAFT_KEYS = [
    'eastcord_pending_appointment_v1',
    'eastcord_auth_redirect',
    'pendingAppointment',
    'pending_appointment',
    'appointmentDraft',
    'savedAppointment',
    'eastcord_appointment_draft',
    'eastcord_saved_appointment',
  ];
  const SERVICE_SUBTOTALS = {
    'seasonal-changeover-rims': 40,
    'seasonal-swap-not-mounted': 80,
    'mount-balance-1': 25,
    'mount-balance-2': 50,
    'mount-balance-3': 75,
    'mount-balance-4': 100,
  };
  const SERVICE_NAMES = {
    'seasonal-changeover-rims': 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims',
    'seasonal-swap-not-mounted': 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims',
    'mount-balance-1': 'Mount & Balance - 1 Tire',
    'mount-balance-2': 'Mount & Balance - 2 Tires',
    'mount-balance-3': 'Mount & Balance - 3 Tires',
    'mount-balance-4': 'Mount & Balance - 4 Tires',
  };

  function money(value) {
    if (window.EastCordAccount?.money) return window.EastCordAccount.money(value);
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
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

  function getFirstValue(item, names, fallback = '') {
    for (const name of names) {
      if (item?.[name] !== undefined && item?.[name] !== null && item?.[name] !== '') return item[name];
    }
    return fallback;
  }

  function calculateTaxBreakdown(subtotal) {
    const serviceSubtotal = roundMoney(subtotal);
    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const depositAmount = roundMoney(totalWithHst * 0.20);
    const remainingBalance = roundMoney(totalWithHst - depositAmount);
    return { serviceSubtotal, hstAmount, totalWithHst, depositAmount, remainingBalance, taxRate: TAX_RATE };
  }

  function isCartRelatedKey(key) {
    return KNOWN_CART_KEYS.includes(key)
      || KNOWN_DRAFT_KEYS.includes(key)
      || /cart/i.test(key)
      || /appointment/i.test(key)
      || /pendingAppointment/i.test(key)
      || /appointmentDraft/i.test(key)
      || /savedAppointment/i.test(key);
  }

  function getStorageKeys(storage) {
    const keys = [];
    for (let index = 0; storage && index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function safeJsonParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.info('[EastCord appointment automation] Stored cart value could not be read.', { message: error.message });
      return null;
    }
  }

  function unwrapCartItem(item) {
    if (!item || typeof item !== 'object') return item;
    if (item.item && typeof item.item === 'object') return item.item;
    if (item.appointment && typeof item.appointment === 'object') return item.appointment;
    if (item.booking && typeof item.booking === 'object') return item.booking;
    return item;
  }

  function normalizeAppointmentItem(item, index = 0) {
    const source = unwrapCartItem(item);
    if (!source || typeof source !== 'object') return null;

    const serviceId = getFirstValue(source, ['serviceId', 'service_id']);
    const serviceName = getFirstValue(source, ['serviceName', 'service_name'], SERVICE_NAMES[serviceId] || 'Appointment service');
    const subtotalValue = getFirstValue(source, ['serviceSubtotal', 'service_subtotal', 'startingPrice', 'starting_price', 'price'], SERVICE_SUBTOTALS[serviceId] || 0);
    const serviceSubtotal = roundMoney(subtotalValue);
    const appointmentLike = source.type === 'appointment'
      || Boolean(serviceId)
      || Boolean(serviceName && serviceName !== 'Appointment service')
      || Boolean(getFirstValue(source, ['bookingId', 'booking_id']))
      || Boolean(getFirstValue(source, ['preferredDate', 'preferred_date']))
      || Boolean(getFirstValue(source, ['vehicleYear', 'vehicle_year', 'vehicleMake', 'vehicle_make', 'vehicleModel', 'vehicle_model']));

    if (!appointmentLike || !serviceSubtotal) return null;

    const calculated = calculateTaxBreakdown(serviceSubtotal);
    return {
      ...source,
      id: getFirstValue(source, ['id', 'cartId', 'cart_id'], `appointment-recovered-${Date.now()}-${index}`),
      type: 'appointment',
      customerId: getFirstValue(source, ['customerId', 'customer_id']),
      customerName: getFirstValue(source, ['customerName', 'customer_name']),
      customerEmail: getFirstValue(source, ['customerEmail', 'customer_email']),
      customerPhone: getFirstValue(source, ['customerPhone', 'customer_phone']),
      serviceId,
      serviceName,
      startingPrice: calculated.serviceSubtotal,
      serviceSubtotal: calculated.serviceSubtotal,
      hstAmount: calculated.hstAmount,
      totalWithHst: calculated.totalWithHst,
      taxRate: calculated.taxRate,
      depositAmount: calculated.depositAmount,
      remainingBalance: calculated.remainingBalance,
      preferredDate: getFirstValue(source, ['preferredDate', 'preferred_date']),
      preferredTimeWindow: getFirstValue(source, ['preferredTimeWindow', 'preferred_time_window']),
      vehicleYear: getFirstValue(source, ['vehicleYear', 'vehicle_year']),
      vehicleMake: titleCase(getFirstValue(source, ['vehicleMake', 'vehicle_make'])),
      vehicleModel: titleCase(getFirstValue(source, ['vehicleModel', 'vehicle_model'])),
      vehiclePlateNumber: formatPlate(getFirstValue(source, ['vehiclePlateNumber', 'vehicle_plate_number'])),
      vehicleColour: titleCase(getFirstValue(source, ['vehicleColour', 'vehicle_colour'])),
      tireSize: formatTireSize(getFirstValue(source, ['tireSize', 'tire_size'])),
      tiresAlreadyOnRims: getFirstValue(source, ['tiresAlreadyOnRims', 'tires_already_on_rims']),
      numberOfTires: getFirstValue(source, ['numberOfTires', 'number_of_tires']),
      fullServiceAddress: getFirstValue(source, ['fullServiceAddress', 'full_service_address']),
      city: getFirstValue(source, ['city']),
      postalCode: getFirstValue(source, ['postalCode', 'postal_code']),
      parkingAccessNotes: getFirstValue(source, ['parkingAccessNotes', 'parking_access_notes']),
      additionalNotes: getFirstValue(source, ['additionalNotes', 'additional_notes']),
      serviceAreaStatus: getFirstValue(source, ['serviceAreaStatus', 'service_area_status'], 'In service area'),
      bookingId: getFirstValue(source, ['bookingId', 'booking_id']),
      bookingStatus: getFirstValue(source, ['bookingStatus', 'booking_status'], 'Pending Confirmation'),
      paymentStatus: getFirstValue(source, ['paymentStatus', 'payment_status'], 'pending_checkout'),
      stripeSessionId: getFirstValue(source, ['stripeSessionId', 'stripe_session_id']),
    };
  }

  function extractItems(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.items)) return value.items;
      if (Array.isArray(value.cart)) return value.cart;
      if (Array.isArray(value.appointments)) return value.appointments;
      if (Array.isArray(value.appointmentItems)) return value.appointmentItems;
      return [value];
    }
    return [];
  }

  function readRecoverableItems() {
    const normalized = [];
    const seen = new Set();

    [localStorage, sessionStorage].forEach((storage) => {
      getStorageKeys(storage).filter(isCartRelatedKey).forEach((key) => {
        extractItems(safeJsonParse(storage.getItem(key))).forEach((item, index) => {
          const normalizedItem = normalizeAppointmentItem(item, index);
          if (!normalizedItem) return;
          const uniqueKey = normalizedItem.id || normalizedItem.bookingId || `${normalizedItem.serviceId}-${normalizedItem.preferredDate}-${normalizedItem.preferredTimeWindow}-${index}`;
          if (seen.has(uniqueKey)) return;
          seen.add(uniqueKey);
          normalized.push(normalizedItem);
        });
      });
    });

    return normalized;
  }

  function calculateTotals(items) {
    return items.reduce((sum, item) => ({
      subtotal: roundMoney(sum.subtotal + Number(item.serviceSubtotal || 0)),
      hst: roundMoney(sum.hst + Number(item.hstAmount || 0)),
      total: roundMoney(sum.total + Number(item.totalWithHst || 0)),
      deposit: roundMoney(sum.deposit + Number(item.depositAmount || 0)),
      remaining: roundMoney(sum.remaining + Number(item.remainingBalance || 0)),
    }), { subtotal: 0, hst: 0, total: 0, deposit: 0, remaining: 0 });
  }

  function detailLine(label, value) {
    if (!value) return '';
    return `<p>${escapeHtml(label)}: ${escapeHtml(value)}</p>`;
  }

  function renderAppointmentItem(item, index) {
    const vehicle = [item.vehicleYear, item.vehicleMake, item.vehicleModel].filter(Boolean).join(' ') || 'Vehicle details submitted';
    const cityPostal = [item.city, item.postalCode].filter(Boolean).join(', ');
    return `
      <article class="cart-line">
        <span>Vehicle ${index + 1} appointment</span>
        <strong>${escapeHtml(item.serviceName || 'Appointment service')}</strong>
        ${detailLine('Vehicle', vehicle)}
        ${detailLine('Plate Number', item.vehiclePlateNumber || 'Not provided')}
        ${detailLine('Colour', item.vehicleColour || 'Not provided')}
        ${detailLine('Tire Size', item.tireSize || 'Not provided')}
        ${detailLine('Tires', item.numberOfTires || 'Not provided')}
        ${detailLine('Address', item.fullServiceAddress)}
        ${detailLine('City/Postal', cityPostal)}
        ${detailLine('Date', item.preferredDate)}
        ${detailLine('Time', item.preferredTimeWindow)}
        ${detailLine('Service Subtotal', money(item.serviceSubtotal))}
        ${detailLine('HST 13%', money(item.hstAmount))}
        ${detailLine('Total Including HST', money(item.totalWithHst))}
        ${detailLine('Deposit Due Today', money(item.depositAmount))}
        ${detailLine('Remaining On-Site', money(item.remainingBalance))}
        <p>Your appointment will be confirmed automatically after successful deposit payment.</p>
        <div class="account-actions cart-line-actions">
          <button class="button button-secondary" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-index="${index}">Remove this appointment</button>
        </div>
      </article>
    `;
  }

  function updateVisibleTotals(items, totals) {
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.textContent = value;
    };
    setText('[data-cart-subtotal]', money(totals.subtotal));
    setText('[data-cart-hst]', money(totals.hst));
    setText('[data-cart-total]', money(totals.total));
    setText('[data-cart-deposit]', money(totals.deposit));
    setText('[data-cart-balance]', `${money(totals.remaining)} due on-site after service`);
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
      element.textContent = items.length ? ` (${items.length})` : '';
    });
  }

  function recoverCartRenderIfNeeded() {
    const cartContainer = document.querySelector('[data-cart-items]');
    const visibleCartItems = cartContainer ? cartContainer.querySelectorAll('.cart-line').length : 0;
    const items = readRecoverableItems();

    if (items.length) {
      localStorage.setItem(ACTIVE_CART_KEY, JSON.stringify(items));
    }

    if (cartContainer && items.length && visibleCartItems === 0) {
      cartContainer.innerHTML = items.map(renderAppointmentItem).join('');
      updateVisibleTotals(items, calculateTotals(items));
      const message = document.querySelector('[data-cart-message]');
      if (message && /could not be loaded|Add an appointment service before checkout/i.test(message.textContent || '')) {
        message.textContent = '';
      }
    } else if (!items.length && cartContainer && !visibleCartItems) {
      updateVisibleTotals([], { subtotal: 0, hst: 0, total: 0, deposit: 0, remaining: 0 });
    }
  }

  document.addEventListener('click', (event) => {
    const clearButton = event.target.closest('[data-clear-cart]');
    if (!clearButton) return;
    event.preventDefault();
    event.stopPropagation();
    [...new Set([...KNOWN_CART_KEYS, ...KNOWN_DRAFT_KEYS, ...getStorageKeys(localStorage).filter(isCartRelatedKey), ...getStorageKeys(sessionStorage).filter(isCartRelatedKey)])]
      .forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
    localStorage.setItem(ACTIVE_CART_KEY, '[]');
    document.querySelector('[data-cart-items]')?.replaceChildren();
    document.querySelector('[data-cart-items]')?.insertAdjacentHTML('beforeend', '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>');
    updateVisibleTotals([], { subtotal: 0, hst: 0, total: 0, deposit: 0, remaining: 0 });
    const message = document.querySelector('[data-cart-message]');
    if (message) {
      message.textContent = 'Cart cleared.';
      message.dataset.messageType = 'success';
    }
  }, true);

  window.addEventListener('DOMContentLoaded', recoverCartRenderIfNeeded);
  window.setTimeout(recoverCartRenderIfNeeded, 200);
})();
