(() => {
  const CHECKOUT_STATE_LOG_PREFIX = '[EastCord appointment automation] checkout button state';
  const CHECKOUT_ERROR_MESSAGE = 'Checkout could not be started. Please try again or contact EastCord Tires.';
  const ACTIVE_CART_KEY = 'eastcord_cart_v1';
  const CART_STORAGE_KEYS = [
    ACTIVE_CART_KEY,
    'cart',
    'eastcord_cart',
    'appointment_cart',
    'eastcord_appointment_cart',
    'eastcord_appointment_cart_v1',
  ];
  let checkoutInProgress = false;

  function parseMoney(value) {
    const amount = Number(String(value || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(amount) ? amount : 0;
  }

  function getVisibleValidCartItemCount() {
    return document.querySelectorAll('[data-cart-items] .cart-line:not(.cart-line-invalid)').length;
  }

  function getDepositDueTodayFromPage() {
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
    return CART_STORAGE_KEYS.includes(key) || /cart/i.test(key);
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
      console.info('[EastCord appointment automation] Cart items could not be read.', { message: error.message });
    }
    return [];
  }

  function getValidCartItems() {
    return getCurrentCartItems().filter((item) => !item?.isInvalidCartItem && Number(item?.depositAmount || 0) > 0);
  }

  function getDepositDueToday(items = getValidCartItems()) {
    const itemDeposit = items.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0);
    return itemDeposit > 0 ? itemDeposit : getDepositDueTodayFromPage();
  }

  function saveCartItems(items) {
    clearCartStorageKeys();
    localStorage.setItem(ACTIVE_CART_KEY, JSON.stringify(items));
    window.EastCordAccount?.saveCart?.(items);
  }

  function setCartCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach((element) => {
      element.textContent = count ? ` (${count})` : '';
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
      'Please agree to the Mobile Service Agreement before checkout.',
      'Your cart is empty. Add an appointment to continue.',
      'Cart total could not be calculated. Please refresh or clear cart.',
      CHECKOUT_ERROR_MESSAGE,
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

  async function getProfile() {
    try {
      return await window.EastCordAccount?.getCurrentProfile?.();
    } catch (error) {
      console.info('[EastCord appointment automation] Checkout profile check failed.', { message: error.message });
      return null;
    }
  }

  async function getCheckoutState() {
    const items = getCurrentCartItems();
    const validCartItems = items.filter((item) => !item?.isInvalidCartItem && Number(item?.depositAmount || 0) > 0);
    const profile = await getProfile();
    const visibleValidCartItems = getVisibleValidCartItemCount();
    const depositDueToday = getDepositDueToday(validCartItems);
    const isLoggedIn = Boolean(profile?.customerId || profile?.email);
    const agreementAccepted = getAgreementAccepted();
    let disabledReason = '';

    if (!validCartItems.length || !visibleValidCartItems) disabledReason = 'Your cart is empty. Add an appointment to continue.';
    else if (depositDueToday <= 0) disabledReason = 'Cart total could not be calculated. Please refresh or clear cart.';
    else if (!isLoggedIn) disabledReason = 'Please log in before checkout.';
    else if (!agreementAccepted) disabledReason = 'Please agree to the Mobile Service Agreement before checkout.';

    return {
      items,
      validCartItems,
      profile,
      isLoggedIn,
      agreementAccepted,
      visibleValidCartItems,
      depositDueToday,
      disabledReason,
      canCheckout: !disabledReason && !checkoutInProgress,
    };
  }

  function applyCheckoutButtonState(state) {
    const checkoutButton = document.querySelector('[data-checkout-button]');
    if (!checkoutButton) return;

    if (checkoutInProgress) {
      checkoutButton.disabled = true;
      checkoutButton.setAttribute('aria-disabled', 'true');
      checkoutButton.dataset.checkoutBlockedReason = '';
      return;
    }

    checkoutButton.disabled = false;
    checkoutButton.removeAttribute('disabled');
    checkoutButton.setAttribute('aria-disabled', String(!state.canCheckout));
    checkoutButton.dataset.checkoutBlockedReason = state.disabledReason || '';
    showCheckoutReason(state.disabledReason);

    console.info(CHECKOUT_STATE_LOG_PREFIX, {
      isLoggedIn: state.isLoggedIn,
      agreementAccepted: state.agreementAccepted,
      validCartItems: state.validCartItems.length,
      visibleValidCartItems: state.visibleValidCartItems,
      depositDueToday: state.depositDueToday,
      disabledReason: state.disabledReason || 'none',
      buttonBlocked: !state.canCheckout,
      clickHandlerAttached: true,
    });
  }

  async function updateCheckoutButtonState() {
    const state = await getCheckoutState();
    applyCheckoutButtonState(state);
    return state;
  }

  function scheduleCheckoutStateUpdate() {
    window.setTimeout(updateCheckoutButtonState, 0);
    window.setTimeout(updateCheckoutButtonState, 150);
    window.setTimeout(updateCheckoutButtonState, 500);
  }

  async function submitNetlifyBackups(bookingItems, profile) {
    if (typeof window.buildNetlifyFormData !== 'function' || typeof window.submitNetlifyFormBackup !== 'function') return;
    bookingItems.forEach((bookingItem) => {
      try {
        const formData = window.buildNetlifyFormData(bookingItem, profile);
        window.submitNetlifyFormBackup(formData).catch((error) => {
          console.error('[EastCord appointment automation] Netlify Forms backup failed after Supabase booking save.', error);
        });
      } catch (error) {
        console.error('[EastCord appointment automation] Netlify Forms backup could not be prepared.', error);
      }
    });
  }

  async function startSecureCheckout(state) {
    const checkoutButton = document.querySelector('[data-checkout-button]');
    if (!checkoutButton || checkoutInProgress) return;

    try {
      checkoutInProgress = true;
      checkoutButton.disabled = true;
      checkoutButton.setAttribute('aria-disabled', 'true');
      checkoutButton.textContent = 'Preparing secure checkout...';
      showCartMessage('Saving booking details and preparing secure checkout...', 'info');

      if (typeof window.validateCartSlots === 'function') {
        const cartSlotMessage = window.validateCartSlots(state.validCartItems);
        if (cartSlotMessage) {
          showCheckoutReason(cartSlotMessage, 'error');
          return;
        }
      }

      if (typeof window.ensureAllSupabaseBookings !== 'function') {
        throw new Error('Checkout booking save function is unavailable.');
      }

      const bookingItems = await window.ensureAllSupabaseBookings(state.validCartItems, state.profile);
      await submitNetlifyBackups(bookingItems, state.profile);

      const token = await window.EastCordAccount?.getAccessToken?.();
      const response = await fetch('/.netlify/functions/create-appointment-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ items: bookingItems, customer: state.profile }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.url) {
        console.error('[EastCord appointment automation] Checkout function returned an error.', {
          status: response.status,
          response: data,
        });
        throw new Error(CHECKOUT_ERROR_MESSAGE);
      }

      console.info('[EastCord appointment automation] Checkout URL received; redirecting customer.', {
        itemCount: bookingItems.length,
        depositDueToday: getDepositDueToday(bookingItems),
      });
      window.location.href = data.url;
    } catch (error) {
      console.error('[EastCord appointment automation] Checkout could not be started.', error);
      showCheckoutReason(error.message === CHECKOUT_ERROR_MESSAGE ? CHECKOUT_ERROR_MESSAGE : CHECKOUT_ERROR_MESSAGE, 'error');
      checkoutButton.textContent = 'Secure Checkout';
      checkoutInProgress = false;
      scheduleCheckoutStateUpdate();
    }
  }

  async function handleCheckoutClick(event) {
    const checkoutButton = event.target.closest('[data-checkout-button]');
    if (!checkoutButton) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const state = await updateCheckoutButtonState();
    if (!state.canCheckout) {
      showCheckoutReason(state.disabledReason || 'Checkout could not be started. Please try again or contact EastCord Tires.', 'error');
      return;
    }

    await startSecureCheckout(state);
  }

  document.addEventListener('click', handleCheckoutClick, true);
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
  window.addEventListener('eastcord:account-cart-rendered', scheduleCheckoutStateUpdate);
  window.addEventListener('DOMContentLoaded', scheduleCheckoutStateUpdate);
  window.setInterval(updateCheckoutButtonState, 1500);
})();
