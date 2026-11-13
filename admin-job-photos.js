(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';
  const MAX_TIRES = 8;

  function tireQuantity(value) {
    const qty = Math.floor(Number(value));
    if (!Number.isFinite(qty) || qty < 1) return 1;
    return Math.min(MAX_TIRES, qty);
  }

  const WHEEL_POSITIONS = ['FRONT RIGHT', 'FRONT LEFT', 'BACK LEFT', 'BACK RIGHT'];

  function slotsForQuantity() {
    const slots = [];
    WHEEL_POSITIONS.forEach((position, offset) => {
      const index = offset + 1;
      slots.push({
        id: `after-${index}`,
        label: `${position} after`,
        hint: 'Photo of this wheel after it is installed. Hold the phone steady and tap the wheel to focus.',
        required: true,
      });
      slots.push({
        id: `before-${index}`,
        label: `${position} before`,
        hint: 'Only if you see scratches or visible damage. Otherwise skip this photo.',
        required: false,
      });
    });
    return slots;
  }

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    form: document.querySelector('[data-admin-jobs-form]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
    photos: document.querySelector('[data-admin-photos]'),
    summary: document.querySelector('[data-admin-photo-summary]'),
    progress: document.querySelector('[data-admin-photo-progress]'),
    carMap: document.querySelector('[data-admin-car-map]'),
    grid: document.querySelector('[data-admin-photo-grid]'),
    destination: document.querySelector('[data-admin-photo-destination]'),
    sendButton: document.querySelector('[data-admin-send-photos]'),
    sendFeedback: document.querySelector('[data-admin-send-feedback]'),
    sendWrap: document.querySelector('.admin-photo-send'),
    finished: document.querySelector('[data-admin-finished]'),
    finishedNote: document.querySelector('[data-admin-finished-note]'),
    finishedGrid: document.querySelector('[data-admin-finished-grid]'),
  };

  const DEMO_QUANTITIES = [1, 2, 3, 4];
  const demoPhotoSets = {};
  let appointments = [];
  let selectedId = '';
  let sending = false;
  let openWheel = '';
  let carJobId = '';
  let scrollCarDrop = false;

  const CAR_WHEELS = [
    { index: 2, place: 'front-left', line1: 'Left', line2: 'front', name: 'Left front', position: 'FRONT LEFT' },
    { index: 1, place: 'front-right', line1: 'Right', line2: 'front', name: 'Right front', position: 'FRONT RIGHT' },
    { index: 3, place: 'back-left', line1: 'Left', line2: 'rear', name: 'Left rear', position: 'BACK LEFT' },
    { index: 4, place: 'back-right', line1: 'Right', line2: 'rear', name: 'Right rear', position: 'BACK RIGHT' },
  ];

  function isLocalDemo() {
    const host = window.location.hostname;
    if (host === 'eastcordtires.ca' || host === 'www.eastcordtires.ca' || host === 'updatedeastcord.netlify.app') return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.netlify.app')) return true;
    if (host.endsWith('.trycloudflare.com') || host.endsWith('.loca.lt')) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);
  }

  const DEMO_JOBS = [
    { qty: 1, time: '9:00 AM - 10:00 AM', vehicle: '2018 Honda Civic', plate: 'DEMO1', size: '215/45R17' },
    { qty: 2, time: '11:00 AM - 12:00 PM', vehicle: '2020 Toyota Corolla', plate: 'DEMO2', size: '205/55R16' },
    { qty: 3, time: '1:00 PM - 2:00 PM', vehicle: '2016 Ford F-150', plate: 'DEMO3', size: '265/70R17' },
    { qty: 4, time: '3:00 PM - 4:00 PM', vehicle: '2022 Hyundai Tucson', plate: 'DEMO4', size: '225/60R17' },
  ];
  const DEMO_COLORS = ['#58d68d', '#5dade2', '#e59866', '#bb8fce'];

  function demoPhoto(label, color) {
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

  function demoJobId(qty) {
    return `demo-qty-${qty}`;
  }

  function isDemoId(id) {
    return DEMO_QUANTITIES.some((qty) => id === demoJobId(qty));
  }

  function loadDemoPhotos() {
    if (!isLocalDemo()) return;
    DEMO_JOBS.forEach((job) => {
      const id = demoJobId(job.qty);
      if (demoPhotoSets[id]) return;
      const photos = {};
      for (let index = 1; index <= job.qty; index += 1) {
        const position = WHEEL_POSITIONS[index - 1] || `Tire ${index}`;
        const url = demoPhoto(`${position} after`, DEMO_COLORS[index - 1]);
        if (url) photos[`after-${index}`] = { url, updatedAt: new Date().toISOString() };
      }
      demoPhotoSets[id] = photos;
    });
  }

  function demoStatus() {
    return 'Four local demo jobs are ready, one for each tire quantity. After photos are filled in. Add a before photo only for scratches or visible damage. Nothing is emailed.';
  }

  function demoAppointments() {
    return DEMO_JOBS.map((job) => ({
      id: demoJobId(job.qty),
      demo: true,
      customer_name: job.qty === 1 ? 'Demo · 1 tire' : `Demo · ${job.qty} tires`,
      customer_email: '',
      customer_phone: '',
      service_name: 'Off-rim tire swap',
      preferred_time_window: job.time,
      booking_status: 'Confirmed',
      vehicle: job.vehicle,
      vehicle_plate_number: job.plate,
      tire_size: job.size,
      number_of_tires: job.qty,
      slots: slotsForQuantity(job.qty),
      city: 'Milton',
      photos: demoPhotoSets[demoJobId(job.qty)] || {},
    }));
  }

  function withDemoJobs(list) {
    const jobs = Array.isArray(list) ? list.filter((item) => !isDemoId(item.id)) : [];
    if (!isLocalDemo()) return jobs;
    return [...demoAppointments(), ...jobs];
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

  function jobSlots(appointment) {
    if (Array.isArray(appointment?.slots) && appointment.slots.length) return appointment.slots;
    return slotsForQuantity(appointment?.number_of_tires);
  }

  function requiredSlots(appointment) {
    return jobSlots(appointment).filter((slot) => slot.required !== false);
  }

  function requiredSavedCount(appointment) {
    return requiredSlots(appointment).filter((slot) => appointment?.photos?.[slot.id]?.url).length;
  }

  function requiredComplete(appointment) {
    const required = requiredSlots(appointment);
    return required.length > 0 && requiredSavedCount(appointment) === required.length;
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

  function detailLine(appointment) {
    const qty = tireQuantity(appointment?.number_of_tires);
    return `${appointment.service_name || 'Tire service'} · ${jobTitle(appointment)} · ${qty} tire${qty === 1 ? '' : 's'}`;
  }

  function formatJobDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
  }

  function jobWhen(appointment) {
    return [formatJobDate(appointment?.preferred_date), appointment?.preferred_time_window].filter(Boolean).join(' · ') || 'Time not set';
  }

  function jobCard(appointment) {
    const required = requiredSlots(appointment);
    const count = requiredSavedCount(appointment);
    const selected = appointment.id === selectedId ? ' is-selected' : '';
    const finished = isFinished(appointment);
    const photoLine = finished
      ? 'Job finished'
      : (appointment.photosPending ? `${tireQuantity(appointment.number_of_tires)} tire${tireQuantity(appointment.number_of_tires) === 1 ? '' : 's'}` : `${count} of ${required.length} after photos`);
    return `
      <button class="admin-job-card${selected}${appointment.demo ? ' is-demo' : ''}" type="button" data-job-id="${escapeHtml(appointment.id)}">
        <span class="admin-appointment-time">${escapeHtml(jobWhen(appointment))}</span>
        ${appointment.demo ? '<span class="admin-job-demo">Demo</span>' : ''}
        ${finished ? '<span class="admin-job-finished">Finished</span>' : ''}
        <strong>${escapeHtml(appointment.customer_name || 'Customer')}</strong>
        <span>${escapeHtml(appointment.service_name || 'Tire service')}</span>
        <span>${escapeHtml(jobTitle(appointment))}</span>
        <span class="admin-job-count">${escapeHtml(photoLine)}</span>
      </button>
    `;
  }

  function renderGroup(title, items, emptyText) {
    const body = items.length
      ? items.map(jobCard).join('')
      : `<p class="admin-empty">${escapeHtml(emptyText)}</p>`;
    return `<h2 class="admin-completed-heading">${escapeHtml(title)}</h2>${body}`;
  }

  function renderList() {
    if (!els.list) return;
    const upcoming = appointments.filter((appointment) => !isFinished(appointment));
    const completed = appointments.filter((appointment) => isFinished(appointment));
    els.list.innerHTML = [
      renderGroup('Upcoming', upcoming, 'No upcoming appointments.'),
      renderGroup('Completed', completed, 'No completed appointments yet.'),
    ].join('');
  }

  function photoSlotArticle(slot, appointment, editable) {
    const photo = appointment.photos?.[slot.id];
    const saved = Boolean(photo?.url);
    return `
      <article class="admin-photo-slot${saved ? ' is-saved' : ''}${slot.required ? '' : ' is-optional'}" data-slot="${escapeHtml(slot.id)}">
        <h3>${escapeHtml(slot.label)}${slot.required ? '' : ' <span class="admin-photo-optional">Optional</span>'}</h3>
        <p>${escapeHtml(slot.hint)}</p>
        ${saved
          ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(slot.label)}" />`
          : '<div class="admin-photo-empty">No photo yet</div>'}
        ${editable ? `
          <label class="button button-secondary admin-photo-pick">
            ${saved ? 'Replace photo' : 'Add photo'}
            <input type="file" accept="image/*" capture="environment" data-photo-input />
          </label>
          <p class="admin-manage-feedback" data-slot-feedback hidden></p>
        ` : ''}
      </article>
    `;
  }

  function slotsForWheel(appointment, index) {
    const slots = jobSlots(appointment);
    const after = slots.find((slot) => slot.id === `after-${index}`);
    const before = slots.find((slot) => slot.id === `before-${index}`);
    return [after, before].filter(Boolean);
  }

  function renderCarMap(appointment, editable) {
    if (!els.carMap) return;
    if (!appointment) {
      els.carMap.hidden = true;
      els.carMap.innerHTML = '';
      return;
    }
    if (carJobId !== appointment.id) {
      carJobId = appointment.id;
      openWheel = '';
    }
    els.carMap.hidden = false;
    const wheels = CAR_WHEELS.map((wheel) => {
      const saved = Boolean(appointment.photos?.[`after-${wheel.index}`]?.url);
      const before = Boolean(appointment.photos?.[`before-${wheel.index}`]?.url);
      const open = openWheel === String(wheel.index);
      const classes = [
        'admin-car-wheel',
        `is-${wheel.place}`,
        saved ? 'is-saved' : '',
        before ? 'has-before' : '',
        open ? 'is-open' : '',
      ].filter(Boolean).join(' ');
      return `
        <button class="${classes}" type="button" data-car-wheel="${wheel.index}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="admin-car-drop" aria-label="${escapeHtml(wheel.name)}. ${saved ? 'After photo saved.' : 'After photo needed.'}">
          <span>${escapeHtml(wheel.line1)}</span>
          <span>${escapeHtml(wheel.line2)}</span>
          <small>${saved ? 'Saved' : 'Add'}</small>
        </button>
      `;
    }).join('');
    const open = CAR_WHEELS.find((wheel) => String(wheel.index) === openWheel);
    const drop = open
      ? `
        <div class="admin-car-drop" id="admin-car-drop">
          <h3>${escapeHtml(open.name)}</h3>
          <p>${editable
            ? 'Add the after photo. Add a before photo only if you see scratches or damage.'
            : 'Saved photos for this wheel.'}</p>
          <div class="admin-car-drop-slots">
            ${slotsForWheel(appointment, open.index).map((slot) => photoSlotArticle(slot, appointment, editable)).join('')}
          </div>
        </div>
      `
      : '<p class="admin-car-hint" id="admin-car-drop">Click a tire to add the before and after photos.</p>';
    els.carMap.innerHTML = `
      <p class="admin-car-caption">Front of the car</p>
      <div class="admin-car-scene">
        <svg class="admin-car-body" viewBox="0 0 220 400" aria-hidden="true">
          <path fill="#1b2430" d="M78 34h64c18 0 28 12 32 28l10 36c8 6 16 16 16 30v36c0 10-6 16-16 20l-8 8v108l8 8c10 4 16 12 16 22v40c0 16-8 28-20 34l-6 18c-4 14-16 22-32 22H78c-16 0-28-8-32-22l-6-18c-12-6-20-18-20-34v-40c0-10 6-18 16-22l8-8V192l-8-8c-10-4-16-10-16-20v-36c0-14 8-24 16-30l10-36c4-16 14-28 32-28z"/>
          <path fill="#8eabc4" d="M86 78h48c8 10 10 22 8 36H78c-2-14 0-26 8-36z"/>
          <path fill="#6f8eaa" d="M88 286h44c6 12 6 24 0 36H88c-6-12-6-24 0-36z"/>
          <rect x="96" y="150" width="28" height="86" rx="6" fill="#121820" opacity="0.35"/>
        </svg>
        ${wheels}
      </div>
      <p class="admin-car-caption">Rear of the car</p>
      ${drop}
    `;
    if (scrollCarDrop) {
      scrollCarDrop = false;
      els.carMap.querySelector('.admin-car-drop')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderPhotos() {
    const appointment = selectedAppointment();
    if (!appointment || !els.photos || !els.grid) {
      if (els.photos) els.photos.hidden = true;
      renderCarMap(null, false);
      return;
    }

    els.photos.hidden = false;
    const photoSlots = jobSlots(appointment);
    const required = requiredSlots(appointment);
    const count = requiredSavedCount(appointment);
    const finished = isFinished(appointment);
    if (els.grid) els.grid.hidden = finished;
    if (els.sendWrap) els.sendWrap.hidden = finished;
    if (els.finished) els.finished.hidden = !finished;
    if (finished) {
      if (els.summary) {
        els.summary.innerHTML = `
          <p class="admin-kicker">Finished job</p>
          <h2>${escapeHtml(appointment.customer_name || 'Customer')}</h2>
          <p>${escapeHtml(detailLine(appointment))}</p>
        `;
      }
      if (els.progress) els.progress.textContent = 'The tire photos for this finished installation are below.';
      if (els.finishedNote) {
        els.finishedNote.textContent = appointment.demo
          ? 'Demo only. Nothing was emailed.'
          : (appointment.finishNote || 'The customer email was sent when this job was finished.');
      }
      if (els.finishedGrid) {
        els.finishedGrid.innerHTML = photoSlots.filter((slot) => appointment.photos?.[slot.id]?.url || slot.required).map((slot) => {
          const photo = appointment.photos?.[slot.id];
          return `
            <article class="admin-photo-slot is-saved">
              <h3>${escapeHtml(slot.label)}</h3>
              ${photo?.url
                ? `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(slot.label)}" />`
                : '<div class="admin-photo-empty">Photo missing</div>'}
            </article>
          `;
        }).join('');
      }
      renderCarMap(appointment, false);
      return;
    }
    if (els.summary) {
      els.summary.innerHTML = `
        <p class="admin-kicker">${escapeHtml(jobWhen(appointment))}</p>
        <h2>${escapeHtml(appointment.customer_name || 'Customer')}</h2>
        <p>${escapeHtml(detailLine(appointment))}</p>
      `;
    }
    if (els.progress) {
      const afterLabel = required.length === 1 ? 'after photo' : 'after photos';
      els.progress.textContent = count === required.length
        ? `The ${afterLabel} ${required.length === 1 ? 'is' : 'are'} saved. Add a before photo only if you see scratches or visible damage.`
        : `${count} of ${required.length} ${afterLabel} saved. A before photo is only needed for scratches or visible damage.`;
    }
    const customerEmail = String(appointment.customer_email || '').trim();
    const canEmailCustomer = customerEmail && customerEmail.toLowerCase() !== 'info@eastcordtires.ca';
    if (els.destination) {
      if (!requiredComplete(appointment)) {
        els.destination.textContent = required.length === 1
          ? 'Add the after photo, then finish the job.'
          : 'Add an after photo for FRONT RIGHT, FRONT LEFT, BACK LEFT, and BACK RIGHT, then finish the job.';
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
      els.sendButton.disabled = sending || !requiredComplete(appointment);
    }

    renderCarMap(appointment, true);
    els.grid.innerHTML = photoSlots.map((slot) => photoSlotArticle(slot, appointment, true)).join('');
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

  async function loadJobs() {
    if (isLocalDemo()) await loadDemoPhotos();
    setStatus('Loading upcoming and completed appointments...');
    try {
      const result = await request('GET', null, '?queue=1');
      if (!result) {
        if (!isLocalDemo()) return;
        appointments = withDemoJobs([]);
        if (!selectedId || !appointments.some((item) => item.id === selectedId)) selectedId = demoJobId(1);
        setStatus(demoStatus());
        render();
        return;
      }
      applyInstallerChrome(result.role);
      appointments = (Array.isArray(result.appointments) ? result.appointments : []).map((item) => ({
        ...item,
        photos: item.photos || {},
        photosPending: true,
      }));
      if (!selectedId || !appointments.some((item) => item.id === selectedId)) selectedId = '';
      const upcomingCount = appointments.filter((item) => !isFinished(item)).length;
      const completedCount = appointments.filter((item) => isFinished(item)).length;
      setStatus(`${upcomingCount} upcoming · ${completedCount} completed.`);
      render();
      if (selectedId) await ensureJobPhotos(selectedId);
    } catch (error) {
      appointments = withDemoJobs([]);
      if (!isLocalDemo()) selectedId = '';
      else if (!selectedId || !appointments.some((item) => item.id === selectedId)) selectedId = demoJobId(1);
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

  const CLARITY_SAMPLE_EDGE = 240;
  const CLARITY_MIN_EDGE = 320;
  const CLARITY_MIN_VARIANCE = 1400;
  const CLARITY_MIN_CONTRAST = 12;

  function measurePhotoClarity(imageData) {
    const width = imageData?.width || 0;
    const height = imageData?.height || 0;
    const data = imageData?.data;
    if (!data || width < CLARITY_MIN_EDGE || height < CLARITY_MIN_EDGE) {
      return {
        ok: false,
        message: 'This photo is too small to see the wheel. Move closer and take it again.',
      };
    }
    const scale = Math.min(1, CLARITY_SAMPLE_EDGE / Math.max(width, height));
    const sampledWidth = Math.max(2, Math.round(width * scale));
    const sampledHeight = Math.max(2, Math.round(height * scale));
    const gray = new Float64Array(sampledWidth * sampledHeight);
    for (let y = 0; y < sampledHeight; y += 1) {
      const sourceY = Math.min(height - 1, Math.floor(((y + 0.5) * height) / sampledHeight));
      for (let x = 0; x < sampledWidth; x += 1) {
        const sourceX = Math.min(width - 1, Math.floor(((x + 0.5) * width) / sampledWidth));
        const index = ((sourceY * width) + sourceX) * 4;
        gray[(y * sampledWidth) + x] = (0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2]);
      }
    }
    let brightness = 0;
    for (let index = 0; index < gray.length; index += 1) brightness += gray[index];
    brightness /= gray.length;
    let deviation = 0;
    for (let index = 0; index < gray.length; index += 1) {
      const delta = gray[index] - brightness;
      deviation += delta * delta;
    }
    const contrast = Math.sqrt(deviation / gray.length);
    let sum = 0;
    let sumSquares = 0;
    let lapCount = 0;
    for (let y = 1; y < sampledHeight - 1; y += 1) {
      for (let x = 1; x < sampledWidth - 1; x += 1) {
        const index = (y * sampledWidth) + x;
        const lap = gray[index - sampledWidth] + gray[index - 1] + gray[index + 1] + gray[index + sampledWidth] - (4 * gray[index]);
        sum += lap;
        sumSquares += lap * lap;
        lapCount += 1;
      }
    }
    const lapMean = sum / lapCount;
    const variance = (sumSquares / lapCount) - (lapMean * lapMean);
    if (variance < CLARITY_MIN_VARIANCE || contrast < CLARITY_MIN_CONTRAST) {
      return {
        ok: false,
        message: 'This photo is blurry or unclear. Hold the phone steady, tap the wheel to focus, and take it again.',
      };
    }
    return { ok: true, message: '' };
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
        const clarity = measurePhotoClarity(context.getImageData(0, 0, canvas.width, canvas.height));
        if (!clarity.ok) {
          URL.revokeObjectURL(url);
          reject(new Error(clarity.message));
          return;
        }
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
    const slots = els.photos?.querySelectorAll(`[data-slot="${CSS.escape(slotId)}"] [data-slot-feedback]`) || [];
    slots.forEach((slot) => {
      slot.hidden = !message;
      slot.textContent = message || '';
      slot.dataset.tone = tone;
    });
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
    if (!appointment || sending || isFinished(appointment) || !requiredComplete(appointment)) return;
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
        els.sendButton.disabled = !requiredComplete(current);
      }
    }
  }

  async function ensureJobPhotos(id) {
    const appointment = appointments.find((item) => item.id === id);
    if (!appointment || appointment.demo || !appointment.photosPending) return;
    const result = await request('GET', null, `?id=${encodeURIComponent(id)}`);
    if (!result?.appointment || selectedId !== id) return;
    appointment.photos = result.appointment.photos || {};
    if (Array.isArray(result.appointment.slots) && result.appointment.slots.length) {
      appointment.slots = result.appointment.slots;
    }
    appointment.photosPending = false;
    render();
  }

  async function selectJob(id) {
    selectedId = id;
    if (id) history.replaceState(null, '', `#job=${encodeURIComponent(id)}`);
    render();
    try {
      await ensureJobPhotos(id);
    } catch (error) {
      setStatus(error.message || 'That job could not be opened.', 'error');
    }
    els.photos?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function installerSession() {
    const client = window.EastCordAccount?.getSupabaseClient?.();
    if (!client) return null;
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user?.email) return null;
    const role = data.user.app_metadata?.role || data.user.user_metadata?.role || '';
    return {
      email: String(data.user.email).trim().toLowerCase(),
      role,
    };
  }

  async function initialize() {
    const hashJob = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('job')
      || new URLSearchParams(window.location.hash.slice(1)).get('job');
    if (hashJob) selectedId = hashJob === 'demo-install' ? demoJobId(1) : hashJob;
    if (isLocalDemo()) await loadDemoPhotos();

    if (!window.EastCordAccount?.isAuthConfigured?.()) {
      showGate('Installer login is not configured yet.');
      return;
    }

    const session = await installerSession();
    if (!session) {
      showGate('Log in with the service installer account to open job photos.');
      return;
    }
    if (session.role !== 'installer') {
      const logout = document.querySelector('[data-installer-logout]');
      if (logout) logout.hidden = false;
      showGate('Job photos opens only for the service installer login. Log out, then sign in with that account.');
      return;
    }

    applyInstallerChrome('installer');
    showDashboard(session.email);
    await loadJobs();
  }

  document.querySelector('[data-installer-logout]')?.addEventListener('click', async () => {
    const client = window.EastCordAccount?.getSupabaseClient?.();
    if (client) await client.auth.signOut();
    window.location.href = '/login.html?redirect=/admin/job-photos';
  });

  els.list?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-job-id]');
    if (!button) return;
    selectJob(button.dataset.jobId || '');
  });

  els.sendButton?.addEventListener('click', sendPhotos);

  els.photos?.addEventListener('click', (event) => {
    const wheel = event.target.closest('[data-car-wheel]');
    if (!wheel || !els.carMap?.contains(wheel)) return;
    const next = wheel.getAttribute('data-car-wheel') || '';
    openWheel = openWheel === next ? '' : next;
    scrollCarDrop = Boolean(openWheel);
    renderPhotos();
  });

  els.photos?.addEventListener('change', (event) => {
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
