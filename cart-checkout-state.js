(() => {
  const CHECKOUT_STATE_LOG_PREFIX = '[EastCord appointment automation] checkout button state';
  const ACTIVE_CART_KEY = 'eastcord_cart_v1';
  const CART_STORAGE_KEYS = [
    ACTIVE_CART_KEY,
    'cart',
    'eastcord_cart',
    'appointment_cart',
    'eastcord_appointment_cart',
    'eastcord_appointment_cart_v1',
  ];

  function parseMoney(value) {
    const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) ? amount : 0;
  }

  function getVisibleValidCartItemCount() {
    return document.querySelectorAll('[data-cart-items] .cart-line:not(.cart-line-invalid)').length;
  }

  function getDepositDueToday() {
    return parseMoney(document.querySelector('[data-cart-deposit]')?.textContent || '');
  }

  function getAgreementAccepted() {
    return Boolean(document.querySelector('[data-agreement-checkbox]')?.checked);
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
    return CART_STORAGE_KEYS.includes(key);
  }

  function clearCartStorageKeys() {
    [localStorage, sessionStorage].forEach((storage) => {
      getStorageKeys(storage).filter(isCartStorageKey).forEach((key) => storage.removeItem(key));
    });
  }

  function stableCartItemKey(item) {
    const parts = [
      item?.bookingId,
      item?.booking_id,
      item?.id,
      item?.cartId,
      item?.cart_id,
      item?.serviceId,
      item?.service_id,
      item?.preferredDate,
      item?.preferred_date,
      item?.preferredTimeWindow,
      item?.preferred_time_window,
      item?.vehicleYear,
      item?.vehicle_year,
      item?.vehicleMake,
      item?.vehicle_make,
      item?.vehicleModel,
      item?.vehicle_model,
      item?.vehiclePlateNumber,
      item?.vehicle_plate_number,
      item?.tireSize,
      item?.tire_size,
      item?.numberOfTires,
      item?.number_of_tires,
      item?.fullServiceAddress,
      item?.full_service_address,
      item?.city,
      item?.postalCode,
      item?.postal_code,
    ];
    return parts.map((part) => String(part || '').trim().toLowerCase()).join('|');
  }

  function getCurrentCartItems() {
    try {
      if (typeof window.getAppointmentItems === 'function') return window.getAppointmentItems();
      if (window.EastCordAccount?.getCart) return window.EastCordAccount.getCart();
    } catch (error) {
      console.info('[EastCord appointment automation] Cart items could not be read for remove.', { message: error.message });
    }
    return [];
  }

  function saveCartItems(items) {
    clearCartStorageKeys();
    localStorage.setItem(ACTIVE_CART_KEY, JSON.stringify(items));
    window.EastCordAccount?.saveCart?.(items);
  }

  function setCartCount(count) {
    if (window.EastCordAccount?.updateCartCount) {
      window.EastCordAccount.updateCartCount();
      return;
    }
    document.querySelectorAll('[data-appointment-cart-count], [data-cart-count]').forEach((element) => {
      element.textContent = '';
    });
  }

  function showCartMessage(message, type = 'success') {
    const messageElement = document.querySelector('[data-cart-message]');
    if (!messageElement) return;
    messageElement.textContent = message;
    messageElement.dataset.messageType = type;
  }

  function resetAgreement() {
    const checkbox = document.querySelector('[data-agreement-checkbox]');
    if (checkbox) checkbox.checked = false;
  }

  function renderAfterRemove(items) {
    if (typeof window.renderCart === 'function') {
      window.renderCart();
      return;
    }

    const cartContainer = document.querySelector('[data-cart-items]');
    if (!items.length && cartContainer) {
      cartContainer.innerHTML = '<p class="empty-cart">Your cart is empty. Add an appointment to continue.</p>';
    }
    setCartCount(items.length);
  }

  function removeAppointmentFromCart(event) {
    const removeButton = event.target.closest('[data-remove-cart-item]');
    if (!removeButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const items = getCurrentCartItems();
    const targetIndex = Number(removeButton.dataset.removeCartIndex);
    const targetId = removeButton.dataset.removeCartItem || '';
    const target = Number.isInteger(targetIndex) ? items[targetIndex] : null;
    const targetKey = removeButton.dataset.removeCartKey || stableCartItemKey(target || {});

    const nextItems = items.filter((item, index) => {
      const itemId = item?.id || item?.cartId || item?.cart_id || '';
      const sameStableKey = targetKey && stableCartItemKey(item) === targetKey;
      const sameId = targetId && itemId === targetId;
      const sameIndexFallback = !targetKey && !targetId && index === targetIndex;
      return !(sameStableKey || sameId || sameIndexFallback);
    });

    if (nextItems.length === items.length) {
      showCartMessage('This appointment could not be found in your cart. Please refresh and try again.', 'error');
      console.info('[EastCord appointment automation] Remove appointment did not find a matching item.', {
        targetId,
        targetIndex,
        targetKey,
        cartItemCount: items.length,
      });
      return;
    }

    saveCartItems(nextItems);
    resetAgreement();
    renderAfterRemove(nextItems);
    setCartCount(nextItems.length);
    showCartMessage(nextItems.length ? 'Appointment removed from cart.' : 'Cart is empty.', 'success');
    window.dispatchEvent(new CustomEvent('eastcord:cart-updated'));
    scheduleCheckoutStateUpdate();
    console.info('[EastCord appointment automation] Appointment removed from cart.', {
      cartItemCountBefore: items.length,
      cartItemCountAfter: nextItems.length,
    });
  }

  function showCheckoutReason(message, type = 'error') {
    const messageElement = document.querySelector('[data-cart-message]');
    if (!messageElement) return;

    const managedMessages = [
      'Please log in before checkout.',
      'Please accept the Mobile Service Agreement before checkout.',
      'Your cart is empty. Add an appointment to continue.',
      'Cart total could not be calculated. Please refresh or clear cart.',
    ];

    if (!message) {
      if (managedMessages.includes(messageElement.textContent.trim())) {
        messageElement.textContent = '';
        messageElement.dataset.messageType = 'info';
      }
      return;
    }

    messageElement.textContent = message;
    messageElement.dataset.messageType = type;
  }

  async function getLoggedInState() {
    try {
      const profile = await window.EastCordAccount?.getCurrentProfile?.();
      return Boolean(profile?.customerId || profile?.email || profile);
    } catch (error) {
      console.info('[EastCord appointment automation] Checkout profile check failed.', { message: error.message });
      return false;
    }
  }

  async function updateCheckoutButtonState() {
    const checkoutButton = document.querySelector('[data-checkout-button]');
    if (!checkoutButton) return;

    const validCartItems = getVisibleValidCartItemCount();
    const depositDueToday = getDepositDueToday();
    const isLoggedIn = await getLoggedInState();
    const agreementAccepted = getAgreementAccepted();
    let disabledReason = '';

    if (!validCartItems) disabledReason = 'Your cart is empty. Add an appointment to continue.';
    else if (depositDueToday <= 0) disabledReason = 'Cart total could not be calculated. Please refresh or clear cart.';
    else if (!isLoggedIn) disabledReason = 'Please log in before checkout.';
    else if (!agreementAccepted) disabledReason = 'Please accept the Mobile Service Agreement before checkout.';

    const canCheckout = !disabledReason;
    checkoutButton.disabled = !canCheckout;
    checkoutButton.toggleAttribute('disabled', !canCheckout);
    checkoutButton.setAttribute('aria-disabled', String(!canCheckout));
    showCheckoutReason(disabledReason);

    console.info(CHECKOUT_STATE_LOG_PREFIX, {
      isLoggedIn,
      agreementAccepted,
      validCartItems,
      depositDueToday,
      disabledReason: disabledReason || 'none',
      buttonDisabled: !canCheckout,
    });
  }

  function scheduleCheckoutStateUpdate() {
    window.setTimeout(updateCheckoutButtonState, 0);
    window.setTimeout(updateCheckoutButtonState, 150);
    window.setTimeout(updateCheckoutButtonState, 500);
  }

  document.addEventListener('click', removeAppointmentFromCart, true);

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-agreement-checkbox]')) scheduleCheckoutStateUpdate();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-clear-cart]')) scheduleCheckoutStateUpdate();
  });

  window.addEventListener('storage', scheduleCheckoutStateUpdate);
  window.addEventListener('eastcord:cart-cleared', scheduleCheckoutStateUpdate);
  window.addEventListener('eastcord:cart-updated', scheduleCheckoutStateUpdate);
  window.addEventListener('DOMContentLoaded', scheduleCheckoutStateUpdate);
  window.setInterval(updateCheckoutButtonState, 1500);
})();
