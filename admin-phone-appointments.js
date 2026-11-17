(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';
  const TIME_WINDOWS = Object.freeze([
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
  ]);
  const QUANTITY_SERVICES = new Set([
    'on-rim-swap',
    'off-rim-swap',
    'balancing',
    'flat-patch-plug',
    'flat-plug-only',
  ]);

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
    form: document.querySelector('[data-phone-form]'),
    formStatus: document.querySelector('[data-phone-form-status]'),
    service: document.querySelector('[data-phone-service]'),
    qtyField: document.querySelector('[data-phone-qty-field]'),
    qty: document.querySelector('[data-phone-qty]'),
    sizeField: document.querySelector('[data-phone-size-field]'),
    sizeMark: document.querySelector('[data-phone-size-mark]'),
    size: document.querySelector('[data-phone-size]'),
    summary: document.querySelector('[data-phone-summary]'),
    pay: document.querySelector('[data-phone-pay]'),
    link: document.querySelector('[data-phone-link]'),
    date: document.querySelector('[data-phone-date]'),
    time: document.querySelector('[data-phone-time]'),
    addressField: document.querySelector('[data-phone-address-field]'),
    cityField: document.querySelector('[data-phone-city-field]'),
    postalField: document.querySelector('[data-phone-postal-field]'),
  };

  let location = 'shop';
  let bookedTimes = new Set();

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '$0.00';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
  }

  function field(selector) {
    return String(document.querySelector(selector)?.value || '').trim();
  }

  function rimSizeLabel() {
    const select = els.size;
    const value = String(select?.value || '').trim();
    if (!value) return '';
    return String(select.selectedOptions?.[0]?.textContent || value).trim();
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

  function setFormStatus(message, tone = '') {
    if (!els.formStatus) return;
    els.formStatus.textContent = message;
    els.formStatus.dataset.tone = tone;
  }

  function phoneHref(phone) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
  }

  function torontoToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  function windowStartMinutes(value) {
    const startText = String(value || '').split(/\s*[-–—]\s*/)[0].trim();
    const match = startText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3].toUpperCase();
    if (period === 'AM' && hours === 12) hours = 0;
    if (period === 'PM' && hours !== 12) hours += 12;
    return (hours * 60) + minutes;
  }

  function quote() {
    const services = window.EastCordAppointmentServices;
    const serviceId = field('[data-phone-service]');
    if (!services || !serviceId) return null;
    const selection = { id: serviceId, quantity: Number(els.qty?.value || 1) };
    if (serviceId === 'off-rim-swap') {
      const sizeBand = field('[data-phone-size]');
      if (!sizeBand) return null;
      selection.sizeBand = sizeBand;
    }
    const priced = services.calculateSelections([selection]);
    if (!priced?.totalWithHst) return null;
    return priced;
  }

  function syncServiceFields() {
    const serviceId = field('[data-phone-service]');
    const needsQty = QUANTITY_SERVICES.has(serviceId);
    const needsSize = serviceId === 'off-rim-swap';
    if (els.qtyField) els.qtyField.hidden = !needsQty;
    if (els.sizeField) els.sizeField.hidden = !needsSize;
    if (els.sizeMark) els.sizeMark.hidden = !needsSize;
    if (els.qty) els.qty.required = needsQty;
    if (els.size) els.size.required = needsSize;
  }

  function syncLocationFields() {
    const mobile = location === 'mobile';
    [els.addressField, els.cityField, els.postalField].forEach((node) => {
      if (node) node.hidden = !mobile;
    });
    document.querySelectorAll('[data-phone-location]').forEach((button) => {
      const selected = button.dataset.phoneLocation === location;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function buttonsBusy() {
    return els.pay?.dataset.busy === 'true' || els.link?.dataset.busy === 'true';
  }

  const PAYMENT_REFRESH_MS = 15000;
  let paymentRefreshTimer = null;
  let paymentRefreshInFlight = false;
  let paymentListSignature = '';

  function paymentSignature(rows) {
    return rows.map((row) => [
      row.id,
      row.payment_status,
      row.booking_status,
      row.updated_at,
      phoneStatusLabel(row),
    ].join(':')).join('|');
  }

  function syncSummary() {
    syncServiceFields();
    const priced = quote();
    const busy = buttonsBusy();
    if (!priced || !els.summary || !els.pay) {
      if (els.summary) {
        els.summary.hidden = true;
        els.summary.innerHTML = '';
      }
      if (els.pay && !busy) {
        els.pay.disabled = true;
        els.pay.textContent = 'Book and pay';
      }
      if (els.link && !busy) els.link.disabled = true;
      return;
    }
    els.summary.hidden = false;
    els.summary.innerHTML = `
      <p><span>Service</span><span>${escapeHtml(money(priced.serviceSubtotal))}</span></p>
      <p><span>HST (13%)</span><span>${escapeHtml(money(priced.hstAmount))}</span></p>
      <p class="is-total"><span>Full amount</span><span>${escapeHtml(money(priced.totalWithHst))}</span></p>
    `;
    if (busy) return;
    els.pay.disabled = false;
    els.pay.textContent = `Book and pay ${money(priced.totalWithHst)}`;
    if (els.link) els.link.disabled = false;
  }

  function renderTimes() {
    if (!els.time) return;
    const selected = els.time.value;
    const today = torontoToday();
    const date = field('[data-phone-date]');
    const advanceMinutes = location === 'shop' ? 60 : 120;
    const cutoff = Date.now() + (advanceMinutes * 60 * 1000);
    els.time.innerHTML = ['<option value="">Choose a time</option>'].concat(TIME_WINDOWS.map((windowLabel) => {
      const start = windowStartMinutes(windowLabel);
      const key = `${date}__${windowLabel}__${location}`;
      let disabled = bookedTimes.has(key);
      let label = windowLabel;
      if (bookedTimes.has(key)) label = `${windowLabel} (booked)`;
      if (date && date === today && start !== null) {
        const [year, month, day] = date.split('-').map(Number);
        const hours = Math.floor(start / 60);
        const minutes = start % 60;
        const localGuess = new Date(year, month - 1, day, hours, minutes, 0);
        if (localGuess.getTime() < cutoff) {
          disabled = true;
          label = `${windowLabel} (too soon)`;
        }
      }
      const selectedAttr = windowLabel === selected && !disabled ? ' selected' : '';
      return `<option value="${escapeHtml(windowLabel)}"${disabled ? ' disabled' : ''}${selectedAttr}>${escapeHtml(label)}</option>`;
    })).join('');
    if (els.time.selectedOptions[0]?.disabled) els.time.value = '';
  }

  async function loadBookedTimes() {
    const date = field('[data-phone-date]');
    bookedTimes = new Set();
    if (!date) {
      renderTimes();
      return;
    }
    try {
      const response = await fetch(`/.netlify/functions/get-appointment-booked-slots?date=${encodeURIComponent(date)}`);
      const data = await response.json().catch(() => ({}));
      bookedTimes = new Set(Array.isArray(data.slots) ? data.slots : []);
    } catch (error) {
      bookedTimes = new Set();
    }
    renderTimes();
  }

  function customerFromForm() {
    const name = `${field('[data-phone-first]')} ${field('[data-phone-last]')}`.trim();
    const email = field('[data-phone-email]');
    const phone = field('[data-phone-phone]');
    if (!name || !email || phone.replace(/\D/g, '').length < 10) {
      return { ok: false, message: 'Enter the customer name, email, and a 10-digit phone number.' };
    }
    if (email.toLowerCase() === ADMIN_EMAIL) {
      return { ok: false, message: 'Enter the customer email, not the staff login.' };
    }
    return { ok: true, customer: { name, email, phone } };
  }

  function bookingFromForm() {
    const priced = quote();
    const payer = customerFromForm();
    if (!payer.ok) return payer;
    if (!priced) return { ok: false, message: 'Choose a service before booking.' };
    const plate = field('[data-phone-plate]');
    if (plate.length < 2) return { ok: false, message: 'Enter the license plate.' };
    const date = field('[data-phone-date]');
    const time = field('[data-phone-time]');
    if (!date || !time) return { ok: false, message: 'Choose an appointment date and time.' };
    const mobile = location === 'mobile';
    const address = mobile ? field('[data-phone-address]') : '600 Harrop Drive';
    const city = mobile ? field('[data-phone-city]') : 'Milton';
    const postal = mobile ? field('[data-phone-postal]') : '';
    if (mobile && (!address || !city || postal.length < 3)) {
      return { ok: false, message: 'Enter the mobile service address, city, and postal code.' };
    }
    const quantity = QUANTITY_SERVICES.has(priced.selections[0]?.id)
      ? String(priced.selections[0].quantity)
      : '1';
    const onRims = priced.selections.some((selection) => selection.id === 'on-rim-swap') ? 'Yes' : 'No';
    return {
      ok: true,
      priced,
      customer: payer.customer,
      item: {
        id: `appointment-${Date.now()}`,
        type: 'appointment',
        bookingId: `pending-${Date.now()}`,
        customerName: payer.customer.name,
        customerEmail: payer.customer.email,
        customerPhone: payer.customer.phone,
        serviceId: priced.id,
        serviceName: priced.name,
        serviceSelections: priced.selections,
        startingPrice: priced.serviceSubtotal,
        serviceSubtotal: priced.serviceSubtotal,
        hstAmount: priced.hstAmount,
        totalWithHst: priced.totalWithHst,
        taxRate: priced.taxRate,
        depositAmount: priced.totalWithHst,
        remainingBalance: 0,
        preferredDate: date,
        preferredTimeWindow: time,
        vehiclePlateNumber: plate,
        tireSize: priced.selections.some((selection) => selection.id === 'on-rim-swap') ? '' : rimSizeLabel(),
        tiresAlreadyOnRims: onRims,
        numberOfTires: quantity,
        fullServiceAddress: address,
        city,
        postalCode: postal,
        parkingAccessNotes: mobile
          ? 'Booked by phone for mobile service.'
          : 'Booked by phone. Customer will bring the vehicle to the EastCord shop at 600 Harrop Drive, Milton, Ontario.',
        installLocation: location,
        additionalNotes: ['Phone appointment.', field('[data-phone-notes]')].filter(Boolean).join(' '),
        bookingStatus: 'Pending Confirmation',
        paymentStatus: 'pending_checkout',
      },
    };
  }

  function resetBookingForm() {
    els.form?.reset();
    location = 'shop';
    syncLocationFields();
    renderTimes();
    syncSummary();
  }

  async function bookAppointment(mode, event) {
    event.preventDefault();
    if (buttonsBusy()) return;
    const sendLink = mode === 'link';
    const booking = bookingFromForm();
    if (!booking.ok) {
      setFormStatus(booking.message, 'error');
      return;
    }
    const token = await window.EastCordAccount?.getAccessToken?.();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return;
    }
    const active = sendLink ? els.link : els.pay;
    if (els.pay) els.pay.disabled = true;
    if (els.link) els.link.disabled = true;
    if (els.pay) els.pay.dataset.busy = sendLink ? '' : 'true';
    if (els.link) els.link.dataset.busy = sendLink ? 'true' : '';
    if (active) active.textContent = sendLink ? 'Sending link…' : 'Opening payment…';
    setFormStatus(sendLink
      ? 'Saving the phone appointment and texting the payment link. It is confirmed only after they pay.'
      : 'Saving the phone appointment and opening the EastCord Tires card payment.');
    try {
      const response = await fetch('/.netlify/functions/create-appointment-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          phoneAppointment: true,
          payInFull: true,
          sendPaymentLink: sendLink,
          items: [booking.item],
          customer: booking.customer,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || 'The appointment could not be booked.');
      }
      if (sendLink) {
        if (els.pay) els.pay.dataset.busy = '';
        if (els.link) els.link.dataset.busy = '';
        const sent = [
          data.texted ? `texted to ${booking.customer.phone}` : '',
          data.emailed ? `emailed to ${booking.customer.email}` : '',
        ].filter(Boolean).join(' and ');
        const warning = data.message ? ` ${data.message}` : '';
        const link = data.link
          ? ` <a href="${escapeHtml(data.link)}">Open the payment link</a>`
          : '';
        if (els.formStatus) {
          els.formStatus.dataset.tone = data.texted ? '' : 'error';
          els.formStatus.innerHTML = sent
            ? `${escapeHtml(`Payment link ${sent}. It stays unconfirmed until they pay.${warning}`)}${data.texted ? '' : link}`
            : `${escapeHtml(data.message || 'The payment link could not be texted or emailed.')}${link}`;
        }
        resetBookingForm();
        await loadAppointments();
        return;
      }
      if (!data.url) throw new Error(data.message || 'The EastCord Tires card payment could not be opened.');
      window.location.assign(data.url);
    } catch (error) {
      setFormStatus(error.message || 'The appointment could not be booked.', 'error');
      if (els.pay) els.pay.dataset.busy = '';
      if (els.link) els.link.dataset.busy = '';
      syncSummary();
    }
  }

  function phoneStatusLabel(row) {
    const booking = String(row.booking_status || '');
    const payment = String(row.payment_status || '');
    if (booking === 'Cancelled' || booking === 'Completed' || booking === 'No-Show') return booking;
    const paid = payment === 'paid_in_full' || payment === 'paid_deposit';
    if (!paid) {
      const created = Date.parse(row.created_at || '');
      if (Number.isFinite(created) && Date.now() >= created + (2 * 60 * 60 * 1000)) return 'Link expired';
      return 'Awaiting payment';
    }
    if (/\[desk\]/i.test(String(row.additional_notes || ''))) return 'Booked';
    return 'Confirmed';
  }

  function phoneStatusTone(label) {
    if (label === 'Awaiting payment') return 'is-waiting';
    if (label === 'Link expired') return 'is-expired';
    if (label === 'Booked' || label === 'Confirmed') return 'is-confirmed';
    if (label === 'Completed') return 'is-completed';
    if (label === 'Cancelled') return 'is-cancelled';
    if (label === 'No-Show') return 'is-noshow';
    return 'is-pending-status';
  }

  function formatPhoneDisplay(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
    return String(phone || '').trim();
  }

  function formatPhoneWhen(date, time) {
    const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    let dateLabel = date || 'Date not set';
    if (match) {
      const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      dateLabel = `${weekdays[utc.getUTCDay()]}, ${months[utc.getUTCMonth()]} ${utc.getUTCDate()}`;
    }
    const raw = String(time || '').trim();
    const parts = raw.split(/\s*-\s+/);
    let timeLabel = raw || 'Time not set';
    if (parts.length === 2) {
      const startMeridiem = parts[0].match(/\s*(AM|PM)$/i);
      const endMeridiem = parts[1].match(/\s*(AM|PM)$/i);
      const start = startMeridiem && endMeridiem && startMeridiem[1].toUpperCase() === endMeridiem[1].toUpperCase()
        ? parts[0].replace(/\s*(AM|PM)$/i, '')
        : parts[0];
      timeLabel = `${start}–${parts[1]}`;
    }
    return `${dateLabel} · ${timeLabel}`;
  }

  function render(appointments) {
    if (!els.list) return;
    if (!appointments.length) {
      els.list.innerHTML = '<p class="admin-empty">No phone appointments yet.</p>';
      setStatus('No phone appointments yet.');
      return;
    }
    els.list.innerHTML = appointments.map((row) => {
      const href = phoneHref(row.customer_phone);
      const phoneText = formatPhoneDisplay(row.customer_phone) || 'No phone number';
      const phone = href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(phoneText)}</a>`
        : escapeHtml(phoneText);
      const place = String(row.install_location || '').toLowerCase() === 'shop'
        ? 'EastCord shop'
        : [row.full_service_address, row.city].filter(Boolean).join(', ') || 'Place not set';
      const status = phoneStatusLabel(row);
      const tone = phoneStatusTone(status);
      const plate = String(row.vehicle_plate_number || '').trim() || 'No plate';
      return `
        <article class="admin-phone-card ${tone}">
          <div class="admin-phone-card-top">
            <div>
              <p class="admin-phone-card-when">${escapeHtml(formatPhoneWhen(row.preferred_date, row.preferred_time_window))}</p>
              <h3>${escapeHtml(row.customer_name || 'Customer')}</h3>
            </div>
            <span class="admin-badge ${tone}">${escapeHtml(status)}</span>
          </div>
          <dl class="admin-phone-card-facts">
            <div>
              <dt>Phone</dt>
              <dd>${phone}</dd>
            </div>
            <div>
              <dt>Plate</dt>
              <dd>${escapeHtml(plate)}</dd>
            </div>
            <div>
              <dt>Service</dt>
              <dd>${escapeHtml(row.service_name || 'Service not set')}</dd>
            </div>
            <div>
              <dt>Place</dt>
              <dd>${escapeHtml(place)}</dd>
            </div>
          </dl>
        </article>
      `;
    }).join('');
    setStatus(`${appointments.length} phone appointment${appointments.length === 1 ? '' : 's'}.`);
  }

  let paymentRefreshChain = Promise.resolve();

  function loadAppointments(options = {}) {
    const job = paymentRefreshChain.then(() => fetchAppointments(options));
    paymentRefreshChain = job.catch(() => {});
    return job;
  }

  async function fetchAppointments(options = {}) {
    const quiet = options.quiet === true;
    const token = await window.EastCordAccount?.getAccessToken?.();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return;
    }
    if (!quiet) setStatus('Loading phone appointments...');
    paymentRefreshInFlight = true;
    try {
      const response = await fetch('/.netlify/functions/admin-appointments?phone=1', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data.message || 'Phone appointments could not be loaded.', 'error');
        return;
      }
      const appointments = Array.isArray(data.appointments) ? data.appointments : [];
      const signature = paymentSignature(appointments);
      if (quiet && signature === paymentListSignature) return;
      paymentListSignature = signature;
      render(appointments);
    } finally {
      paymentRefreshInFlight = false;
    }
  }

  function watchForPayments() {
    if (paymentRefreshTimer) return;
    paymentRefreshTimer = setInterval(() => {
      if (document.hidden || els.dashboard?.hidden || buttonsBusy()) return;
      loadAppointments({ quiet: true });
    }, PAYMENT_REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || els.dashboard?.hidden || buttonsBusy()) return;
      loadAppointments({ quiet: true });
    });
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
    showDashboard(email);
    if (els.date) els.date.min = torontoToday();
    renderTimes();
    syncLocationFields();
    syncSummary();
    await loadAppointments();
    watchForPayments();
  }

  els.form?.addEventListener('submit', (event) => bookAppointment('pay', event));
  els.link?.addEventListener('click', (event) => bookAppointment('link', event));
  els.form?.addEventListener('input', syncSummary);
  els.form?.addEventListener('change', syncSummary);
  els.date?.addEventListener('change', loadBookedTimes);
  document.querySelectorAll('[data-phone-location]').forEach((button) => {
    button.addEventListener('click', () => {
      location = button.dataset.phoneLocation === 'mobile' ? 'mobile' : 'shop';
      syncLocationFields();
      renderTimes();
    });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
