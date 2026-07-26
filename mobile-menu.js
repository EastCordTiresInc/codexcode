(() => {
  const MENU_BUTTON_CLASS = 'menu-toggle';
  const NAV_SELECTOR = '.main-nav';

  function getOrCreateNavId(nav) {
    if (nav.id) return nav.id;
    nav.id = 'primary-navigation';
    return nav.id;
  }

  function createMenuButton(navId) {
    const button = document.createElement('button');
    button.className = MENU_BUTTON_CLASS;
    button.type = 'button';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', navId);
    button.setAttribute('aria-label', 'Open menu');
    button.innerHTML = '<span></span><span></span><span></span>';
    return button;
  }

  function setMenuState(button, nav, isOpen) {
    button.setAttribute('aria-expanded', String(isOpen));
    button.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    nav.classList.toggle('open', isOpen);
    nav.classList.toggle('is-open', isOpen);
    document.body.classList.toggle('menu-open', isOpen);
  }

  function initializeMobileMenu() {
    const nav = document.querySelector(NAV_SELECTOR);
    const navShell = document.querySelector('.nav-shell');
    if (!nav || !navShell) return;

    const navId = getOrCreateNavId(nav);
    let button = navShell.querySelector(`.${MENU_BUTTON_CLASS}`);

    if (!button) {
      button = createMenuButton(navId);
      navShell.insertBefore(button, nav);
    } else {
      button.type = 'button';
      button.setAttribute('aria-controls', navId);
      button.setAttribute('aria-label', 'Open menu');
      button.setAttribute('aria-expanded', button.getAttribute('aria-expanded') || 'false');
    }

    if (button.dataset.mobileMenuReady === 'true') return;
    button.dataset.mobileMenuReady = 'true';

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = button.getAttribute('aria-expanded') === 'true';
      setMenuState(button, nav, !isOpen);
    });

    nav.querySelectorAll('a, button').forEach((item) => {
      item.addEventListener('click', () => setMenuState(button, nav, false));
    });

    document.addEventListener('click', (event) => {
      if (button.getAttribute('aria-expanded') !== 'true') return;
      if (navShell.contains(event.target)) return;
      setMenuState(button, nav, false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setMenuState(button, nav, false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMobileMenu, { once: true });
  } else {
    initializeMobileMenu();
  }
})();
