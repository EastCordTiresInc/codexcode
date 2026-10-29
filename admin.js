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
    { status: 'Confirmed', label: 'Confirm' },
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
    kicker: document.querySelector('[data-admin-kicker]'),
    title: document.querySelector('[data-admin-title]'),
    summary: document.querySelector('[data-admin-summary]'),
    upcomingLink: document.querySelector('[data-admin-upcoming-link]'),
    statusFilter: document.querySelector('[data-admin-status-filter]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
    modal: document.querySelector('[data-appointment-modal]'),
    modalBody: document.querySelector('[data-appointment-modal-body]'),
  };

  let staffEmail = ADMIN_EMAIL;
  let refreshTimer = null;
  let refreshInFlight = false;
  let timeWindows = DEFAULT_WINDOWS.slice();
  let dayAppointments = [];
  let lastStatusStamp = '';
  let viewMode = 'upcoming';
  const openAppointmentIds = new Set();
  let openModalAppointmentId = '';
  let viewDate = '';
  let hasMoreUpcoming = false;

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

  function isDateValue(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  function formatAppointmentDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat('en-CA', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  function formatScheduleLabel(appointment) {
    const date = formatAppointmentDate(appointment?.preferred_date);
    const time = appointment?.preferred_time_window || 'Time TBD';
    return date ? `${date} · ${time}` : time;
  }

  function setPageHeading() {
    const day = viewMode === 'day';
    if (els.kicker) els.kicker.textContent = day ? 'Selected day' : 'Schedule';
    if (els.title) els.title.textContent = day ? (formatAppointmentDate(viewDate) || 'Appointments') : 'Upcoming appointments';
    if (els.summary) {
      els.summary.textContent = day
        ? 'Appointments on this day. Status, reschedule, and staff notes are saved here.'
        : 'The next 10 appointments, soonest first, then completed jobs and confirmed appointments whose time has passed.';
    }
    if (els.upcomingLink) els.upcomingLink.hidden = !day;
    document.title = day
      ? `${formatAppointmentDate(viewDate) || 'Appointments'} | EastCord Admin`
      : 'Upcoming appointments | EastCord Admin';
  }

  function isLocalDemoHost() {
    const host = window.location.hostname;
    if (host === 'eastcordtires.ca' || host === 'www.eastcordtires.ca' || host === 'updatedeastcord.netlify.app') return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.trycloudflare.com') || host.endsWith('.loca.lt')) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);
  }

  function demoPhotoUrl(label, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#172033';
    context.font = '700 36px sans-serif';
    context.fillText(label, 28, 250);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  let demoPhotoCache = null;

  function demoJobPhotos() {
    if (demoPhotoCache) return demoPhotoCache;
    demoPhotoCache = {
      'after-1': { url: demoPhotoUrl('After installation', '#58d68d') },
    };
    return demoPhotoCache;
  }

  function installationPhotoLabel(id, photos) {
    const match = String(id || '').match(/^(before|after)-(\d+)$/);
    if (!match) return 'Installation photo';
    const kind = match[1] === 'before' ? 'before' : 'after';
    const index = Number(match[2]);
    const multi = Object.keys(photos || {}).some((key) => /^(before|after)-([2-9]|\d{2,})$/.test(key));
    if (!multi && index === 1) return kind === 'before' ? 'Before installation' : 'After installation';
    return `Tire ${index} ${kind}`;
  }

  function demoCompletedAppointment(date) {
    return {
      id: 'demo-install',
      demo: true,
      customer_name: 'Demo install',
      customer_email: '',
      customer_phone: '',
      service_name: 'Off-rim tire swap',
      preferred_date: date,
      preferred_time_window: '2:00 PM - 3:00 PM',
      booking_status: 'Completed',
      vehicle_year: '2018',
      vehicle_make: 'Honda',
      vehicle_model: 'Civic',
      vehicle_colour: 'Grey',
      vehicle_plate_number: 'DEMO',
      tire_size: '215/45R17',
      number_of_tires: 1,
      install_location: 'shop',
      city: 'Milton',
      additional_notes: 'Demo only. Nothing is saved.',
      job_photos: demoJobPhotos(),
    };
  }

  function withLocalDemo(appointments, date) {
    const list = Array.isArray(appointments) ? appointments.filter((item) => item.id !== 'demo-install') : [];
    if (!isLocalDemoHost() || date !== torontoToday()) return list;
    return [demoCompletedAppointment(date), ...list];
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

  function mapsHref(appointment) {
    if (appointment.install_location === 'shop' || String(appointment.city || '').toLowerCase() === 'eastcord shop') {
      return '';
    }
    const query = [
      appointment.full_service_address,
      appointment.city,
      appointment.postal_code,
    ].filter(Boolean).join(', ');
    if (!query) return '';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function renderLocation(appointment) {
    const label = locationLabel(appointment);
    const href = mapsHref(appointment);
    if (!href) return `<strong>${escapeHtml(label)}</strong>`;
    return `<strong><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></strong>`;
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
    const localOnly = visible.length > 0 && visible.every((item) => item.demo);

    const pastTotal = dayAppointments.filter((item) => item.past).length;
    const aheadTotal = total - pastTotal;
    const upcomingLabel = pastTotal
      ? `${aheadTotal} upcoming · ${pastTotal} earlier`
      : (aheadTotal === 1
        ? '1 upcoming appointment'
        : (aheadTotal === 10 && hasMoreUpcoming ? 'Next 10 appointments' : `${aheadTotal} upcoming appointments`));
    setStatus(
      localOnly
        ? 'Demo completed job for today. Nothing is saved.'
        : total === 0
          ? `${viewMode === 'upcoming' ? 'No upcoming appointments' : 'No appointments'} · Live · updated ${stamp}`
          : visible.length === total
            ? `${viewMode === 'upcoming' ? upcomingLabel : (total === 1 ? '1 appointment' : `${total} appointments`)} · Live · updated ${stamp}`
            : `Showing ${visible.length} of ${viewMode === 'upcoming' ? `the next ${total}` : total}${filterLabel} · Live · updated ${stamp}`,
    );
    renderAppointments(visible);
  }

  function statusActionsMarkup(status, appointment) {
    return STATUS_ACTIONS.map((action) => {
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
          class="button admin-mini-btn${isCurrent ? ' is-current' : ''}"
          data-action="status"
          data-status="${escapeHtml(action.status)}"
          ${disabled ? 'disabled' : ''}
          ${title ? `title="${escapeHtml(title)}"` : ''}
        >${escapeHtml(action.label)}</button>
      `;
    }).join('');
  }

  function renderAppointments(appointments) {
    if (!els.list) return;

    if (!appointments.length) {
      const filter = currentStatusFilter();
      els.list.innerHTML = filter === 'all'
        ? `<p class="admin-empty">${viewMode === 'upcoming' ? 'No upcoming appointments.' : 'No appointments for this date.'}</p>`
        : '<p class="admin-empty">No appointments match this status filter.</p>';
      return;
    }

    let completedHeadingShown = false;
    els.list.innerHTML = appointments.map((appointment) => {
      const id = String(appointment.id);
      const collapsible = viewMode === 'upcoming';
      const open = !collapsible || openAppointmentIds.has(id);
      const showCompletedHeading = viewMode === 'upcoming'
        && appointment.past
        && !completedHeadingShown;
      if (showCompletedHeading) completedHeadingShown = true;
      return `
        ${showCompletedHeading ? '<h2 class="admin-completed-heading">Earlier</h2>' : ''}
        <article class="admin-appointment${collapsible ? ' is-collapsible' : ''}${open ? ' is-open' : ''}" id="appt-${escapeHtml(id)}" data-appointment-id="${escapeHtml(id)}" aria-expanded="${open ? 'true' : 'false'}">
          ${appointmentSummaryMarkup(appointment, { collapsible })}
          ${collapsible ? '' : `<div class="admin-appointment-details">${appointmentDetailsMarkup(appointment)}</div>`}
        </article>
      `;
    }).join('');

    focusAppointmentFromHash();
    if (openModalAppointmentId) refreshOpenAppointmentModal();
  }

  function appointmentSummaryMarkup(appointment, { collapsible = false, title = false } = {}) {
    const status = appointment.booking_status || 'Pending Confirmation';
    return `
      <div class="admin-appointment-summary" data-appointment-summary ${collapsible ? 'tabindex="0"' : ''}>
        <div class="admin-appointment-top">
          <div>
            <p class="admin-appointment-time"${title ? ' id="appointment-modal-title"' : ''}>${escapeHtml(formatScheduleLabel(appointment))}</p>
            <p class="admin-appointment-service">${escapeHtml(appointment.service_name || 'Tire service')}</p>
          </div>
          <div class="admin-badges">
            <span class="admin-badge ${statusBadgeClass(status)}">${escapeHtml(status)}</span>
            ${appointment.demo ? '<span class="admin-badge is-sample">Demo</span>' : paymentBadge(appointment)}
          </div>
        </div>
        <div class="admin-grid">
          <div><span>Customer</span><strong>${escapeHtml(appointment.customer_name || 'Not provided')}</strong></div>
          <div><span>Phone</span>${renderPhone(appointment.customer_phone)}</div>
          <div><span>Email</span><strong>${escapeHtml(appointment.customer_email || 'Not provided')}</strong></div>
          <div><span>Plate</span><strong>${escapeHtml(appointment.vehicle_plate_number || 'Not provided')}</strong></div>
        </div>
      </div>
    `;
  }

  function appointmentDetailsMarkup(appointment) {
    const notes = customerNotes(appointment);
    const status = appointment.booking_status || 'Pending Confirmation';
    const tireCount = appointment.number_of_tires == null || appointment.number_of_tires === ''
      ? 'Not provided'
      : String(appointment.number_of_tires);
    const vehicle = vehicleLabel(appointment);
    const colour = String(appointment.vehicle_colour || '').trim();
    const linked = formatLinkedTires(appointment.linked_tires);
    const subtotal = appointment.service_subtotal ?? appointment.starting_price;
    const hst = appointment.hst_amount;
    const total = appointment.total_with_hst;
    return `
      ${appointment.demo ? '' : `<div class="admin-status-row">
        <p class="admin-manage-label">Status</p>
        <div class="admin-manage-actions admin-status-actions">
          ${statusActionsMarkup(status, appointment)}
        </div>
      </div>`}
      <div class="admin-grid">
        ${vehicle === 'Not provided' ? '' : `<div><span>Vehicle</span><strong>${escapeHtml(vehicle)}</strong></div>`}
        ${colour ? `<div><span>Colour</span><strong>${escapeHtml(colour)}</strong></div>` : ''}
        ${appointment.tire_size ? `<div><span>Tire size</span><strong>${escapeHtml(appointment.tire_size)}</strong></div>` : ''}
        <div><span># of tires</span><strong>${escapeHtml(tireCount)}</strong></div>
        <div><span>Linked tires</span><strong>${escapeHtml(linked)}</strong></div>
        <div><span>Location</span>${renderLocation(appointment)}</div>
        <div><span>Subtotal</span><strong>${escapeHtml(money(subtotal))}</strong></div>
        <div><span>HST</span><strong>${escapeHtml(money(hst))}</strong></div>
        <div><span>Total</span><strong>${escapeHtml(money(total))}</strong></div>
        <div><span>Paid online</span><strong>${escapeHtml(money(appointment.deposit_amount))}</strong></div>
        <div><span>Remaining</span><strong>${escapeHtml(money(appointment.remaining_balance))}</strong></div>
      </div>
      ${notes ? `<p class="admin-notes">${escapeHtml(notes).replace(/\n/g, '<br>')}</p>` : ''}
      ${installationPhotosMarkup(appointment)}
      ${appointment.demo ? '' : `<div class="admin-manage">
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
      </div>`}
    `;
  }

  function installationPhotosMarkup(appointment) {
    if (statusBucket(appointment.booking_status) !== 'completed') return '';
    const photos = appointment.job_photos || {};
    const saved = Object.keys(photos)
      .filter((id) => /^(before|after)-\d+$/.test(id) && photos[id]?.url)
      .sort((left, right) => {
        const leftIndex = Number(left.split('-')[1]);
        const rightIndex = Number(right.split('-')[1]);
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.startsWith('after') ? -1 : 1;
      });
    if (!saved.length) return '';
    return `
      <div class="admin-install-photos">
        <p class="admin-manage-label">Installation photos</p>
        <div class="admin-install-photo-grid">
          ${saved.map((id) => {
            const label = installationPhotoLabel(id, photos);
            return `
            <figure>
              <img src="${escapeHtml(photos[id].url)}" alt="${escapeHtml(label)}" />
              <figcaption>${escapeHtml(label)}</figcaption>
            </figure>
          `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function appointmentFromId(id) {
    return dayAppointments.find((item) => String(item.id) === String(id)) || null;
  }

  function modalIsOpen() {
    return Boolean(els.modal && !els.modal.hidden);
  }

  function closeAppointmentModal() {
    openModalAppointmentId = '';
    if (els.modalBody) els.modalBody.innerHTML = '';
    if (els.modal) els.modal.hidden = true;
    document.body.classList.remove('admin-modal-open');
  }

  function openAppointmentModal(id) {
    const appointment = appointmentFromId(id);
    if (!appointment || !els.modal || !els.modalBody) return;
    openModalAppointmentId = String(appointment.id);
    els.modalBody.innerHTML = `
      <article class="admin-appointment is-open" data-appointment-id="${escapeHtml(appointment.id)}">
        ${appointmentSummaryMarkup(appointment, { title: true })}
        <div class="admin-appointment-details">${appointmentDetailsMarkup(appointment)}</div>
      </article>
    `;
    els.modal.hidden = false;
    document.body.classList.add('admin-modal-open');
  }

  function refreshOpenAppointmentModal() {
    if (!openModalAppointmentId) return;
    if (!appointmentFromId(openModalAppointmentId)) {
      closeAppointmentModal();
      return;
    }
    openAppointmentModal(openModalAppointmentId);
  }

  function setAppointmentOpen(card, open) {
    if (!card) return;
    const id = card.dataset.appointmentId || '';
    card.classList.toggle('is-open', open);
    card.setAttribute('aria-expanded', open ? 'true' : 'false');
    const details = card.querySelector('.admin-appointment-details');
    if (details) details.hidden = !open;
    if (!id) return;
    if (open) openAppointmentIds.add(id);
    else openAppointmentIds.delete(id);
  }

  function toggleAppointmentFromEvent(event) {
    if (event.target.closest('a, button, input, select, textarea, label')) return;
    const summary = event.target.closest('[data-appointment-summary]');
    const card = summary?.closest('.admin-appointment.is-collapsible');
    if (!card || !els.list?.contains(card)) return;
    if (event.type === 'keydown') event.preventDefault();
    openAppointmentModal(card.dataset.appointmentId);
  }

  function focusAppointmentFromHash() {
    const match = String(window.location.hash || '').match(/^#appt-(.+)$/);
    if (!match) return;
    const target = document.getElementById(`appt-${match[1]}`);
    if (!target) return;
    if (target.classList.contains('is-collapsible') && openModalAppointmentId !== match[1]) {
      openAppointmentModal(match[1]);
    }
    target.classList.add('is-focused');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function loadCurrent(email, options) {
    return loadAppointments(viewMode === 'day' ? viewDate : '', email, options);
  }

  function listIsBeingEdited() {
    const active = document.activeElement;
    if (modalIsOpen()) return true;
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
      loadCurrent(staffEmail, { quiet: true });
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

  async function loadJobPhotosForDates(dates, token) {
    const unique = [...new Set((Array.isArray(dates) ? dates : []).filter(isDateValue))];
    const maps = await Promise.all(unique.map((date) => loadJobPhotos(date, token)));
    return Object.assign({}, ...maps);
  }

  async function loadJobPhotos(date, token) {
    try {
      const response = await fetch(`/.netlify/functions/admin-job-photos?date=${encodeURIComponent(date)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return {};
      const payload = await response.json();
      const map = {};
      (Array.isArray(payload.appointments) ? payload.appointments : []).forEach((item) => {
        if (item?.id) map[item.id] = item.photos || {};
      });
      return map;
    } catch (error) {
      return {};
    }
  }

  async function loadAppointments(date, email, options = {}) {
    const quiet = Boolean(options.quiet);
    const upcoming = !isDateValue(date);
    if (refreshInFlight) return;
    if (quiet && listIsBeingEdited()) return;
    refreshInFlight = true;

    try {
      const token = await getToken();
      if (!token) {
        stopAutoRefresh();
        if (isLocalDemoHost()) {
          showLocalDemo(upcoming ? '' : date);
          return;
        }
        showGate('Log in with the EastCord staff account to open the admin dashboard.');
        return;
      }

      if (!quiet) {
        setStatus(upcoming ? 'Loading upcoming appointments...' : `Loading appointments for ${date}...`);
      }
      const query = upcoming
        ? '/.netlify/functions/admin-appointments?upcoming=1'
        : `/.netlify/functions/admin-appointments?date=${encodeURIComponent(date)}`;
      const response = await fetch(query, {
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
      viewMode = upcoming ? 'upcoming' : 'day';
      viewDate = upcoming ? '' : date;
      hasMoreUpcoming = Boolean(payload.hasMore);
      setPageHeading();
      if (Array.isArray(payload.timeWindows) && payload.timeWindows.length) {
        timeWindows = payload.timeWindows;
      }
      dayAppointments = Array.isArray(payload.appointments) ? payload.appointments : [];
      const photoDates = upcoming
        ? dayAppointments.map((appointment) => appointment.preferred_date)
        : [date];
      const photoMap = await loadJobPhotosForDates(photoDates, token);
      dayAppointments.forEach((appointment) => {
        appointment.job_photos = photoMap[appointment.id] || {};
      });
      if (!upcoming) dayAppointments = withLocalDemo(dayAppointments, date);
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

  function showLocalDemo(date) {
    stopAutoRefresh();
    showDashboard('Local demo');
    viewMode = isDateValue(date) ? 'day' : 'upcoming';
    viewDate = viewMode === 'day' ? date : '';
    hasMoreUpcoming = false;
    setPageHeading();
    dayAppointments = viewMode === 'day' ? withLocalDemo([], date) : [];
    lastStatusStamp = new Date().toLocaleTimeString('en-CA', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
    applyAppointmentView();
  }

  async function handleManageClick(event) {
    const button = event.target.closest('[data-action]');
    const inList = Boolean(button && els.list?.contains(button));
    const inModal = Boolean(button && els.modalBody?.contains(button));
    if (!button || (!inList && !inModal)) return;

    const card = button.closest('[data-appointment-id]');
    const id = card?.dataset.appointmentId;
    if (!id || id === 'demo-install') return;

    const action = button.dataset.action;
    setCardFeedback(card, '');

    try {
      button.disabled = true;
      if (action === 'status') {
        await patchAppointment({ id, booking_status: button.dataset.status });
        setStatus('Appointment status updated.');
        await loadCurrent(staffEmail);
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
        const url = new URL(window.location.href);
        if (viewMode === 'day') {
          viewDate = nextDate;
          url.searchParams.set('date', nextDate);
        } else {
          url.searchParams.delete('date');
        }
        url.hash = `appt-${id}`;
        window.history.replaceState({}, '', url);
        setStatus(`Appointment moved to ${nextDate}.`);
        await loadCurrent(staffEmail);
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
        await loadCurrent(staffEmail);
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
    const client = window.EastCordAccount.getSupabaseClient?.();
    const userResult = client ? await client.auth.getUser() : null;
    const role = userResult?.data?.user?.app_metadata?.role || userResult?.data?.user?.user_metadata?.role || '';
    if (role === 'installer') {
      window.location.replace('/admin/job-photos');
      return;
    }
    const isStaff = window.EastCordAccount.isStaffAdminEmail?.(email) || email === ADMIN_EMAIL;
    if (!email) {
      if (isLocalDemoHost()) {
        const initialDate = new URLSearchParams(window.location.search).get('date') || '';
        showLocalDemo(isDateValue(initialDate) ? initialDate : '');
        return;
      }
      showGate('Log in with info@eastcordtires.ca to open the admin dashboard.');
      return;
    }

    if (!isStaff) {
      showGate('Only the EastCord staff account can open this page.');
      return;
    }

    staffEmail = email;
    const initialDate = new URLSearchParams(window.location.search).get('date') || '';
    showDashboard(email);
    await loadAppointments(isDateValue(initialDate) ? initialDate : '', email);
  }

  els.dateForm?.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  els.statusFilter?.addEventListener('change', () => {
    applyAppointmentView();
  });

  els.list?.addEventListener('click', (event) => {
    handleManageClick(event);
    toggleAppointmentFromEvent(event);
  });

  els.list?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    toggleAppointmentFromEvent(event);
  });

  els.modal?.addEventListener('click', (event) => {
    if (event.target.closest('[data-appointment-modal-close]')) {
      closeAppointmentModal();
      return;
    }
    handleManageClick(event);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modalIsOpen()) closeAppointmentModal();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || els.dashboard?.hidden || listIsBeingEdited()) return;
    loadCurrent(staffEmail, { quiet: true });
  });

  window.addEventListener('focus', () => {
    if (document.hidden || els.dashboard?.hidden || listIsBeingEdited()) return;
    loadCurrent(staffEmail, { quiet: true });
  });

  window.addEventListener('hashchange', focusAppointmentFromHash);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
