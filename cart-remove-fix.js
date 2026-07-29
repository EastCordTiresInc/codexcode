(() => {
  const ACTIVE_CART_KEY = 'eastcord_cart_v1';
  const TAX_RATE = 0.13;
  const CART_STORAGE_KEYS = [
    ACTIVE_CART_KEY,
    'cart',
    'eastcord_cart',
    'appointment_cart',
    'eastcord_appointment_cart',
    'eastcord_appointment_cart_v1',
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

  function safeJsonParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.info('[EastCord appointment automation] Stored cart value could not be read during remove.', { message: error.message });
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

  function getStorageKeys(storage) {
    const keys = [];
    for (let index = 0; storage && index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function isCartStorageKey(key) {
    return CART_STORAGE_KEYS.includes(key) || /cart/i.test(key);
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
      id: getFirstValue(source, ['id', 'cartId', 'cart_id'], `cart-item-${index}`),
      type: 'appointment',
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

  function stableCartItemKey(item) {
    const parts = [
      item.bookingId,
      item.id,
      item.serviceId,
      item.preferredDate,
      item.preferredTimeWindow,
      item.vehicleYear,
      item.vehicleMake,
      item.vehicleModel,
      item.vehiclePlateNumber,
      item.tireSize,
      item.numberOfTires,
      item.fullServiceAddress,
      item.city,
      item.postalCode,
    ];
    return parts.map((part) => String(part || '').trim().toLowerCase()).join('|');
  }

  function readCartItems() {
    const normalized = [];
    const seen = new Set();

    [localStorage, sessionStorage].forEach((storage) => {
      getStorageKeys(storage).filter(isCartStorageKey).forEach((key) => {
        extractItems(safeJsonParse(storage.getItem(key))).forEach((item, index) => {
          const normalizedItem = normalizeAppointmentItem(item, index);
          if (!normalizedItem) return;
          const uniqueKey = stableCartItemKey(normalizedItem);
          if (seen.has(uniqueKey)) return;
          seen.add(uniqueKey);
          normalized.push(normalizedItem);
        });
      });
    });

    return normalized;
  }

  function writeCartItems(items) {
    [localStorage, sessionStorage].forEach((storage) => {
      getStorageKeys(storage).filter(isCartStorageKey).forEach((key) => storage.removeItem(key));
    });
    localStorage.setItem(ACTIVE_CART_KEY, JSON.stringify(items));
    window.EastCordAccount?.saveCart?.(items);
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
          <button class="button button-secondary" type="button" data-remove-cart-item="${escapeHtml(item.id || '')}" data-remove-cart-key="${escapeHtml(stableCartItemKey(item))}" data-remove-cart-index="${index}">Remove this appointment</button>
        </div>
      </article>
    `;
  }

  function updateVisibleCart(items) {
    const totals = calculateTotals(items);
    const cartContainer = document.querySelector('[data-cart-items]');
    if (cartContainer) {
      cartContainer.innerHTML = items.length
        ? items.map(renderAppointmentItem).join('')
        : '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';
    }

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

  function showMessage(message, type = 'success') {
    const element = document.querySelector('[data-cart-message]');
    if (!element) return;
    element.textContent = message;
    element.dataset.messageType = type;
  }

  function resetAgreement() {
    const checkbox = document.querySelector('[data-agreement-checkbox]');
    if (checkbox) checkbox.checked = false;
  }

  function removeAppointmentFromCart(event) {
    const removeButton = event.target.closest('[data-remove-cart-item]');
    if (!removeButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const items = readCartItems();
    const targetIndex = Number(removeButton.dataset.removeCartIndex);
    const targetId = removeButton.dataset.removeCartItem || '';
    const targetKey = removeButton.dataset.removeCartKey || stableCartItemKey(items[targetIndex] || {});

    const nextItems = items.filter((item, index) => {
      const sameStableKey = targetKey && stableCartItemKey(item) === targetKey;
      const sameId = targetId && item.id === targetId;
      const sameIndexFallback = !targetKey && !targetId && index === targetIndex;
      return !(sameStableKey || sameId || sameIndexFallback);
    });

    if (nextItems.length === items.length) {
      showMessage('This appointment could not be found in your cart. Please refresh and try again.', 'error');
      console.info('[EastCord appointment automation] Remove appointment did not find a matching item.', {
        targetId,
        targetIndex,
        targetKey,
        cartItemCount: items.length,
      });
      return;
    }

    writeCartItems(nextItems);
    resetAgreement();
    updateVisibleCart(nextItems);
    showMessage(nextItems.length ? 'Appointment removed from cart.' : 'Cart is empty.', 'success');
    window.dispatchEvent(new CustomEvent('eastcord:cart-updated'));
    console.info('[EastCord appointment automation] Appointment removed from cart.', {
      cartItemCountBefore: items.length,
      cartItemCountAfter: nextItems.length,
    });
  }

  document.addEventListener('click', removeAppointmentFromCart, true);
})();
