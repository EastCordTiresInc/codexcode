(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';
  const REFRESH_MS = 15000;
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
  const STATUS_ACTIONS = [
    { status: 'Completed', label: 'Complete' },
    { status: 'No-Show', label: 'No-show', requiresStarted: true },
    { status: 'Cancelled', label: 'Cancel' },
    { status: 'Pending Confirmation', label: 'Mark pending', alwaysEnabled: true },
  ];

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    dateForm: document.querySelector('[data-admin-date-form]'),
    dateInput: document.querySelector('[data-admin-date]'),
    statusFilter: document.querySelector('[data-admin-status-filter]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
  };

  let staffEmail = ADMIN_EMAIL;
  let refreshTimer = null;
  let refreshInFlight = false;
  let timeWindows = DEFAULT_WINDOWS.slice();
  let dayAppointments = [];
  let lastStatusStamp = '';

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

  function phoneHref(phone) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
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

  function torontoDateTimeParts(date = new Date()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );

    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: (Number(parts.hour) * 60) + Number(parts.minute),
    };
  }

  function windowStartMinutes(windowLabel) {
    const start = String(windowLabel || '').split(' - ')[0]?.trim() || '';
    const match = start.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;

    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridian = match[3].toUpperCase();
    if (meridian === 'PM' && hour < 12) hour += 12;
    if (meridian === 'AM' && hour === 12) hour = 0;
    return (hour * 60) + minute;
  }

  function hasAppointmentStarted(appointment) {
    const date = String(appointment?.preferred_date || '');
    const startMinutes = windowStartMinutes(appointment?.preferred_time_window);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || startMinutes == null) return false;

    const now = torontoDateTimeParts();
    if (now.date > date) return true;
    if (now.date < date) return false;
    return now.minutes >= startMinutes;
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

  function statusBadgeClass(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'confirmed') return 'is-confirmed';
    if (value === 'completed') return 'is-completed';
    if (value === 'no-show') return 'is-noshow';
    if (value === 'cancelled') return 'is-cancelled';
    return 'is-pending-status';
  }

  function renderPhone(phone) {
    const label = phone || 'Not provided';
    const href = phoneHref(phone);
    if (!href) return `<strong>${escapeHtml(label)}</strong>`;
    return `<strong><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></strong>`;
  }

  function timeWindowOptions(selected) {
    return timeWindows.map((windowLabel) => (
      `<option value="${escapeHtml(windowLabel)}"${windowLabel === selected ? ' selected' : ''}>${escapeHtml(windowLabel)}</option>`
    )).join('');
  }

  function customerNotes(appointment) {
    return [appointment.parking_access_notes, appointment.additional_notes]
      .filter(Boolean)
      .join('\n');
  }

  function statusBucket(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'completed') return 'completed';
    if (value === 'cancelled') return 'cancelled';
    if (value === 'no-show') return 'noshow';
    return 'pending';
  }

  function currentStatusFilter() {
    return els.statusFilter?.value || 'all';
  }

  function filteredAppointments() {
    const filter = currentStatusFilter();
    if (filter === 'all') return dayAppointments;
    return dayAppointments.filter((appointment) => (
      statusBucket(appointment.booking_status) === filter
    ));
  }

  function formatLinkedTires(value) {
    let items = value;
    if (typeof items === 'string') {
      const trimmed = items.trim();
      if (!trimmed) return 'None';
      try {
        items = JSON.parse(trimmed);
      } catch (error) {
        return trimmed;
      }
    }
    if (!Array.isArray(items) || !items.length) return 'None';

    return items.map((item) => {
      if (item == null) return '';
      if (typeof item === 'string' || typeof item === 'number') return String(item);
      const label = [
        item.brand,
        item.size || item.tire_size || item.size_label,
        item.qty != null ? `×${item.qty}` : (item.quantity != null ? `×${item.quantity}` : ''),
        item.id != null ? `#${item.id}` : '',
      ].filter(Boolean).join(' ');
      return label || 'Tire';
    }).filter(Boolean).join(', ') || 'None';
  }

  function applyAppointmentView() {
    const visible = filteredAppointments();
    const total = dayAppointments.length;
    const filter = currentStatusFilter();
    const filterLabel = filter === 'all'
      ? ''
      : ` · ${filter === 'noshow' ? 'no-show' : filter}`;

    const stamp = lastStatusStamp || new Date().toLocaleTimeString('en-CA', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });

    setStatus(
      total === 0
        ? `No appointments · Live · updated ${stamp}`
        : visible.length === total
          ? `${total === 1 ? '1 appointment' : `${total} appointments`} · Live · updated ${stamp}`
          : `Showing ${visible.length} of ${total}${filterLabel} · Live · updated ${stamp}`,
    );
    renderAppointments(visible);
  }

  function renderAppointments(appointments) {
    if (!els.list) return;

    if (!appointments.length) {
      const filter = currentStatusFilter();
      els.list.innerHTML = filter === 'all'
        ? '<p class="admin-empty">No appointments for this date.</p>'
        : '<p class="admin-empty">No appointments match this status filter.</p>';
      return;
    }

    els.list.innerHTML = appointments.map((appointment) => {
      const id = String(appointment.id);
      const notes = customerNotes(appointment);
      const status = appointment.booking_status || 'Pending Confirmation';
      const tireCount = appointment.number_of_tires == null || appointment.number_of_tires === ''
        ? 'Not provided'
        : String(appointment.number_of_tires);
      const colour = appointment.vehicle_colour || 'Not provided';
      const linked = formatLinkedTires(appointment.linked_tires);
      const subtotal = appointment.service_subtotal ?? appointment.starting_price;
      const hst = appointment.hst_amount;
      const total = appointment.total_with_hst;
      return `
        <article class="admin-appointment" id="appt-${escapeHtml(id)}" data-appointment-id="${escapeHtml(id)}">
          <div class="admin-appointment-top">
            <div>
              <p class="admin-appointment-time">${escapeHtml(appointment.preferred_time_window || 'Time TBD')}</p>
              <p class="admin-appointment-service">${escapeHtml(appointment.service_name || 'Tire service')}</p>
            </div>
            <div class="admin-badges">
              <span class="admin-badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
              ${paymentBadge(appointment)}
            </div>
          </div>
          <div class="admin-grid">
            <div><span>Customer</span><strong>${escapeHtml(appointment.customer_name || 'Not provided')}</strong></div>
            <div><span>Phone</span>${renderPhone(appointment.customer_phone)}</div>
            <div><span>Email</span><strong>${escapeHtml(appointment.customer_email || 'Not provided')}</strong></div>
            <div><span>Vehicle</span><strong>${escapeHtml(vehicleLabel(appointment))}</strong></div>
            <div><span>Colour</span><strong>${escapeHtml(colour)}</strong></div>
            <div><span>Plate</span><strong>${escapeHtml(appointment.vehicle_plate_number || 'Not provided')}</strong></div>
            <div><span>Tire size</span><strong>${escapeHtml(appointment.tire_size || 'Not provided')}</strong></div>
            <div><span># of tires</span><strong>${escapeHtml(tireCount)}</strong></div>
            <div><span>Linked tires</span><strong>${escapeHtml(linked)}</strong></div>
            <div><span>Location</span><strong>${escapeHtml(locationLabel(appointment))}</strong></div>
            <div><span>Subtotal</span><strong>${escapeHtml(money(subtotal))}</strong></div>
            <div><span>HST</span><strong>${escapeHtml(money(hst))}</strong></div>
            <div><span>Total</span><strong>${escapeHtml(money(total))}</strong></div>
            <div><span>Deposit</span><strong>${escapeHtml(money(appointment.deposit_amount))}</strong></div>
            <div><span>Remaining</span><strong>${escapeHtml(money(appointment.remaining_balance))}</strong></div>
          </div>
          ${notes ? `<p class="admin-notes">${escapeHtml(notes).replace(/\n/g, '<br>')}</p>` : ''}

          <div class="admin-manage">
            <div class="admin-manage-block">
              <p class="admin-manage-label">Status</p>
              <div class="admin-manage-actions">
                ${STATUS_ACTIONS.map((action) => {
                  const isCurrent = action.status === status;
                  const started = hasAppointmentStarted(appointment);
                  const waitingToStart = Boolean(action.requiresStarted && !started);
                  const disabled = (isCurrent && !action.alwaysEnabled) || waitingToStart;
                  const title = waitingToStart
                    ? 'No-show is available after this appointment time begins'
                    : '';
                  return `
                  <button
                    type="button"
                    class="button button-secondary admin-mini-btn${isCurrent ? ' is-current' : ''}"
                    data-action="status"
                    data-status="${escapeHtml(action.status)}"
                    ${disabled ? 'disabled' : ''}
                    ${title ? `title="${escapeHtml(title)}"` : ''}
                  >${escapeHtml(action.label)}</button>
                `;
                }).join('')}
              </div>
            </div>

            <div class="admin-manage-block">
              <p class="admin-manage-label">Reschedule</p>
              <div class="admin-reschedule">
                <label>
                  Date
                  <input type="date" data-reschedule-date value="${escapeHtml(appointment.preferred_date || '')}" required />
                </label>
                <label>
                  Time
                  <select data-reschedule-time required>
                    ${timeWindowOptions(appointment.preferred_time_window)}
                  </select>
                </label>
                <button type="button" class="button button-secondary admin-mini-btn" data-action="reschedule">Save schedule</button>
              </div>
            </div>

            <div class="admin-manage-block">
              <p class="admin-manage-label">Staff note</p>
              <div class="admin-note-row">
                <textarea data-staff-note rows="2" placeholder="Add an internal note (saved to the appointment)"></textarea>
                <button type="button" class="button button-secondary admin-mini-btn" data-action="note">Save note</button>
              </div>
            </div>
            <p class="admin-manage-feedback" data-manage-feedback hidden></p>
          </div>
        </article>
      `;
    }).join('');

    focusAppointmentFromHash();
  }

  function focusAppointmentFromHash() {
    const match = String(window.location.hash || '').match(/^#appt-(.+)$/);
    if (!match) return;
    const target = document.getElementById(`appt-${match[1]}`);
    if (!target) return;
    target.classList.add('is-focused');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function currentDate() {
    return els.dateInput?.value || torontoToday();
  }

  function listIsBeingEdited() {
    const active = document.activeElement;
    return Boolean(active && els.list?.contains(active));
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
      if (document.hidden || refreshInFlight || listIsBeingEdited()) return;
      loadAppointments(currentDate(), staffEmail, { quiet: true });
    }, REFRESH_MS);
  }

  async function getToken() {
    return window.EastCordAccount?.getAccessToken?.();
  }

  async function patchAppointment(payload) {
    const token = await getToken();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return null;
    }

    const response = await fetch('/.netlify/functions/admin-appointments', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (response.status === 401 || response.status === 403) {
      showGate(body.message || 'This account is not allowed to open the admin dashboard.');
      return null;
    }

    if (!response.ok) {
      throw new Error(body.message || 'Appointment could not be updated.');
    }

    return body;
  }

  function setCardFeedback(card, message, tone = '') {
    const feedback = card?.querySelector('[data-manage-feedback]');
    if (!feedback) return;
    feedback.hidden = !message;
    feedback.textContent = message || '';
    feedback.dataset.tone = tone;
  }

  async function loadAppointments(date, email, options = {}) {
    const quiet = Boolean(options.quiet);
    if (refreshInFlight) return;
    if (quiet && listIsBeingEdited()) return;
    refreshInFlight = true;

    try {
      const token = await getToken();
      if (!token) {
        stopAutoRefresh();
        showGate('Log in with the EastCord staff account to open the admin dashboard.');
        return;
      }

      if (!quiet) setStatus(`Loading appointments for ${date}...`);
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
        stopAutoRefresh();
        showGate(payload.message || 'This account is not allowed to open the admin dashboard.');
        return;
      }

      if (!response.ok) {
        if (!quiet) {
          setStatus(payload.message || 'Appointments could not be loaded.', 'error');
          if (els.list) els.list.innerHTML = '';
        }
        return;
      }

      showDashboard(email);
      if (Array.isArray(payload.timeWindows) && payload.timeWindows.length) {
        timeWindows = payload.timeWindows;
      }
      dayAppointments = Array.isArray(payload.appointments) ? payload.appointments : [];
      lastStatusStamp = new Date().toLocaleTimeString('en-CA', {
        timeZone: 'America/Toronto',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      });
      applyAppointmentView();
      startAutoRefresh();
    } finally {
      refreshInFlight = false;
    }
  }

  async function handleManageClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !els.list?.contains(button)) return;

    const card = button.closest('[data-appointment-id]');
    const id = card?.dataset.appointmentId;
    if (!id) return;

    const action = button.dataset.action;
    setCardFeedback(card, '');

    try {
      button.disabled = true;
      if (action === 'status') {
        await patchAppointment({ id, booking_status: button.dataset.status });
        setStatus('Appointment status updated.');
        await loadAppointments(currentDate(), staffEmail);
        return;
      }

      if (action === 'reschedule') {
        const date = card.querySelector('[data-reschedule-date]')?.value || '';
        const time = card.querySelector('[data-reschedule-time]')?.value || '';
        if (!date || !time) {
          setCardFeedback(card, 'Choose both a date and time window.', 'error');
          return;
        }
        const result = await patchAppointment({
          id,
          preferred_date: date,
          preferred_time_window: time,
        });
        const nextDate = result?.appointment?.preferred_date || date;
        if (els.dateInput) els.dateInput.value = nextDate;
        const url = new URL(window.location.href);
        url.searchParams.set('date', nextDate);
        url.hash = `appt-${id}`;
        window.history.replaceState({}, '', url);
        setStatus(`Appointment moved to ${nextDate}.`);
        await loadAppointments(nextDate, staffEmail);
        return;
      }

      if (action === 'note') {
        const note = String(card.querySelector('[data-staff-note]')?.value || '').trim();
        if (!note) {
          setCardFeedback(card, 'Write a note before saving.', 'error');
          return;
        }
        await patchAppointment({ id, staff_note: note });
        setStatus('Staff note saved.');
        await loadAppointments(currentDate(), staffEmail);
      }
    } catch (error) {
      setCardFeedback(card, error.message || 'Update failed.', 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
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
    const initialDate = new URLSearchParams(window.location.search).get('date') || torontoToday();
    if (els.dateInput) els.dateInput.value = initialDate;
    showDashboard(email);
    await loadAppointments(initialDate, email);
  }

  els.dateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const date = els.dateInput?.value || torontoToday();
    const url = new URL(window.location.href);
    url.searchParams.set('date', date);
    window.history.replaceState({}, '', url);
    await loadAppointments(date, staffEmail);
  });

  els.statusFilter?.addEventListener('change', () => {
    applyAppointmentView();
  });

  els.list?.addEventListener('click', (event) => {
    handleManageClick(event);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || els.dashboard?.hidden || listIsBeingEdited()) return;
    loadAppointments(currentDate(), staffEmail, { quiet: true });
  });

  window.addEventListener('focus', () => {
    if (document.hidden || els.dashboard?.hidden || listIsBeingEdited()) return;
    loadAppointments(currentDate(), staffEmail, { quiet: true });
  });

  window.addEventListener('hashchange', focusAppointmentFromHash);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
