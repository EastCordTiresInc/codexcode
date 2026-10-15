(() => {
  const CART_KEY = 'eastcord_cart_v1';
  const form = document.querySelector('[data-appointment-pay-form]');
  const button = document.querySelector('[data-appointment-pay-button]');
  const messageEl = document.querySelector('[data-appointment-pay-message]');
  const authBlock = document.querySelector('[data-appointment-pay-auth]');
  let currentProfile = null;

  function setMessage(message) {
    if (messageEl) messageEl.textContent = message || '';
  }

  function readCart() {
    try {
      const accountCart = window.EastCordAccount?.getCart?.();
      if (Array.isArray(accountCart) && accountCart.length) return accountCart;
    } catch (error) {
      console.warn('[EastCord appointment pay] Account cart could not be read.', error);
    }
    try {
      const stored = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      return [];
    }
  }

  function appointmentItems() {
    return readCart().filter((item) => item && (item.serviceId || item.service_id || item.serviceName || item.type === 'appointment'));
  }

  async function startPay(event) {
    event.preventDefault();
    setMessage('Preparing secure checkout...');
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing checkout...';
    }

    try {
      const items = appointmentItems();
      if (!items.length) throw new Error('Add an appointment before paying.');

      if (!form?.querySelector('[data-agreement-checkbox]')?.checked) {
        const needsAgreement = items.some((item) => {
          const location = String(item?.installLocation || item?.install_location || '').trim();
          const city = String(item?.city || '').trim();
          return location !== 'shop' && city !== 'EastCord shop';
        });
        if (needsAgreement) {
          throw new Error('Please accept the Mobile Service Agreement before paying.');
        }
      }

      const profile = currentProfile || await window.EastCordAccount?.getCurrentProfile?.();
      if (!profile) throw new Error('Please log in before paying the appointment deposit.');

      const customer = {
        customerId: profile.customerId || profile.id || '',
        name: String(profile.name || '').trim(),
        email: String(profile.email || '').trim(),
        phone: String(profile.phone || '').trim(),
      };
      if (!customer.customerId || !customer.name || !customer.email || !customer.phone) {
        throw new Error('Your account needs a name, email, and phone before you can pay. Update them on My Account.');
      }

      const token = await window.EastCordAccount.getAccessToken();
      const payInFull = document.querySelector('[data-pay-choice]:checked')?.value === 'full';
      const response = await fetch('/.netlify/functions/pay-appointment-deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ customer, items, payInFull }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        throw new Error(data.message || 'Stripe checkout could not be started.');
      }
      window.location.href = data.url;
    } catch (error) {
      console.error('[EastCord appointment pay] Checkout failed.', error);
      setMessage(error.message || 'Stripe checkout could not be started.');
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.idleLabel || 'Pay deposit';
      }
    }
  }

  async function hydrate() {
    try {
      currentProfile = await window.EastCordAccount?.getCurrentProfile?.();
    } catch (error) {
      currentProfile = null;
    }

    applyCheckoutAuth(currentProfile);
    syncStripeTestNote();
  }

  function syncStripeTestNote() {
    const isLocalDevelopment = /^(?:localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    const formVisible = Boolean(form) && !form.hidden;
    const hasItems = Boolean(document.querySelector('.cart-line'))
      || Boolean(window.EastCordAccount?.getCart?.()?.length);
    const show = formVisible && hasItems && isLocalDevelopment && Boolean(window.EASTCORD_AUTH_CONFIG?.stripeTestMode);
    document.querySelectorAll('[data-stripe-test-note]').forEach((note) => {
      note.hidden = !show;
    });
  }

  function applyCheckoutAuth(profile) {
    currentProfile = profile || null;
    if (authBlock) authBlock.hidden = Boolean(currentProfile);
    if (form) form.hidden = !currentProfile;
    syncStripeTestNote();
  }

  form?.addEventListener('submit', startPay);
  window.addEventListener('eastcord:auth-changed', (event) => {
    applyCheckoutAuth(event.detail?.profile || null);
  });
  hydrate();
})();
