(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';
  const FALLBACK_SLOTS = [
    { id: 'plate', label: 'Vehicle and plate', hint: 'Front of the vehicle with the plate readable.' },
    { id: 'sidewall', label: 'Tire sidewall', hint: 'Size and brand of the tire being installed.' },
    { id: 'before', label: 'Before the work', hint: 'The wheel on the vehicle before it comes off.' },
    { id: 'removed', label: 'Wheel removed', hint: 'The wheel or tire off the vehicle.' },
    { id: 'mounted', label: 'Tire mounted', hint: 'The tire seated on the rim.' },
    { id: 'lugs', label: 'Lug nuts', hint: 'Lugs seated, or the torque mark after they are tightened.' },
    { id: 'finished', label: 'Finished install', hint: 'The wheel back on the vehicle after the job.' },
  ];

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    form: document.querySelector('[data-admin-jobs-form]'),
    dateInput: document.querySelector('[data-admin-date]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
    photos: document.querySelector('[data-admin-photos]'),
    summary: document.querySelector('[data-admin-photo-summary]'),
    progress: document.querySelector('[data-admin-photo-progress]'),
    grid: document.querySelector('[data-admin-photo-grid]'),
    destination: document.querySelector('[data-admin-photo-destination]'),
    sendButton: document.querySelector('[data-admin-send-photos]'),
    sendFeedback: document.querySelector('[data-admin-send-feedback]'),
    sendWrap: document.querySelector('.admin-photo-send'),
    finished: document.querySelector('[data-admin-finished]'),
    finishedNote: document.querySelector('[data-admin-finished-note]'),
    finishedGrid: document.querySelector('[data-admin-finished-grid]'),
  };

  const demoPhotos = {};
  let slots = FALLBACK_SLOTS.slice();
  let appointments = [];
  let selectedId = '';
  let sending = false;

  function isLocalDemo() {
    const host = window.location.hostname;
    if (host === 'eastcordtires.ca' || host === 'www.eastcordtires.ca' || host === 'updatedeastcord.netlify.app') return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.trycloudflare.com') || host.endsWith('.loca.lt')) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);
  }

  async function loadDemoPhotos() {
    if (!isLocalDemo()) return;
    await Promise.all(FALLBACK_SLOTS.map(async (slot) => {
      if (demoPhotos[slot.id]?.url) return;
      try {
        const response = await fetch(`/local-test/job-photos/${slot.id}.jpg`, { cache: 'no-store' });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.size) return;
        if (demoPhotos[slot.id]?.url?.startsWith('blob:')) URL.revokeObjectURL(demoPhotos[slot.id].url);
        demoPhotos[slot.id] = { url: URL.createObjectURL(blob), updatedAt: new Date().toISOString() };
      } catch (error) {
        demoPhotos[slot.id] = null;
      }
    }));
  }

  function demoPhotosReady() {
    return FALLBACK_SLOTS.every((slot) => demoPhotos[slot.id]?.url);
  }

  function demoAppointment() {
    return {
      id: 'demo-install',
      demo: true,
      customer_name: 'Demo install',
      customer_email: '',
      customer_phone: '',
      service_name: 'Off-rim tire swap',
      preferred_time_window: '2:00 PM - 3:00 PM',
      booking_status: 'Confirmed',
      vehicle: '2018 Honda Civic',
      vehicle_plate_number: 'DEMO',
      tire_size: '215/45R17',
      number_of_tires: 4,
      city: 'Milton',
      photos: demoPhotos,
    };
  }

  function withDemoJob(list) {
    const jobs = Array.isArray(list) ? list.filter((item) => item.id !== 'demo-install') : [];
    if (!isLocalDemo()) return jobs;
    return [demoAppointment(), ...jobs];
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
    if (els.chrome) els.chrome.hidden = true;
    if (els.gate) els.gate.hidden = false;
    if (els.gateMessage && message) els.gateMessage.textContent = message;
  }

  function applyInstallerChrome(role) {
    if (role !== 'installer') return;
    document.querySelectorAll('.admin-tabs a').forEach((link) => {
      const href = link.getAttribute('href') || '';
      link.hidden = !href.includes('/admin/job-photos');
    });
    const brand = document.querySelector('.admin-brand');
    if (brand) brand.href = '/admin/job-photos';
    const label = document.querySelector('.admin-product-label');
    if (label) label.textContent = 'Installer';
  }

  function showDashboard(email = '') {
    if (els.loading) els.loading.hidden = true;
    if (els.gate) els.gate.hidden = true;
    if (els.dashboard) els.dashboard.hidden = false;
    if (els.chrome) els.chrome.hidden = false;
    if (els.staffEmail) els.staffEmail.textContent = email || ADMIN_EMAIL;
    document.querySelector('.admin-tabs a[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function setStatus(message, tone = '') {
    if (!els.status) return;
    els.status.textContent = message;
    els.status.dataset.tone = tone;
  }

  function savedCount(appointment) {
    return slots.filter((slot) => appointment?.photos?.[slot.id]?.url).length;
  }

  function isFinished(appointment) {
    return String(appointment?.booking_status || '') === 'Completed';
  }

  function selectedAppointment() {
    return appointments.find((item) => item.id === selectedId) || null;
  }

  function jobTitle(appointment) {
    const vehicle = appointment.vehicle || 'Vehicle not listed';
    const plate = appointment.vehicle_plate_number ? ` · ${appointment.vehicle_plate_number}` : '';
    return `${vehicle}${plate}`;
  }

  function renderList() {
    if (!els.list) return;
    if (!appointments.length) {
      els.list.innerHTML = '<p class="admin-empty">No installation jobs on this date.</p>';
      return;
    }

    els.list.innerHTML = appointments.map((appointment) => {
      const count = savedCount(appointment);
      const selected = appointment.id === selectedId ? ' is-selected' : '';
      return `
        <button class="admin-job-card${selected}${appointment.demo ? ' is-demo' : ''}" type="button" data-job-id="${escapeHtml(appointment.id)}">
          <span class="admin-appointment-time">${escapeHtml(appointment.preferred_time_window || 'Time TBD')}</span>
          ${appointment.demo ? '<span class="admin-job-demo">Demo</span>' : ''}
          ${isFinished(appointment) ? '<span class="admin-job-finished">Finished</span>' : ''}
          <strong>${escapeHtml(appointment.customer_name || 'Customer')}</strong>
          <span>${escapeHtml(appointment.service_name || 'Tire service')}</span>
          <span>${escapeHtml(jobTitle(appointment))}</span>
          <span class="admin-job-count">${isFinished(appointment) ? 'Job finished' : `${count} of ${slots.length} photos`}</span>
        </button>
      `;
    }).join('');
  }

  function renderPhotos() {
    const appointment = selectedAppointment();
    if (!appointment || !els.photos || !els.grid) {
      if (els.photos) els.photos.hidden = true;
      return;
    }

    els.photos.hidden = false;
    const count = savedCount(appointment);
    const finished = isFinished(appointment);
    if (els.grid) els.grid.hidden = finished;
    if (els.sendWrap) els.sendWrap.hidden = finished;
    if (els.finished) els.finished.hidden = !finished;
    if (finished) {
      if (els.summary) {
        els.summary.innerHTML = `
          <p class="admin-kicker">Finished job</p>
          <h2>${escapeHtml(appointment.customer_name || 'Customer')}</h2>
          <p>${escapeHtml(appointment.service_name || 'Tire service')} · ${escapeHtml(jobTitle(appointment))}</p>
        `;
      }
      if (els.progress) els.progress.textContent = 'The seven photos for this finished installation are below.';
      if (els.finishedNote) {
        els.finishedNote.textContent = appointment.demo
          ? 'Demo only. Nothing was emailed.'
          : (appointment.finishNote || 'The customer email was sent when this job was finished.');
      }
      if (els.finishedGrid) {
        els.finishedGrid.innerHTML = slots.map((slot, index) => {
          const photo = appointment.photos?.[slot.id];
          return `
            <article class="admin-photo-slot is-saved">
              <h3>${index + 1}. ${escapeHtml(slot.label)}</h3>
              ${photo?.url
                ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(slot.label)}" />`
                : '<div class="admin-photo-empty">Photo missing</div>'}
            </article>
          `;
        }).join('');
      }
      return;
    }
    if (els.summary) {
      els.summary.innerHTML = `
        <p class="admin-kicker">${escapeHtml(appointment.preferred_time_window || 'Installation')}</p>
        <h2>${escapeHtml(appointment.customer_name || 'Customer')}</h2>
        <p>${escapeHtml(appointment.service_name || 'Tire service')} · ${escapeHtml(jobTitle(appointment))}</p>
      `;
    }
    if (els.progress) {
      els.progress.textContent = count === slots.length
        ? 'All 7 photos are saved for this job.'
        : `${count} of ${slots.length} photos saved.`;
    }
    const customerEmail = String(appointment.customer_email || '').trim();
    const canEmailCustomer = customerEmail && customerEmail.toLowerCase() !== 'info@eastcordtires.ca';
    if (els.destination) {
      if (count !== slots.length) {
        els.destination.textContent = 'Save all 7 photos, then finish the job.';
      } else if (appointment.demo) {
        els.destination.textContent = 'Finish the demo to open the completed job page. Nothing is emailed.';
      } else if (canEmailCustomer) {
        els.destination.textContent = `Finish the job to keep the photos here and email them to ${customerEmail}.`;
      } else {
        els.destination.textContent = 'Finish the job to keep the photos here. This booking has no customer email.';
      }
    }
    if (els.sendButton) {
      els.sendButton.hidden = false;
      els.sendButton.disabled = sending || count !== slots.length;
    }

    els.grid.innerHTML = slots.map((slot, index) => {
      const photo = appointment.photos?.[slot.id];
      const saved = Boolean(photo?.url);
      return `
        <article class="admin-photo-slot${saved ? ' is-saved' : ''}" data-slot="${escapeHtml(slot.id)}">
          <h3>${index + 1}. ${escapeHtml(slot.label)}</h3>
          <p>${escapeHtml(slot.hint)}</p>
          ${saved
            ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(slot.label)}" />`
            : '<div class="admin-photo-empty">No photo yet</div>'}
          <label class="button button-secondary admin-photo-pick">
            ${saved ? 'Replace photo' : 'Add photo'}
            <input type="file" accept="image/*" capture="environment" data-photo-input />
          </label>
          <p class="admin-manage-feedback" data-slot-feedback hidden></p>
        </article>
      `;
    }).join('');
  }

  function render() {
    renderList();
    renderPhotos();
  }

  async function getToken() {
    return window.EastCordAccount?.getAccessToken?.();
  }

  async function request(method, payload, query = '') {
    const token = await getToken();
    if (!token) {
      if (!isLocalDemo()) showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return null;
    }

    const response = await fetch(`/.netlify/functions/admin-job-photos${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
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
      if (!isLocalDemo()) showGate(body.message || 'This account is not allowed to open the admin dashboard.');
      return null;
    }
    if (!response.ok) throw new Error(body.message || 'Installation photos could not be updated.');
    return body;
  }

  function currentDate() {
    return els.dateInput?.value || torontoToday();
  }

  async function loadJobs() {
    if (isLocalDemo()) await loadDemoPhotos();
    setStatus('Loading installation jobs...');
    try {
      const result = await request('GET', null, `?date=${encodeURIComponent(currentDate())}`);
      if (!result) {
        if (!isLocalDemo()) return;
        appointments = withDemoJob([]);
        if (!selectedId) selectedId = 'demo-install';
        setStatus(demoPhotosReady()
          ? 'Demo install has the seven dummy photos loaded. Nothing is emailed or saved.'
          : 'Demo install is ready. Add the seven photos here. Nothing is emailed.');
        render();
        return;
      }
      slots = Array.isArray(result.slots) && result.slots.length ? result.slots : FALLBACK_SLOTS;
      applyInstallerChrome(result.role);
      appointments = withDemoJob(result.appointments);
      if (selectedId && !appointments.some((item) => item.id === selectedId)) selectedId = isLocalDemo() ? 'demo-install' : '';
      const realCount = appointments.filter((item) => !item.demo).length;
      const demoNote = isLocalDemo()
        ? (demoPhotosReady()
          ? ' Demo install has the seven dummy photos loaded. Nothing is emailed or saved.'
          : ' Demo install is included.')
        : '';
      setStatus(realCount
        ? `${realCount} installation job${realCount === 1 ? '' : 's'} on this date.${demoNote}`
        : `No booked jobs on this date.${demoNote}`);
      render();
    } catch (error) {
      appointments = withDemoJob([]);
      if (!isLocalDemo()) selectedId = '';
      else if (!selectedId) selectedId = 'demo-install';
      setStatus(error.message || 'Installation jobs could not be loaded.', 'error');
      render();
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('That photo could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const maxEdge = 1600;
        const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error('That photo could not be prepared.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) reject(new Error('That photo could not be prepared.'));
          else resolve(blob);
        }, 'image/jpeg', 0.72);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Choose a photo file.'));
      };
      image.src = url;
    });
  }

  function setSlotFeedback(slotId, message, tone = '') {
    const slot = els.grid?.querySelector(`[data-slot="${CSS.escape(slotId)}"] [data-slot-feedback]`);
    if (!slot) return;
    slot.hidden = !message;
    slot.textContent = message || '';
    slot.dataset.tone = tone;
  }

  async function uploadSlot(slotId, file) {
    const appointment = selectedAppointment();
    if (!appointment) return;
    setSlotFeedback(slotId, 'Saving photo...');
    try {
      const blob = await compressImage(file);
      if (appointment.demo) {
        if (appointment.photos?.[slotId]?.url?.startsWith('blob:')) URL.revokeObjectURL(appointment.photos[slotId].url);
        appointment.photos[slotId] = { url: URL.createObjectURL(blob), updatedAt: new Date().toISOString() };
        render();
        setSlotFeedback(slotId, 'Saved on this demo job.', 'ok');
        return;
      }
      const image = await readFile(blob);
      const result = await request('POST', {
        appointmentId: appointment.id,
        slot: slotId,
        image,
      });
      if (!result?.photo) return;
      appointment.photos = appointment.photos || {};
      appointment.photos[slotId] = result.photo;
      render();
      setSlotFeedback(slotId, 'Saved.', 'ok');
    } catch (error) {
      setSlotFeedback(slotId, error.message || 'That photo could not be saved.', 'error');
    }
  }

  function setSendFeedback(message, tone = '') {
    if (!els.sendFeedback) return;
    els.sendFeedback.hidden = !message;
    els.sendFeedback.textContent = message || '';
    els.sendFeedback.dataset.tone = tone;
  }

  async function sendPhotos() {
    const appointment = selectedAppointment();
    if (!appointment || sending || isFinished(appointment) || savedCount(appointment) !== slots.length) return;
    sending = true;
    if (els.sendButton) els.sendButton.disabled = true;
    setSendFeedback(appointment.demo ? 'Finishing the demo job...' : 'Finishing the job...');
    try {
      if (appointment.demo) {
        appointment.booking_status = 'Completed';
        appointment.finishNote = 'Demo only. Nothing was emailed.';
        render();
        els.finished?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      const result = await request('POST', {
        action: 'finish',
        appointmentId: appointment.id,
      });
      if (!result) return;
      appointment.booking_status = result.booking_status || 'Completed';
      appointment.finishNote = result.message || 'Job finished.';
      render();
      els.finished?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      setSendFeedback(error.message || 'The job could not be finished.', 'error');
    } finally {
      sending = false;
      const current = selectedAppointment();
      if (els.sendButton && current && !isFinished(current)) {
        els.sendButton.disabled = savedCount(current) !== slots.length;
      }
    }
  }

  function selectJob(id) {
    selectedId = id;
    if (id) history.replaceState(null, '', `#job=${encodeURIComponent(id)}`);
    render();
    els.photos?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function initialize() {
    if (els.dateInput && !els.dateInput.value) els.dateInput.value = torontoToday();
    const hashJob = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('job')
      || new URLSearchParams(window.location.hash.slice(1)).get('job');
    if (hashJob) selectedId = hashJob;
    if (isLocalDemo()) await loadDemoPhotos();

    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      if (isLocalDemo()) {
        showDashboard('Local demo');
        appointments = withDemoJob([]);
        selectedId = 'demo-install';
        setStatus(demoPhotosReady()
          ? 'Demo install has the seven dummy photos loaded. Nothing is emailed or saved.'
          : 'Demo install is ready. Add the seven photos here. Nothing is emailed.');
        render();
        return;
      }
      showGate('Staff login is not configured yet.');
      return;
    }

    const profile = await window.EastCordAccount.getCurrentProfile?.();
    const email = String(profile?.email || '').trim().toLowerCase();
    if (!email) {
      if (isLocalDemo()) {
        showDashboard('Local demo');
        appointments = withDemoJob([]);
        selectedId = selectedId || 'demo-install';
        setStatus(demoPhotosReady()
          ? 'Demo install has the seven dummy photos loaded. Nothing is emailed or saved.'
          : 'Demo install is ready. Add the seven photos here. Nothing is emailed.');
        render();
        return;
      }
      showGate('Log in with your EastCord installer account to submit job photos.');
      return;
    }

    showDashboard(email);
    await loadJobs();
  }

  els.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    selectedId = '';
    history.replaceState(null, '', window.location.pathname);
    loadJobs();
  });

  els.list?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-job-id]');
    if (!button) return;
    selectJob(button.dataset.jobId || '');
  });

  els.sendButton?.addEventListener('click', sendPhotos);

  els.grid?.addEventListener('change', (event) => {
    const input = event.target.closest('[data-photo-input]');
    const file = input?.files?.[0];
    const slot = input?.closest('[data-slot]')?.dataset.slot;
    if (!input || !file || !slot) return;
    input.value = '';
    uploadSlot(slot, file);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
