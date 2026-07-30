(() => {
  function renderAccountScopedCart() {
    if (window.EastCordCartIsolation?.renderCartPage) {
      window.EastCordCartIsolation.renderCartPage();
    }
  }

  window.addEventListener('DOMContentLoaded', renderAccountScopedCart);
  window.addEventListener('eastcord:account-cart-rendered', () => {
    console.info('[EastCord appointment automation] Account-scoped cart render confirmed.');
  });
  window.addEventListener('eastcord:cart-updated', renderAccountScopedCart);
  window.setTimeout(renderAccountScopedCart, 250);
})();
