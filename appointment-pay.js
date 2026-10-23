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
      const guest = readGuestCustomer();
      const customer = profile
        ? {
          customerId: profile.customerId || profile.id || '',
          name: String(profile.name || '').trim(),
          email: String(profile.email || '').trim(),
          phone: String(profile.phone || '').trim(),
        }
        : guest;
      if (!customer.name || !customer.email || !customer.phone) {
        throw new Error(profile
          ? 'Your account needs a name, email, and phone before you can pay. Update them on My Account.'
          : 'Enter your name, email, and phone before payment.');
      }
      if (!profile && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
        throw new Error('Enter a valid email address.');
      }
      if (!profile && customer.phone.replace(/\D/g, '').length < 10) {
        throw new Error('Enter a phone number with at least 10 digits.');
      }

      const token = profile ? await window.EastCordAccount.getAccessToken() : '';
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

  function readGuestCustomer() {
    return {
      customerId: '',
      name: String(form?.querySelector('[data-guest-name]')?.value || '').trim(),
      email: String(form?.querySelector('[data-guest-email]')?.value || '').trim(),
      phone: String(form?.querySelector('[data-guest-phone]')?.value || '').trim(),
    };
  }

  function applyCheckoutAuth(profile) {
    currentProfile = profile || null;
    const guest = !currentProfile;
    if (authBlock) authBlock.hidden = !guest;
    if (form) form.hidden = false;
    const guestFields = form?.querySelector('[data-guest-checkout-fields]');
    if (guestFields) guestFields.hidden = !guest;
    syncStripeTestNote();
  }

  form?.addEventListener('submit', startPay);
  window.addEventListener('eastcord:auth-changed', (event) => {
    applyCheckoutAuth(event.detail?.profile || null);
  });
  hydrate();
})();
