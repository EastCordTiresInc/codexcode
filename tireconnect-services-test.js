(() => {
  const UNAVAILABLE_MESSAGE = 'TireConnect services test is temporarily unavailable.';

  function showUnavailableMessage() {
    const message = document.querySelector('[data-tireconnect-services-message]');
    const shell = document.querySelector('[data-tireconnect-services-shell]');

    if (message) {
      message.textContent = UNAVAILABLE_MESSAGE;
      message.hidden = false;
    }

    if (shell) {
      shell.hidden = true;
    }
  }

  function initTireConnectServicesWidget() {
    const config = window.EASTCORD_TIRECONNECT_CONFIG || {};
    const apiKey = config.apiKey;

    if (!apiKey) {
      console.info('TireConnect services test API key is not configured.');
      showUnavailableMessage();
      return;
    }

    if (!window.TCWidget || typeof window.TCWidget.initServices !== 'function') {
      console.error('TireConnect services widget script did not load or initServices is unavailable.');
      showUnavailableMessage();
      return;
    }

    window.TCWidget.initServices({
      apikey: apiKey,
      container: 'tireconnect-services',
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTireConnectServicesWidget);
  } else {
    initTireConnectServicesWidget();
  }
})();
