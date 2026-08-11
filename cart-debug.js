(() => {
  const RENDER_DELAYS = [0, 150, 500, 1200, 2500];

  function setCheckingAccountMessage() {
    const customer = document.querySelector('[data-cart-customer]');
    const authBlock = document.querySelector('[data-checkout-auth-block]');
    if (customer && /sign up|log in/i.test(customer.textContent || '')) {
      customer.textContent = 'Checking account...';
    }
    if (authBlock) authBlock.classList.remove('is-visible');
  }

  function renderAccountScopedCart() {
    if (window.EastCordCartIsolation?.renderCartPage) {
      window.EastCordCartIsolation.renderCartPage();
    }
  }

  function scheduleAccountScopedCartRenders() {
    setCheckingAccountMessage();
    RENDER_DELAYS.forEach((delay) => window.setTimeout(renderAccountScopedCart, delay));
  }

  window.addEventListener('DOMContentLoaded', scheduleAccountScopedCartRenders);
  window.addEventListener('eastcord:cart-updated', renderAccountScopedCart);
  window.addEventListener('eastcord:cart-cleared', renderAccountScopedCart);
  window.addEventListener('storage', renderAccountScopedCart);
})();
