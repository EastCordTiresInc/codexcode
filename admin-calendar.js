(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';
  const DEFAULT_WINDOWS = [
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '12:00 PM - 1:00 PM',
    '1:00 PM - 2:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM',
    '5:00 PM - 6:00 PM',
    '6:00 PM - 7:00 PM',
    '7:00 PM - 8:00 PM',
  ];

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    status: document.querySelector('[data-admin-status]'),
    calendar: document.querySelector('[data-admin-calendar]'),
    prev: document.querySelector('[data-cal-prev]'),
    today: document.querySelector('[data-cal-today]'),
    next: document.querySelector('[data-cal-next]'),
  };

  const REFRESH_MS = 15000;
  let weekStart = mondayOf(parseDateParam() || torontoToday());
  let staffEmail = ADMIN_EMAIL;
  let refreshTimer = null;
  let refreshInFlight = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function torontoToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function parseDateParam() {
    const value = new URLSearchParams(window.location.search).get('week');
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
  }

  function toDateOnly(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function mondayOf(dateString) {
    const date = toDateOnly(dateString);
    const day = date.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + offset);
    return formatDate(date);
  }

  function addDays(dateString, days) {
    const date = toDateOnly(dateString);
    date.setDate(date.getDate() + days);
    return formatDate(date);
  }

  function weekDates(start) {
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }

  function dayLabel(dateString) {
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(toDateOnly(dateString));
  }

  function shortSlot(windowLabel) {
    return String(windowLabel || '').split(' - ')[0] || windowLabel;
  }

  function isPaid(appointment) {
    return String(appointment.payment_status || '').toLowerCase().includes('paid')
      || String(appointment.booking_status || '').toLowerCase() === 'confirmed';
  }

  function showGate(message) {
    if (els.loading) els.loading.hidden = true;
    if (els.dashboard) els.dashboard.hidden = true;
    if (els.chrome) els.chrome.hidden = true;
    if (els.gate) els.gate.hidden = false;
    if (els.gateMessage && message) els.gateMessage.textContent = message;
  }

  function showDashboard(email = '') {
    if (els.loading) els.loading.hidden = true;
    if (els.gate) els.gate.hidden = true;
    if (els.dashboard) els.dashboard.hidden = false;
    if (els.chrome) els.chrome.hidden = false;
    if (els.staffEmail) els.staffEmail.textContent = email || ADMIN_EMAIL;
  }

  function setStatus(message, tone = '') {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  function syncWeekUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('week', weekStart);
    window.history.replaceState({}, '', url);
  }

  function groupAppointments(appointments) {
    const map = new Map();
    appointments.forEach((appointment) => {
      const key = `${appointment.preferred_date}__${appointment.preferred_time_window}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(appointment);
    });
    return map;
  }

  function renderCell(date, windowLabel, appointments) {
    if (!appointments.length) {
      return `
        <a class="admin-cal-cell is-open" href="/admin?date=${encodeURIComponent(date)}">
          <span class="admin-cal-open">Open</span>
        </a>
      `;
    }

    return appointments.map((appointment) => {
      const paid = isPaid(appointment);
      const name = appointment.customer_name || 'Customer';
      const service = appointment.service_name || 'Appointment';
      return `
        <a class="admin-cal-cell ${paid ? 'is-booked' : 'is-pending'}" href="/admin?date=${encodeURIComponent(date)}">
          <strong>${escapeHtml(name)}</strong>
          <span>${escapeHtml(service)}</span>
        </a>
      `;
    }).join('');
  }

  function renderCalendar({ days, timeWindows, appointments }) {
    if (!els.calendar) return;
    const grouped = groupAppointments(appointments);
    const today = torontoToday();

    const head = `
      <div class="admin-cal-corner" aria-hidden="true"></div>
      ${days.map((date) => `
        <a class="admin-cal-day ${date === today ? 'is-today' : ''}" href="/admin?date=${encodeURIComponent(date)}">
          <span>${escapeHtml(dayLabel(date))}</span>
          <small>${escapeHtml(date)}</small>
        </a>
      `).join('')}
    `;

    const rows = timeWindows.map((windowLabel) => `
      <div class="admin-cal-time"><span>${escapeHtml(shortSlot(windowLabel))}</span><small>${escapeHtml(windowLabel)}</small></div>
      ${days.map((date) => {
        const key = `${date}__${windowLabel}`;
        const slotAppointments = grouped.get(key) || [];
        return `<div class="admin-cal-slot">${renderCell(date, windowLabel, slotAppointments)}</div>`;
      }).join('')}
    `).join('');

    els.calendar.innerHTML = `<div class="admin-cal-grid">${head}${rows}</div>`;
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
      if (document.hidden || refreshInFlight) return;
      loadWeek(staffEmail, { quiet: true });
    }, REFRESH_MS);
  }

  async function loadWeek(email, options = {}) {
    const quiet = Boolean(options.quiet);
    if (refreshInFlight) return;
    refreshInFlight = true;

    const days = weekDates(weekStart);
    const from = days[0];
    const to = days[6];
    syncWeekUrl();

    try {
      const token = await window.EastCordAccount?.getAccessToken?.();
      if (!token) {
        stopAutoRefresh();
        showGate('Log in with the EastCord staff account to open the admin dashboard.');
        return;
      }

      if (!quiet) setStatus(`Loading week of ${dayLabel(from)}...`);
      const response = await fetch(
        `/.netlify/functions/admin-appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      let payload = {};
      try {
        payload = await response.json();
      } catch (error) {
        payload = {};
      }

      if (response.status === 401 || response.status === 403) {
        stopAutoRefresh();
        showGate(payload.message || 'This account is not allowed to open the admin dashboard.');
        return;
      }

      if (!response.ok) {
        if (!quiet) {
          setStatus(payload.message || 'Calendar could not be loaded.', 'error');
          if (els.calendar) els.calendar.innerHTML = '';
        }
        return;
      }

      showDashboard(email);
      const appointments = Array.isArray(payload.appointments) ? payload.appointments : [];
      const timeWindows = Array.isArray(payload.timeWindows) && payload.timeWindows.length
        ? payload.timeWindows
        : DEFAULT_WINDOWS;
      const count = appointments.length;
      const stamp = new Date().toLocaleTimeString('en-CA', {
        timeZone: 'America/Toronto',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
      setStatus(
        `${dayLabel(from)} – ${dayLabel(to)} · ${count === 1 ? '1 appointment' : `${count} appointments`} · Live · updated ${stamp}`,
      );
      renderCalendar({ days, timeWindows, appointments });
      startAutoRefresh();
    } finally {
      refreshInFlight = false;
    }
  }

  async function initialize() {
    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      showGate('Staff login is not configured yet.');
      return;
    }

    const profile = await window.EastCordAccount.getCurrentProfile?.();
    const email = String(profile?.email || '').trim().toLowerCase();
    const isStaff = window.EastCordAccount.isStaffAdminEmail?.(email) || email === ADMIN_EMAIL;
    if (!email) {
      showGate('Log in with info@eastcordtires.ca to open the admin dashboard.');
      return;
    }
    if (!isStaff) {
      showGate('Only the EastCord staff account can open this page.');
      return;
    }

    staffEmail = email;
    showDashboard(email);
    await loadWeek(email);
  }

  els.prev?.addEventListener('click', async () => {
    weekStart = addDays(weekStart, -7);
    await loadWeek(staffEmail);
  });

  els.next?.addEventListener('click', async () => {
    weekStart = addDays(weekStart, 7);
    await loadWeek(staffEmail);
  });

  els.today?.addEventListener('click', async () => {
    weekStart = mondayOf(torontoToday());
    await loadWeek(staffEmail);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || els.dashboard?.hidden) return;
    loadWeek(staffEmail, { quiet: true });
  });

  window.addEventListener('focus', () => {
    if (document.hidden || els.dashboard?.hidden) return;
    loadWeek(staffEmail, { quiet: true });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
