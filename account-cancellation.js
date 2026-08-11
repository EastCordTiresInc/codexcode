(() => {
  const CONTACT_EMAIL = 'info@eastcordtires.ca';
  const CONTACT_PHONE = '365-822-5553';
  const MIN_CANCEL_ADVANCE_MINUTES = 120;
  const SETUP_MESSAGE = 'Online cancellation is being connected. Please contact EastCord Tires at info@eastcordtires.ca or 365-822-5553.';
  const LATE_CANCEL_MESSAGE = 'Online cancellation is no longer available because this appointment is less than 2 hours away. Please contact EastCord Tires at info@eastcordtires.ca or 365-822-5553.';

  const baseColumns = [
    'id',
    'service_name',
    'preferred_date',
    'preferred_time_window',
    'customer_name',
    'customer_email',
    'customer_phone',
    'full_service_address',
    'city',
    'postal_code',
    'tire_size',
    'vehicle_year',
    'vehicle_make',
    'vehicle_model',
    'vehicle_plate_number',
    'vehicle_colour',
    'service_subtotal',
    'hst_amount',
    'total_with_hst',
    'deposit_amount',
    'remaining_balance',
    'booking_status',
    'payment_status',
    'stripe_session_id',
    'created_at',
  ];

  const cancellationColumns = [
    'cancelled_at',
    'cancellation_requested_at',
    'cancellation_reason',
    'cancelled_by',
  ];

  function logDeveloperError(context, error) {
    console.error(`[EastCord appointment automation] ${context}`, error);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function money(value) {
    if (window.EastCordAccount?.money) return window.EastCordAccount.money(value);
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  }

  function titleCase(value) {
    return String(value || '').trim().toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase());
  }

  function formatPlate(value) {
    return String(value || '').trim().toUpperCase();
  }

  function formatDateTime(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value));
    } catch (error) {
      return String(value);
    }
  }

  function getVehicle(booking) {
    return [booking.vehicle_year, titleCase(booking.vehicle_make), titleCase(booking.vehicle_model)].filter(Boolean).join(' ') || 'Vehicle details submitted';
  }

  function getLocation(booking) {
    return [booking.full_service_address, booking.city, booking.postal_code].filter(Boolean).join(', ') || 'Service location submitted';
  }

  function getStartMinutes(timeWindow) {
    const startText = String(timeWindow || '').split('-')[0].trim();
    const match = startText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'AM' && hours === 12) hours = 0;
    if (period === 'PM' && hours !== 12) hours += 12;
    return (hours * 60) + minutes;
  }

  function getAppointmentStartDate(booking) {
    const startMinutes = getStartMinutes(booking.preferred_time_window);
    if (!booking.preferred_date || startMinutes === null) return null;

    const startDate = new Date(`${booking.preferred_date}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return null;
    startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
    return startDate;
  }

  function getMinutesUntilAppointment(booking) {
    const startDate = getAppointmentStartDate(booking);
    if (!startDate) return null;
    return (startDate.getTime() - Date.now()) / 60000;
  }

  function canCancelOnline(booking) {
    return booking.booking_status === 'Confirmed'
      && booking.payment_status === 'paid_deposit'
      && Number(getMinutesUntilAppointment(booking)) > MIN_CANCEL_ADVANCE_MINUTES;
  }

  function isCancellationTooLate(booking) {
    return booking.booking_status === 'Confirmed'
      && booking.payment_status === 'paid_deposit'
      && Number(getMinutesUntilAppointment(booking)) <= MIN_CANCEL_ADVANCE_MINUTES;
  }

  function detailLine(label, value) {
    if (!value) return '';
    return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
  }

  async function fetchBookings() {
    const client = window.EastCordAccount?.getSupabaseClient?.();
    const profile = await window.EastCordAccount?.getCurrentProfile?.();
    if (!client || !profile?.customerId) return [];

    const columns = [...baseColumns, ...cancellationColumns].join(', ');
    let { data, error } = await client
      .from('appointment_bookings')
      .select(columns)
      .eq('customer_id', profile.customerId)
      .order('created_at', { ascending: false });

    if (error && error.code === '42703') {
      logDeveloperError('Cancellation columns are not available yet. Falling back to basic booking history.', error);
      const fallback = await client
        .from('appointment_bookings')
        .select(baseColumns.join(', '))
        .eq('customer_id', profile.customerId)
        .order('created_at', { ascending: false });
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      logDeveloperError('Customer bookings with cancellation details could not be loaded.', error);
      throw error;
    }

    return data || [];
  }

  function renderCancellationAction(booking) {
    if (booking.booking_status === 'Cancelled') {
      return `
        <p class="account-message success">This appointment was cancelled${booking.cancelled_at ? ` on ${escapeHtml(formatDateTime(booking.cancelled_at))}` : ''}.</p>
      `;
    }

    if (canCancelOnline(booking)) {
      return `
        <div class="account-actions">
          <button class="button button-secondary" type="button" data-cancel-booking="${escapeHtml(booking.id)}">Cancel Appointment</button>
        </div>
      `;
    }

    if (isCancellationTooLate(booking)) {
      return `<p class="account-message">${LATE_CANCEL_MESSAGE}</p>`;
    }

    return '';
  }

  function renderBooking(booking) {
    return `
      <article class="cart-line" data-booking-id="${escapeHtml(booking.id)}">
        <span>${escapeHtml(booking.booking_status || 'Pending Confirmation')}</span>
        <strong>${escapeHtml(booking.service_name || 'Appointment service')}</strong>
        ${detailLine('Booking status', booking.booking_status || 'Pending Confirmation')}
        ${detailLine('Payment status', booking.payment_status === 'paid_deposit' ? 'Deposit Paid' : (booking.payment_status || 'pending_checkout'))}
        ${detailLine('Vehicle', getVehicle(booking))}
        ${detailLine('Plate Number', formatPlate(booking.vehicle_plate_number) || 'Not provided')}
        ${detailLine('Colour', titleCase(booking.vehicle_colour) || 'Not provided')}
        ${detailLine('Tire Size', booking.tire_size || 'Not provided')}
        ${detailLine('Date', booking.preferred_date || '')}
        ${detailLine('Time', booking.preferred_time_window || '')}
        ${detailLine('Service Location', getLocation(booking))}
        ${detailLine('Deposit Paid', money(booking.deposit_amount))}
        ${detailLine('Remaining On-Site', money(booking.remaining_balance))}
        ${renderCancellationAction(booking)}
      </article>
    `;
  }

  function renderBookings(bookings) {
    const panel = document.querySelector('[data-booking-history]');
    if (!panel) return;

    if (!bookings.length) {
      panel.innerHTML = '<p class="empty-cart">No appointment bookings yet.</p>';
      return;
    }

    panel.innerHTML = bookings.map(renderBooking).join('');
  }

  function ensureModal() {
    let modal = document.querySelector('[data-cancel-appointment-modal]');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'agreement-modal';
    modal.dataset.cancelAppointmentModal = '';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="agreement-modal-backdrop" data-cancel-modal-close></div>
      <section class="agreement-modal-panel" role="dialog" aria-modal="true" aria-labelledby="cancel-appointment-title" tabindex="-1">
        <button class="agreement-modal-close" type="button" aria-label="Close cancellation dialog" data-cancel-modal-close>X</button>
        <div class="agreement-content">
          <h2 id="cancel-appointment-title">Cancel Appointment</h2>
          <p>Are you sure you want to cancel this appointment? Deposit refund decisions are subject to EastCord Tires' Mobile Service Agreement.</p>
          <label class="appointment-field">
            <span>Reason for cancellation</span>
            <textarea data-cancellation-reason rows="4" placeholder="Optional"></textarea>
          </label>
          <p class="account-message" data-cancellation-message></p>
          <div class="account-actions">
            <button class="button button-secondary" type="button" data-cancel-modal-close>Keep Appointment</button>
            <button class="button button-primary" type="button" data-confirm-cancellation>Confirm Cancellation</button>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function setModalMessage(message, type = 'error') {
    const messageElement = document.querySelector('[data-cancellation-message]');
    if (!messageElement) return;
    messageElement.textContent = message;
    messageElement.classList.toggle('success', type === 'success');
    messageElement.classList.toggle('error', type === 'error');
  }

  let activeBookingId = '';

  function openCancelModal(bookingId) {
    activeBookingId = bookingId;
    const modal = ensureModal();
    const reason = modal.querySelector('[data-cancellation-reason]');
    if (reason) reason.value = '';
    setModalMessage('');
    modal.hidden = false;
    document.body.classList.add('agreement-modal-open');
    modal.querySelector('.agreement-modal-panel')?.focus();
  }

  function closeCancelModal() {
    const modal = document.querySelector('[data-cancel-appointment-modal]');
    if (modal) modal.hidden = true;
    document.body.classList.remove('agreement-modal-open');
    activeBookingId = '';
  }

  async function cancelActiveBooking() {
    if (!activeBookingId) return;

    const confirmButton = document.querySelector('[data-confirm-cancellation]');
    const reason = document.querySelector('[data-cancellation-reason]')?.value?.trim() || '';
    const token = await window.EastCordAccount?.getAccessToken?.();

    if (!token) {
      setModalMessage('Please log in again before cancelling this appointment.');
      return;
    }

    try {
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.textContent = 'Cancelling...';
      }
      setModalMessage('Cancelling appointment...', 'success');

      const response = await fetch('/.netlify/functions/cancel-appointment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bookingId: activeBookingId, cancellationReason: reason }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.message || SETUP_MESSAGE);
      }

      setModalMessage('Appointment cancelled.', 'success');
      window.setTimeout(() => {
        closeCancelModal();
        hydrateCancellationHistory();
      }, 650);
    } catch (error) {
      logDeveloperError('Appointment cancellation failed.', error);
      setModalMessage(error.message || SETUP_MESSAGE);
    } finally {
      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Confirm Cancellation';
      }
    }
  }

  async function hydrateCancellationHistory() {
    const panel = document.querySelector('[data-booking-history]');
    if (!panel || !window.EastCordAccount?.getCurrentProfile) return;

    try {
      const profile = await window.EastCordAccount.getCurrentProfile();
      if (!profile) return;
      const bookings = await fetchBookings();
      renderBookings(bookings);
    } catch (error) {
      logDeveloperError('Cancellation booking history hydration failed.', error);
      panel.innerHTML = '<p>Appointment history could not be loaded right now. Please try again shortly.</p>';
    }
  }

  document.addEventListener('click', (event) => {
    const cancelButton = event.target.closest('[data-cancel-booking]');
    if (cancelButton) {
      event.preventDefault();
      openCancelModal(cancelButton.dataset.cancelBooking);
      return;
    }

    if (event.target.closest('[data-cancel-modal-close]')) {
      event.preventDefault();
      closeCancelModal();
      return;
    }

    if (event.target.closest('[data-confirm-cancellation]')) {
      event.preventDefault();
      cancelActiveBooking();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCancelModal();
  });

  document.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(hydrateCancellationHistory, 350);
    window.setTimeout(hydrateCancellationHistory, 900);
  });
})();
