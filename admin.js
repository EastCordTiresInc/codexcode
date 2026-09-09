(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';

  const els = {
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    dateForm: document.querySelector('[data-admin-date-form]'),
    dateInput: document.querySelector('[data-admin-date]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
  };

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '$0.00';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
  }

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

  function showGate(message) {
    if (els.loading) els.loading.hidden = true;
    if (els.dashboard) els.dashboard.hidden = true;
    if (els.gate) els.gate.hidden = false;
    if (els.gateMessage && message) els.gateMessage.textContent = message;
  }

  function showDashboard() {
    if (els.loading) els.loading.hidden = true;
    if (els.gate) els.gate.hidden = true;
    if (els.dashboard) els.dashboard.hidden = false;
  }

  function setStatus(message, tone = '') {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  function vehicleLabel(appointment) {
    return [appointment.vehicle_year, appointment.vehicle_make, appointment.vehicle_model]
      .filter(Boolean)
      .join(' ') || 'Not provided';
  }

  function locationLabel(appointment) {
    if (appointment.install_location === 'shop' || String(appointment.city || '').toLowerCase() === 'eastcord shop') {
      return 'EastCord Tires shop';
    }
    return [
      appointment.full_service_address,
      [appointment.city, appointment.postal_code].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ') || 'Location not provided';
  }

  function paymentBadge(appointment) {
    const paid = String(appointment.payment_status || '').toLowerCase().includes('paid')
      || String(appointment.booking_status || '').toLowerCase() === 'confirmed';
    return paid
      ? '<span class="admin-badge is-paid">Deposit paid</span>'
      : '<span class="admin-badge is-pending">Payment pending</span>';
  }

  function renderAppointments(appointments) {
    if (!els.list) return;
    if (!appointments.length) {
      els.list.innerHTML = '<p class="admin-empty">No appointments for this date.</p>';
      return;
    }

    els.list.innerHTML = appointments.map((appointment) => {
      const notes = [appointment.parking_access_notes, appointment.additional_notes]
        .filter(Boolean)
        .join(' · ');
      return `
        <article class="admin-appointment">
          <div class="admin-appointment-top">
            <div>
              <p class="admin-appointment-time">${escapeHtml(appointment.preferred_time_window || 'Time TBD')}</p>
              <p class="admin-appointment-service">${escapeHtml(appointment.service_name || 'Tire service')}</p>
            </div>
            <div class="admin-badges">
              <span class="admin-badge">${escapeHtml(appointment.booking_status || 'Pending')}</span>
              ${paymentBadge(appointment)}
            </div>
          </div>
          <div class="admin-grid">
            <div><span>Customer</span><strong>${escapeHtml(appointment.customer_name || 'Not provided')}</strong></div>
            <div><span>Phone</span><strong>${escapeHtml(appointment.customer_phone || 'Not provided')}</strong></div>
            <div><span>Email</span><strong>${escapeHtml(appointment.customer_email || 'Not provided')}</strong></div>
            <div><span>Vehicle</span><strong>${escapeHtml(vehicleLabel(appointment))}</strong></div>
            <div><span>Plate</span><strong>${escapeHtml(appointment.vehicle_plate_number || 'Not provided')}</strong></div>
            <div><span>Tire size</span><strong>${escapeHtml(appointment.tire_size || 'Not provided')}</strong></div>
            <div><span>Location</span><strong>${escapeHtml(locationLabel(appointment))}</strong></div>
            <div><span>Deposit</span><strong>${escapeHtml(money(appointment.deposit_amount))}</strong></div>
            <div><span>Remaining</span><strong>${escapeHtml(money(appointment.remaining_balance))}</strong></div>
          </div>
          ${notes ? `<p class="admin-notes">${escapeHtml(notes)}</p>` : ''}
        </article>
      `;
    }).join('');
  }

  async function loadAppointments(date) {
    const token = await window.EastCordAccount?.getAccessToken?.();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return;
    }

    setStatus(`Loading appointments for ${date}...`);
    const response = await fetch(`/.netlify/functions/admin-appointments?date=${encodeURIComponent(date)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch (error) {
      payload = {};
    }

    if (response.status === 401 || response.status === 403) {
      showGate(payload.message || 'This account is not allowed to open the admin dashboard.');
      return;
    }

    if (!response.ok) {
      setStatus(payload.message || 'Appointments could not be loaded.', 'error');
      if (els.list) els.list.innerHTML = '';
      return;
    }

    showDashboard();
    const count = Number(payload.count) || 0;
    setStatus(count === 1 ? '1 appointment' : `${count} appointments`);
    renderAppointments(Array.isArray(payload.appointments) ? payload.appointments : []);
  }

  async function initialize() {
    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      showGate('Staff login is not configured yet.');
      return;
    }

    const profile = await window.EastCordAccount.getCurrentProfile?.();
    const email = String(profile?.email || '').trim().toLowerCase();
    if (!email) {
      showGate('Log in with info@eastcordtires.ca to open the admin dashboard.');
      return;
    }

    if (email !== ADMIN_EMAIL) {
      showGate('Only the EastCord staff account can open this page.');
      return;
    }

    const initialDate = new URLSearchParams(window.location.search).get('date') || torontoToday();
    if (els.dateInput) els.dateInput.value = initialDate;
    showDashboard();
    await loadAppointments(initialDate);
  }

  els.dateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const date = els.dateInput?.value || torontoToday();
    const url = new URL(window.location.href);
    url.searchParams.set('date', date);
    window.history.replaceState({}, '', url);
    await loadAppointments(date);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
