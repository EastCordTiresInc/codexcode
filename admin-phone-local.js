(() => {
  const host = window.location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (local) return;

  const style = document.createElement('style');
  style.textContent = 'a[href="/admin/phone-appointments"]{display:none !important}';
  document.documentElement.appendChild(style);

  if (/phone-appointments/i.test(window.location.pathname)) {
    window.location.replace('/admin');
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href="/admin/phone-appointments"]').forEach((link) => link.remove());
  });
})();
