(() => {
  const CHECKOUT_STATE_LOG_PREFIX = '[EastCord appointment automation] checkout button state';

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

  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-agreement-checkbox]')) scheduleCheckoutStateUpdate();
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-remove-cart-item], [data-clear-cart]')) scheduleCheckoutStateUpdate();
  });

  window.addEventListener('storage', scheduleCheckoutStateUpdate);
  window.addEventListener('eastcord:cart-cleared', scheduleCheckoutStateUpdate);
  window.addEventListener('DOMContentLoaded', scheduleCheckoutStateUpdate);
  window.setInterval(updateCheckoutButtonState, 1500);
})();
