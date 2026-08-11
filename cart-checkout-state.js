(() => {
  const CHECKOUT_FUNCTION_PATH = '/.netlify/functions/create-appointment-checkout-session';
  const CHECKOUT_ERROR_MESSAGE = 'Checkout could not be started. Please try again or contact EastCord Tires.';
  const AGREEMENT_MESSAGE = 'Please agree to the Mobile Service Agreement before checkout.';
  const LOGIN_MESSAGE = 'Please log in before checkout.';
  const INVALID_CART_MESSAGE = 'Your cart is empty or invalid. Please start a new appointment.';
  const CART_TOTAL_MESSAGE = 'Cart total could not be calculated. Please refresh or clear cart.';
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
  let handlerAttached = false;

  function logCheckoutStep(message, details) {
    if (details === undefined) {
      console.info(message);
      return;
    }
    console.info(message, details);
  }

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
      LOGIN_MESSAGE,
      AGREEMENT_MESSAGE,
      INVALID_CART_MESSAGE,
      CART_TOTAL_MESSAGE,
      CHECKOUT_ERROR_MESSAGE,
      'Saving booking details and preparing secure checkout...',
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

  async function getAuthState() {
    let token = '';
    let profile = null;

    try {
      token = await window.EastCordAccount?.getAccessToken?.() || '';
    } catch (error) {
      console.info('[EastCord appointment automation] Checkout auth token check failed.', { message: error.message });
    }

    try {
      profile = await window.EastCordAccount?.getCurrentProfile?.() || null;
    } catch (error) {
      console.info('[EastCord appointment automation] Checkout profile check failed.', { message: error.message });
    }

    return {
      token,
      profile,
      authSessionLoaded: Boolean(token),
      customerProfileLoaded: Boolean(profile?.customerId || profile?.email),
    };
  }

  async function getCheckoutState() {
    const rawItems = getCurrentCartItems();
    const validCartItems = rawItems.filter((item) => !item?.isInvalidCartItem && Number(item?.depositAmount || 0) > 0);
    const visibleValidCartItems = getVisibleValidCartItemCount();
    const depositDueToday = getDepositDueToday(validCartItems);
    const agreementAccepted = getAgreementAccepted();
    const authState = await getAuthState();
    let disabledReason = '';

    logCheckoutStep(`Agreement checked: ${agreementAccepted}`);
    logCheckoutStep(`Auth session loaded: ${authState.authSessionLoaded}`);
    logCheckoutStep(`Customer profile loaded: ${authState.customerProfileLoaded}`);
    logCheckoutStep(`Validated cart items count: ${validCartItems.length}`);
    logCheckoutStep(`Deposit amount: ${depositDueToday}`);

    if (!agreementAccepted) disabledReason = AGREEMENT_MESSAGE;
    else if (!authState.authSessionLoaded || !authState.customerProfileLoaded) disabledReason = LOGIN_MESSAGE;
    else if (!validCartItems.length || !visibleValidCartItems) disabledReason = INVALID_CART_MESSAGE;
    else if (depositDueToday <= 0) disabledReason = CART_TOTAL_MESSAGE;

    return {
      rawItems,
      validCartItems,
      profile: authState.profile,
      token: authState.token,
      authSessionLoaded: authState.authSessionLoaded,
      customerProfileLoaded: authState.customerProfileLoaded,
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

    checkoutButton.style.pointerEvents = 'auto';

    if (checkoutInProgress) {
      checkoutButton.disabled = true;
      checkoutButton.setAttribute('aria-disabled', 'true');
      checkoutButton.dataset.checkoutBlockedReason = '';
      return;
    }

    checkoutButton.disabled = false;
    checkoutButton.removeAttribute('disabled');
    checkoutButton.setAttribute('aria-disabled', 'false');
    checkoutButton.dataset.checkoutBlockedReason = state.disabledReason || '';

    if (state.canCheckout) {
      showCheckoutReason('');
    }

    console.info('[EastCord appointment automation] checkout button state', {
      isLoggedIn: state.authSessionLoaded && state.customerProfileLoaded,
      authSessionLoaded: state.authSessionLoaded,
      customerProfileLoaded: state.customerProfileLoaded,
      agreementAccepted: state.agreementAccepted,
      validCartItems: state.validCartItems.length,
      visibleValidCartItems: state.visibleValidCartItems,
      depositDueToday: state.depositDueToday,
      disabledReason: state.disabledReason || 'none',
      buttonPhysicallyDisabled: checkoutButton.disabled,
      clickHandlerAttached: handlerAttached,
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
    window.setTimeout(updateCheckoutButtonState, 1200);
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

  function resetCheckoutButtonAfterFailure() {
    const checkoutButton = document.querySelector('[data-checkout-button]');
    if (checkoutButton) {
      checkoutButton.textContent = 'Secure Checkout';
      checkoutButton.disabled = false;
      checkoutButton.removeAttribute('disabled');
      checkoutButton.setAttribute('aria-disabled', 'false');
      checkoutButton.style.pointerEvents = 'auto';
    }
    checkoutInProgress = false;
    scheduleCheckoutStateUpdate();
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
          resetCheckoutButtonAfterFailure();
          return;
        }
      }

      if (typeof window.ensureAllSupabaseBookings !== 'function') {
        throw new Error('Checkout booking save function is unavailable.');
      }

      const bookingItems = await window.ensureAllSupabaseBookings(state.validCartItems, state.profile);
      await submitNetlifyBackups(bookingItems, state.profile);

      const token = state.token || await window.EastCordAccount?.getAccessToken?.() || '';
      logCheckoutStep(`Calling checkout function: ${CHECKOUT_FUNCTION_PATH}`);
      const response = await fetch(CHECKOUT_FUNCTION_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ items: bookingItems, customer: state.profile }),
      });
      logCheckoutStep(`Checkout function response status: ${response.status}`);

      const data = await response.json().catch(() => ({}));
      logCheckoutStep(`Checkout URL received: ${Boolean(data.url)}`);

      if (!response.ok || !data.url) {
        console.error('[EastCord appointment automation] Checkout function returned an error.', {
          status: response.status,
          response: data,
        });
        throw new Error(CHECKOUT_ERROR_MESSAGE);
      }

      logCheckoutStep('Redirecting to Stripe Checkout');
      window.location.href = data.url;
    } catch (error) {
      console.error('[EastCord appointment automation] Checkout could not be started.', error);
      showCheckoutReason(CHECKOUT_ERROR_MESSAGE, 'error');
      resetCheckoutButtonAfterFailure();
    }
  }

  async function handleCheckoutClick(event) {
    const checkoutButton = event.target.closest?.('[data-checkout-button]');
    if (!checkoutButton) return;

    logCheckoutStep('Checkout clicked');
    event.preventDefault();
    event.stopImmediatePropagation();

    const state = await updateCheckoutButtonState();
    if (!state.canCheckout) {
      showCheckoutReason(state.disabledReason || CHECKOUT_ERROR_MESSAGE, 'error');
      return;
    }

    await startSecureCheckout(state);
  }

  function attachCheckoutHandler() {
    const checkoutButton = document.querySelector('[data-checkout-button]');
    if (!checkoutButton) {
      console.info('[EastCord appointment automation] Checkout button not found during handler attach.');
      return;
    }

    checkoutButton.disabled = false;
    checkoutButton.removeAttribute('disabled');
    checkoutButton.setAttribute('aria-disabled', 'false');
    checkoutButton.style.pointerEvents = 'auto';
    handlerAttached = true;
    console.info('[EastCord appointment automation] Checkout click handler attached.', {
      buttonFound: true,
      insideForm: Boolean(checkoutButton.closest('form')),
      agreementSelectorFound: Boolean(document.querySelector('[data-agreement-checkbox]')),
      endpointPath: CHECKOUT_FUNCTION_PATH,
    });
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
  window.addEventListener('DOMContentLoaded', () => {
    attachCheckoutHandler();
    scheduleCheckoutStateUpdate();
  });
  window.setInterval(updateCheckoutButtonState, 1500);

  if (document.readyState !== 'loading') {
    attachCheckoutHandler();
    scheduleCheckoutStateUpdate();
  }
})();
