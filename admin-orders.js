(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    form: document.querySelector('[data-admin-orders-form]'),
    search: document.querySelector('[data-admin-orders-search]'),
    filter: document.querySelector('[data-admin-orders-filter]'),
    status: document.querySelector('[data-admin-status]'),
    list: document.querySelector('[data-admin-list]'),
  };

  const MOCK_USED_ORDERS = [
    {
      id: 'mock-used-waiting',
      isMock: true,
      tireKind: 'Used',
      customer_name: 'Jordan Patel',
      customer_phone: '3655550142',
      customer_email: 'jordan.patel@example.com',
      fulfillment_preference: 'Pickup',
      fulfillment_status: 'paid_ready',
      paid_at: '2026-09-18T15:12:00.000Z',
      total_with_hst: 240,
      items: [
        { brand: 'Michelin', size: '225/45R17', qty: 2 },
        { brand: 'Hankook', size: '225/45R17', qty: 2 },
      ],
    },
    {
      id: 'mock-used-ready',
      isMock: true,
      tireKind: 'Used',
      customer_name: 'Ava Thompson',
      customer_phone: '4165550188',
      customer_email: 'ava.thompson@example.com',
      fulfillment_preference: 'Pickup',
      fulfillment_status: 'ready_for_pickup',
      pickup_ready_emailed_at: '2026-09-20T18:05:00.000Z',
      paid_at: '2026-09-16T13:40:00.000Z',
      total_with_hst: 160,
      items: [
        { brand: 'Continental', size: '205/55R16', qty: 4 },
      ],
    },
    {
      id: 'mock-used-picked-up',
      isMock: true,
      tireKind: 'Used',
      customer_name: 'Chris Nguyen',
      customer_phone: '9055550174',
      customer_email: 'chris.nguyen@example.com',
      fulfillment_preference: 'Installation',
      fulfillment_status: 'picked_up',
      picked_up_at: '2026-09-14T16:20:00.000Z',
      paid_at: '2026-09-12T11:08:00.000Z',
      total_with_hst: 320,
      items: [
        { brand: 'Goodyear', size: '265/70R17', qty: 4 },
      ],
    },
  ];

  let allOrders = [];

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

  function itemLines(order) {
    const used = order.tireKind === 'Used';
    return (Array.isArray(order.items) ? order.items : []).map((item) => {
      const qty = Math.max(1, Number(item.qty) || 1);
      const label = used
        ? [item.brand, item.size || item.tire_size].filter(Boolean).join(' ') || 'Used tire'
        : [item.brand, item.model, item.size].filter(Boolean).join(' ') || 'New tire';
      return `${qty} × ${label}`;
    });
  }

  function fulfillmentOf(order) {
    return order.fulfillment_preference === 'Installation' ? 'Installation' : 'Pickup';
  }

  function statusBucket(order) {
    const status = String(order.fulfillment_status || '').toLowerCase();
    if (status === 'picked_up' || status === 'completed') return 'picked_up';
    if (status === 'ready_for_pickup' || status === 'arrived' || order.pickup_ready_emailed_at) return 'ready';
    return 'waiting';
  }

  function statusLabel(order) {
    const bucket = statusBucket(order);
    if (bucket === 'picked_up') return 'Picked up';
    if (bucket === 'ready') {
      return fulfillmentOf(order) === 'Installation' ? 'Tires arrived' : 'Ready for pickup';
    }
    return 'Waiting for tires';
  }

  function statusBadgeClass(order) {
    const bucket = statusBucket(order);
    if (bucket === 'picked_up') return 'is-complete';
    if (bucket === 'ready') return 'is-paid';
    return 'is-pending';
  }

  function currentFilter() {
    return els.filter?.value || 'waiting';
  }

  function filteredOrders() {
    const filter = currentFilter();
    const query = String(els.search?.value || '').trim().toLowerCase();
    return allOrders.filter((order) => {
      if (filter !== 'all' && statusBucket(order) !== filter) return false;
      if (!query) return true;
      const haystack = [
        order.customer_name,
        order.customer_email,
        order.customer_phone,
        order.tireconnect_order_number,
        order.tireKind,
        fulfillmentOf(order),
        ...itemLines(order),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function applyView() {
    const visible = filteredOrders();
    const filter = currentFilter();
    setStatus(
      allOrders.length === 0
        ? 'No paid tire orders yet.'
        : visible.length === allOrders.length
          ? `${allOrders.length === 1 ? '1 paid order' : `${allOrders.length} paid orders`}`
          : `Showing ${visible.length} of ${allOrders.length}${filter === 'all' ? '' : ` · ${filter.replace('_', ' ')}`}`,
    );
    renderOrders(visible);
  }

  function renderOrders(orders) {
    if (!els.list) return;
    if (!orders.length) {
      els.list.innerHTML = currentFilter() === 'all'
        ? '<p class="admin-empty">No paid tire orders yet.</p>'
        : '<p class="admin-empty">No orders match this filter.</p>';
      return;
    }

    els.list.innerHTML = orders.map((order) => {
      const id = String(order.id);
      const phone = order.customer_phone || '';
      const email = order.customer_email || '';
      const lines = itemLines(order);
      const bucket = statusBucket(order);
      const fulfillment = fulfillmentOf(order);
      const readyLabel = fulfillment === 'Installation'
        ? 'Tires arrived — email customer'
        : 'Tires arrived — email customer';
      const actions = bucket === 'picked_up'
        ? ''
        : `
          <div class="admin-manage-block">
            <p class="admin-manage-label">Customer email</p>
            <div class="admin-manage-actions">
              ${bucket === 'waiting'
                ? `<button class="button button-primary" type="button" data-action="markReady">${readyLabel}</button>`
                : `<button class="button button-secondary" type="button" data-action="resendReady">Send again</button>`}
              <button class="button button-secondary" type="button" data-action="markPickedUp">Mark picked up</button>
            </div>
          </div>
        `;
      return `
        <article class="admin-appointment admin-order${order.isMock ? ' is-mock' : ''}" data-order-id="${escapeHtml(id)}" data-tire-kind="${escapeHtml(order.tireKind === 'Used' ? 'Used' : 'New')}" ${order.isMock ? 'data-mock="true"' : ''}>
          <div class="admin-appointment-top">
            <div>
              <p class="admin-appointment-time">${escapeHtml(order.customer_name || 'Customer')}</p>
              <p class="admin-appointment-service">${order.tireKind === 'Used' ? 'Used tires' : 'New tires'} · ${escapeHtml(fulfillment)} · Paid ${escapeHtml(formatDate(order.paid_at || order.created_at) || 'date unknown')}</p>
            </div>
            <div class="admin-badges">
              ${order.isMock ? '<span class="admin-badge is-sample">Sample</span>' : ''}
              <span class="admin-badge ${statusBadgeClass(order)}">${escapeHtml(statusLabel(order))}</span>
            </div>
          </div>
          <div class="admin-grid">
            <div><span>Phone</span>${phone ? `<a href="${escapeHtml(phoneHref(phone))}">${escapeHtml(phone)}</a>` : '<strong>Not provided</strong>'}</div>
            <div><span>Email</span>${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '<strong>Not provided</strong>'}</div>
            <div><span>Type</span><strong>${order.tireKind === 'Used' ? 'Used tires' : 'New tires'}</strong></div>
            <div><span>Tires</span><strong>${escapeHtml(lines.join(', ') || 'See notes')}</strong></div>
            <div><span>Total</span><strong>${escapeHtml(money(order.total_with_hst))}</strong></div>
            ${order.tireconnect_order_number ? `<div><span>TireConnect</span><strong>${escapeHtml(order.tireconnect_order_number)}</strong></div>` : ''}
            ${order.pickup_ready_emailed_at ? `<div><span>Ready email</span><strong>${escapeHtml(formatDate(order.pickup_ready_emailed_at))}</strong></div>` : ''}
          </div>
          <div class="admin-manage">
            ${actions}
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

  async function postOrder(payload) {
    const token = await getToken();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return null;
    }

    const response = await fetch('/.netlify/functions/admin-new-tire-orders', {
      method: 'POST',
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
      throw new Error(body.message || 'Order could not be updated.');
    }
    return body;
  }

  async function loadOrders(email) {
    const token = await getToken();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return;
    }

    setStatus('Loading tire orders...');
    const response = await fetch('/.netlify/functions/admin-new-tire-orders', {
      headers: { Authorization: `Bearer ${token}` },
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
      setStatus(payload.message || 'Orders could not be loaded.', 'error');
      if (els.list) els.list.innerHTML = '';
      return;
    }

    showDashboard(email);
    const liveOrders = Array.isArray(payload.orders) ? payload.orders : [];
    allOrders = [...MOCK_USED_ORDERS, ...liveOrders];
    applyView();
  }

  async function handleManageClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !els.list?.contains(button)) return;
    const card = button.closest('[data-order-id]');
    const orderId = card?.dataset.orderId;
    if (!orderId) return;

    setCardFeedback(card, '');
    if (card.dataset.mock === 'true') {
      setCardFeedback(card, 'Sample used-tire order. No email is sent.');
      return;
    }
    try {
      button.disabled = true;
      const result = await postOrder({
        orderId,
        tireKind: card.dataset.tireKind || 'New',
        action: button.dataset.action,
      });
      if (!result) return;
      setStatus(result.message || 'Order updated.');
      setCardFeedback(card, result.message || 'Updated.', 'ok');
      await loadOrders(els.staffEmail?.textContent || '');
    } catch (error) {
      setCardFeedback(card, error.message || 'Update failed.', 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function isLocalSamplePreview() {
    const host = location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    return new URLSearchParams(location.search).has('samples');
  }

  async function initialize() {
    if (isLocalSamplePreview()) {
      showDashboard('sample preview');
      allOrders = [...MOCK_USED_ORDERS];
      applyView();
      return;
    }

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
    await loadOrders(email);
  }

  els.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    applyView();
  });
  els.filter?.addEventListener('change', () => applyView());
  els.search?.addEventListener('input', () => applyView());
  els.list?.addEventListener('click', handleManageClick);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
