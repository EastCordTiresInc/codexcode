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

  function fieldValue(name) {
    const field = form?.elements?.namedItem(name);
    return String(field?.value || '').trim();
  }

  function fillFields(profile) {
    if (!form || !profile) return;
    const values = {
      'Full Name': profile.name || '',
      'Email Address': profile.email || '',
      'Phone Number': profile.phone || '',
    };
    Object.entries(values).forEach(([name, value]) => {
      if (!value) return;
      const field = form.elements.namedItem(name);
      if (field && 'value' in field && !field.value) field.value = value;
    });
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
    setMessage('Opening Stripe checkout...');
    if (button) {
      button.disabled = true;
      button.textContent = 'Opening Stripe...';
    }

    try {
      const items = appointmentItems();
      if (!items.length) throw new Error('Add an appointment before paying.');

      if (!form?.querySelector('[data-agreement-checkbox]')?.checked) {
        throw new Error('Please accept the Mobile Service Agreement before paying.');
      }

      const profile = currentProfile || await window.EastCordAccount?.getCurrentProfile?.();
      if (!profile) throw new Error('Please log in before paying the appointment deposit.');

      const customer = {
        customerId: profile.customerId || profile.id || '',
        name: fieldValue('Full Name') || profile.name || '',
        email: fieldValue('Email Address') || profile.email || '',
        phone: fieldValue('Phone Number') || profile.phone || '',
      };
      if (!customer.customerId || !customer.name || !customer.email || !customer.phone) {
        throw new Error('Please complete your name, email, and phone before paying.');
      }

      const token = await window.EastCordAccount.getAccessToken();
      const response = await fetch('/.netlify/functions/pay-appointment-deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ customer, items }),
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
    const isLocalDevelopment = /^(?:localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    if (isLocalDevelopment && window.EASTCORD_AUTH_CONFIG?.stripeTestMode) {
      document.querySelectorAll('[data-stripe-test-note]').forEach((note) => {
        note.hidden = false;
      });
    }
  }

  function applyCheckoutAuth(profile) {
    currentProfile = profile || null;
    if (authBlock) authBlock.hidden = Boolean(currentProfile);
    if (form) form.hidden = !currentProfile;
    if (currentProfile) fillFields(currentProfile);
  }

  form?.addEventListener('submit', startPay);
  window.addEventListener('eastcord:auth-changed', (event) => {
    applyCheckoutAuth(event.detail?.profile || null);
  });
  hydrate();
})();
