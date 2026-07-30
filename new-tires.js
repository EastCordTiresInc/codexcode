(() => {
  const fallbackMessage = 'New tire shopping is temporarily unavailable. Please contact EastCord Tires for assistance.';

  function showFallback(message = fallbackMessage) {
    const messageElement = document.querySelector('[data-tireconnect-message]');
    const widgetShell = document.querySelector('[data-tireconnect-shell]');
    if (messageElement) {
      messageElement.textContent = message;
      messageElement.hidden = false;
    }
    if (widgetShell) widgetShell.classList.add('is-unavailable');
  }

  function initTireConnect() {
    const config = window.EASTCORD_TIRECONNECT_CONFIG || {};
    const apiKey = String(config.apiKey || '').trim();
    const container = document.getElementById('tireconnect');

    if (!container || !apiKey) {
      showFallback();
      return;
    }

    if (!window.TCWidget || typeof window.TCWidget.init !== 'function') {
      console.error('[EastCord TireConnect] TireConnect widget script did not load.');
      showFallback();
      return;
    }

    try {
      window.TCWidget.init({
        apikey: apiKey,
        container: 'tireconnect',
      });
    } catch (error) {
      console.error('[EastCord TireConnect] Widget initialization failed.', error);
      showFallback();
    }
  }

  window.addEventListener('DOMContentLoaded', initTireConnect);
})();
