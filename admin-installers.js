(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    form: document.querySelector('[data-admin-installers-form]'),
    search: document.querySelector('[data-admin-installers-search]'),
    filter: document.querySelector('[data-admin-installers-filter]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
  };

  let allApplications = [];

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function phoneHref(phone) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatList(values) {
    if (!Array.isArray(values) || !values.length) return 'None listed';
    return values.filter(Boolean).join(', ');
  }

  function currentFilter() {
    return els.filter?.value || 'new';
  }

  function statusLabel(status) {
    if (status === 'reviewed') return 'Reviewed';
    if (status === 'approved') return 'Approved';
    if (status === 'declined') return 'Declined';
    return 'New';
  }

  function statusBadgeClass(status) {
    if (status === 'reviewed') return 'is-reviewed';
    if (status === 'approved') return 'is-approved';
    if (status === 'declined') return 'is-declined';
    return 'is-new';
  }

  function filteredApplications() {
    const filter = currentFilter();
    const query = String(els.search?.value || '').trim().toLowerCase();
    return allApplications.filter((item) => {
      if (filter !== 'all' && item.status !== filter) return false;
      if (!query) return true;
      const haystack = [
        item.full_name,
        item.email,
        item.phone,
        item.alternate_phone,
        item.city,
        item.service_area,
        item.notes,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function applyView() {
    const visible = filteredApplications();
    const filter = currentFilter();
    setStatus(
      allApplications.length === 0
        ? 'No installer applications yet.'
        : visible.length === allApplications.length
          ? `${allApplications.length === 1 ? '1 application' : `${allApplications.length} applications`}`
          : `Showing ${visible.length} of ${allApplications.length}${filter === 'all' ? '' : ` · ${statusLabel(filter)}`}`,
    );
    renderApplications(visible);
  }

  function nextActions(status) {
    if (status === 'approved' || status === 'declined') {
      return `<button class="button button-secondary" type="button" data-action="status" data-status="reviewed">Move back to reviewed</button>`;
    }
    if (status === 'reviewed') {
      return `
        <button class="button button-primary" type="button" data-action="status" data-status="approved">Approve</button>
        <button class="button button-secondary" type="button" data-action="status" data-status="declined">Decline</button>
      `;
    }
    return `
      <button class="button button-primary" type="button" data-action="status" data-status="reviewed">Mark reviewed</button>
      <button class="button button-secondary" type="button" data-action="status" data-status="approved">Approve</button>
      <button class="button button-secondary" type="button" data-action="status" data-status="declined">Decline</button>
    `;
  }

  function renderApplications(applications) {
    if (!els.list) return;
    if (!applications.length) {
      els.list.innerHTML = currentFilter() === 'all'
        ? '<p class="admin-empty">No installer applications yet. New forms from /installer-application will show here.</p>'
        : '<p class="admin-empty">No applications match this filter.</p>';
      return;
    }

    els.list.innerHTML = applications.map((item) => {
      const id = String(item.id);
      const phone = item.phone || '';
      const email = item.email || '';
      const location = [item.city, item.province, item.postal_code].filter(Boolean).join(', ');
      return `
        <article class="admin-appointment admin-order admin-installer" data-application-id="${escapeHtml(id)}">
          <div class="admin-appointment-top">
            <div>
              <p class="admin-appointment-time">${escapeHtml(item.full_name || 'Technician')}</p>
              <p class="admin-appointment-service">${escapeHtml(item.work_types || 'Service calls')} · ${escapeHtml(location || 'Location not provided')} · Applied ${escapeHtml(formatDate(item.created_at) || 'date unknown')}</p>
            </div>
            <div class="admin-badges">
              <span class="admin-badge ${statusBadgeClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            </div>
          </div>
          <div class="admin-grid">
            <div><span>Phone</span>${phone ? `<a href="${escapeHtml(phoneHref(phone))}">${escapeHtml(phone)}</a>` : '<strong>Not provided</strong>'}</div>
            <div><span>Email</span>${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '<strong>Not provided</strong>'}</div>
            ${item.alternate_phone ? `<div><span>Alt phone</span><a href="${escapeHtml(phoneHref(item.alternate_phone))}">${escapeHtml(item.alternate_phone)}</a></div>` : ''}
            <div><span>Experience</span><strong>${escapeHtml(item.years_experience || 'Not provided')}</strong></div>
            <div><span>Licensed / Red Seal</span><strong>${escapeHtml(item.licensed_technician || 'Not provided')}</strong></div>
            <div><span>Jobs / week</span><strong>${escapeHtml(item.jobs_per_week || 'Not provided')}</strong></div>
            <div><span>Coverage</span><strong>${escapeHtml(item.service_area || 'Not provided')}</strong></div>
            ${item.travel_radius ? `<div><span>Travel radius</span><strong>${escapeHtml(item.travel_radius)}</strong></div>` : ''}
            <div><span>Weekdays</span><strong>${escapeHtml(item.weekday_hours || 'Not provided')}</strong></div>
            ${item.saturday_hours ? `<div><span>Saturday</span><strong>${escapeHtml(item.saturday_hours)}</strong></div>` : ''}
            ${item.sunday_hours ? `<div><span>Sunday</span><strong>${escapeHtml(item.sunday_hours)}</strong></div>` : ''}
            <div><span>After hours</span><strong>${escapeHtml(item.after_hours || 'Not provided')}</strong></div>
            <div><span>Insurance</span><strong>${escapeHtml([item.liability_insurance, item.liability_coverage].filter(Boolean).join(' · ') || 'Not provided')}</strong></div>
            <div><span>WSIB</span><strong>${escapeHtml(item.wsib_coverage || 'Not provided')}</strong></div>
            <div class="admin-grid-span"><span>Services</span><strong>${escapeHtml(formatList(item.services))}</strong></div>
            <div class="admin-grid-span"><span>Vehicles</span><strong>${escapeHtml(formatList(item.vehicles))}</strong></div>
            <div class="admin-grid-span"><span>Equipment</span><strong>${escapeHtml(formatList(item.equipment))}</strong></div>
            ${item.gst_hst_number ? `<div><span>GST / HST</span><strong>${escapeHtml(item.gst_hst_number)}</strong></div>` : ''}
            ${item.referral_source ? `<div><span>Heard about us</span><strong>${escapeHtml(item.referral_source)}</strong></div>` : ''}
            ${item.notes ? `<div class="admin-grid-span"><span>Applicant notes</span><strong>${escapeHtml(item.notes)}</strong></div>` : ''}
          </div>
          <div class="admin-manage">
            <div class="admin-manage-block">
              <p class="admin-manage-label">Review</p>
              <div class="admin-manage-actions">
                ${nextActions(item.status)}
              </div>
            </div>
            <label class="admin-installer-note">
              Staff note
              <textarea data-staff-note rows="2" placeholder="Internal note for this technician">${escapeHtml(item.staff_note || '')}</textarea>
            </label>
            <div class="admin-manage-actions">
              <button class="button button-secondary" type="button" data-action="saveNote">Save note</button>
            </div>
            <p class="admin-manage-feedback" data-manage-feedback hidden></p>
          </div>
        </article>
      `;
    }).join('');
  }

  function setCardFeedback(card, message, tone = '') {
    const feedback = card?.querySelector('[data-manage-feedback]');
    if (!feedback) return;
    feedback.hidden = !message;
    feedback.textContent = message || '';
    feedback.dataset.tone = tone;
  }

  async function getToken() {
    return window.EastCordAccount?.getAccessToken?.();
  }

  async function request(method, payload) {
    const token = await getToken();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return null;
    }

    const response = await fetch('/.netlify/functions/admin-installer-applications', {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
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
    if (response.status === 501 || body.setupRequired) {
      throw new Error(body.message || 'Run supabase/installer-applications.sql in the Supabase SQL Editor.');
    }
    if (!response.ok) {
      throw new Error(body.message || 'Installer applications could not be updated.');
    }
    return body;
  }

  async function loadApplications() {
    setStatus('Loading installer applications...');
    try {
      const result = await request('GET');
      if (!result) return;
      allApplications = Array.isArray(result.applications) ? result.applications : [];
      applyView();
    } catch (error) {
      allApplications = [];
      setStatus(error.message || 'Installer applications could not be loaded.', 'error');
      if (els.list) {
        els.list.innerHTML = `<p class="admin-empty">${escapeHtml(error.message || 'Installer applications could not be loaded.')}</p>`;
      }
    }
  }

  async function handleAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('[data-application-id]');
    const id = card?.dataset.applicationId;
    if (!id) return;

    const action = button.dataset.action;
    const payload = { id };
    if (action === 'status') payload.status = button.dataset.status;
    if (action === 'saveNote') payload.staff_note = card.querySelector('[data-staff-note]')?.value || '';

    button.disabled = true;
    setCardFeedback(card, action === 'saveNote' ? 'Saving note...' : 'Updating...');
    try {
      const result = await request('PATCH', payload);
      if (!result?.application) return;
      allApplications = allApplications.map((item) => (item.id === result.application.id ? result.application : item));
      applyView();
      const nextCard = els.list?.querySelector(`[data-application-id="${CSS.escape(id)}"]`);
      setCardFeedback(nextCard, result.message || 'Saved.', 'ok');
    } catch (error) {
      setCardFeedback(card, error.message || 'Could not update this application.', 'error');
      button.disabled = false;
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

    showDashboard(email);
    await loadApplications();
  }

  els.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    applyView();
  });
  els.search?.addEventListener('input', applyView);
  els.filter?.addEventListener('change', applyView);
  els.list?.addEventListener('click', handleAction);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
