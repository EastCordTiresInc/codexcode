(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';

  // Same column order as Sheet1; labels are written for staff readability.
  const SHEET_COLUMNS = [
    { key: 'id', label: 'Tire ID' },
    { key: 'tire_size', label: 'Tire Size' },
    { key: 'rim_size', label: 'Rim Size' },
    { key: 'type', label: 'Type' },
    { key: 'brand', label: 'Brand' },
    { key: 'opening_qty', label: 'Opening Qty' },
    { key: 'add_qty', label: 'Add' },
    { key: 'remove_qty', label: 'Remove' },
    { key: 'current_stock', label: 'Current Stock' },
    { key: 'selling_price', label: 'Selling Price ($)' },
    { key: 'drive_link', label: 'Drive Link' },
    { key: 'is_flotation', label: 'Flotation' },
  ];

  const SORT_OPTIONS = {
    'id-asc': { key: 'id', order: 'asc', label: 'tire id' },
    'selling_price-asc': { key: 'selling_price', order: 'asc', label: 'price low to high' },
    'selling_price-desc': { key: 'selling_price', order: 'desc', label: 'price high to low' },
    'current_stock-asc': { key: 'current_stock', order: 'asc', label: 'quantity low to high' },
    'current_stock-desc': { key: 'current_stock', order: 'desc', label: 'quantity high to low' },
  };

  const SORTABLE_KEYS = new Set(['selling_price', 'current_stock']);

  const els = {
    chrome: document.querySelector('[data-admin-chrome]'),
    staffEmail: document.querySelector('[data-admin-staff-email]'),
    loading: document.querySelector('[data-admin-loading]'),
    gate: document.querySelector('[data-admin-gate]'),
    gateMessage: document.querySelector('[data-admin-gate-message]'),
    dashboard: document.querySelector('[data-admin-dashboard]'),
    form: document.querySelector('[data-admin-inventory-form]'),
    brand: document.querySelector('[data-admin-inventory-brand]'),
    season: document.querySelector('[data-admin-inventory-season]'),
    size: document.querySelector('[data-admin-inventory-size]'),
    stock: document.querySelector('[data-admin-inventory-stock]'),
    sort: document.querySelector('[data-admin-inventory-sort]'),
    status: document.querySelector('[data-admin-status]'),
    inventory: document.querySelector('[data-admin-inventory]'),
  };

  let allItems = [];
  let sortMode = 'id-asc';

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

  function currentSort() {
    return SORT_OPTIONS[sortMode] || SORT_OPTIONS['id-asc'];
  }

  function clean(value) {
    return String(value ?? '').trim();
  }

  function formatSeasonLabel(value) {
    const label = clean(value);
    if (!label) return 'Unspecified';

    const lower = label.toLowerCase();
    if (lower.includes('winter')) return 'Winter';
    if (lower.includes('summer')) return 'Summer';
    if (lower.includes('all') || lower.includes('terrain')) return 'All Season';

    return label.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function itemSeason(item) {
    return formatSeasonLabel(clean(item.season) || clean(item.type));
  }

  function itemBrand(item) {
    return clean(item.brand) || 'Unspecified';
  }

  function formatTireSizeLabel(item) {
    const sizeLabel = clean(item.size_label);
    if (sizeLabel) return sizeLabel;

    const width = clean(item.width);
    const profile = clean(item.profile);
    const rim = clean(item.wheel_size) || clean(item.rim_size);
    const isFlotation = item.is_flotation === true
      || item.is_flotation === 'TRUE'
      || item.is_flotation === 'true'
      || item.is_flotation === 1
      || item.is_flotation === '1';

    if (width && profile && rim) {
      return isFlotation ? `${width}x${profile}R${rim}` : `${width}/${profile}R${rim}`;
    }

    const raw = clean(item.tire_size);
    if (!raw) return 'Unspecified';

    // Ensure standard sizes include an R before the rim digits when missing.
    return raw
      .replace(/(\d{3})\s*[\/-]\s*(\d{2})\s*[rR]?\s*(\d{2})/i, '$1/$2R$3')
      .replace(/(\d{2})\s*[xX]\s*(\d{2}(?:\.\d+)?)\s*[rR]?\s*(\d{2})/i, '$1x$2R$3');
  }

  function itemSize(item) {
    return formatTireSizeLabel(item);
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => (
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    ));
  }

  function formatCell(key, item) {
    const value = item[key];

    if (key === 'id') {
      return `<code class="admin-tire-id">${escapeHtml(value)}</code>`;
    }

    if (key === 'tire_size') {
      return escapeHtml(formatTireSizeLabel(item));
    }

    if (key === 'drive_link') {
      if (!value) return '';
      return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
    }

    if (key === 'is_flotation') {
      if (value === true || value === 'TRUE' || value === 'true' || value === 1 || value === '1') return 'TRUE';
      if (value === false || value === 'FALSE' || value === 'false' || value === 0 || value === '0') return 'FALSE';
      return value == null ? '' : escapeHtml(value);
    }

    if (key === 'selling_price') {
      if (value == null || value === '') return '';
      const amount = Number(value);
      if (!Number.isFinite(amount)) return escapeHtml(value);
      return `$${escapeHtml(amount)}`;
    }

    if (
      key === 'rim_size'
      || key === 'opening_qty'
      || key === 'add_qty'
      || key === 'remove_qty'
      || key === 'current_stock'
    ) {
      if (value == null || value === '') return '';
      return escapeHtml(value);
    }

    return value == null ? '' : escapeHtml(value);
  }

  function fillSelect(select, values, allLabel, previousValue) {
    if (!select) return;
    const options = [`<option value="">${escapeHtml(allLabel)}</option>`]
      .concat(values.map((value) => (
        `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
      )));
    select.innerHTML = options.join('');
    select.value = previousValue && values.includes(previousValue) ? previousValue : '';
  }

  function populateFilters() {
    const previousBrand = clean(els.brand?.value);
    const previousSeason = clean(els.season?.value);
    const previousSize = clean(els.size?.value);

    fillSelect(els.brand, uniqueSorted(allItems.map(itemBrand)), 'All brands', previousBrand);
    fillSelect(els.season, uniqueSorted(allItems.map(itemSeason)), 'All seasons', previousSeason);
    fillSelect(els.size, uniqueSorted(allItems.map(itemSize)), 'All sizes', previousSize);
  }

  function matchesFilters(item) {
    const brand = clean(els.brand?.value);
    const season = clean(els.season?.value);
    const size = clean(els.size?.value);
    const stockFilter = els.stock?.value || 'all';
    const stock = Number(item.current_stock) || 0;

    if (brand && itemBrand(item) !== brand) return false;
    if (season && itemSeason(item) !== season) return false;
    if (size && itemSize(item) !== size) return false;
    if (stockFilter === 'in' && stock <= 0) return false;
    if (stockFilter === 'out' && stock > 0) return false;

    return true;
  }

  function compareNumeric(a, b, key) {
    const left = a?.[key];
    const right = b?.[key];
    const leftBlank = left == null || left === '';
    const rightBlank = right == null || right === '';

    if (leftBlank && rightBlank) return 0;
    if (leftBlank) return 1;
    if (rightBlank) return -1;
    return Number(left) - Number(right);
  }

  function syncSortControl() {
    if (els.sort) els.sort.value = sortMode;
  }

  function readSortControl() {
    const next = String(els.sort?.value || 'id-asc');
    sortMode = SORT_OPTIONS[next] ? next : 'id-asc';
  }

  function sortedVisibleItems() {
    const { key, order } = currentSort();
    const direction = order === 'desc' ? -1 : 1;
    return allItems
      .filter(matchesFilters)
      .slice()
      .sort((a, b) => {
        const primary = compareNumeric(a, b, key) * direction;
        if (primary) return primary;
        return compareNumeric(a, b, 'id');
      });
  }

  function renderInventory() {
    if (!els.inventory) return;

    const visible = sortedVisibleItems();
    if (!visible.length) {
      els.inventory.innerHTML = '<p class="admin-empty">No tires match this filter.</p>';
      return;
    }

    const { key: activeKey, order } = currentSort();

    const head = SHEET_COLUMNS.map((column) => {
      if (!SORTABLE_KEYS.has(column.key)) {
        return `<th scope="col">${escapeHtml(column.label)}</th>`;
      }

      const active = column.key === activeKey;
      const marker = active ? (order === 'desc' ? ' ↓' : ' ↑') : '';
      return `
        <th scope="col">
          <button
            type="button"
            class="admin-sort-header${active ? ' is-active' : ''}"
            data-sort-key="${escapeHtml(column.key)}"
          >${escapeHtml(column.label)}${marker}</button>
        </th>
      `;
    }).join('');

    const rows = visible.map((item) => `
      <tr>
        ${SHEET_COLUMNS.map((column) => `<td>${formatCell(column.key, item)}</td>`).join('')}
      </tr>
    `).join('');

    els.inventory.innerHTML = `
      <table class="admin-inventory-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function selectedSummary() {
    const parts = [];
    const brand = clean(els.brand?.value);
    const season = clean(els.season?.value);
    const size = clean(els.size?.value);
    if (brand) parts.push(brand);
    if (season) parts.push(season);
    if (size) parts.push(size);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  }

  function applyView() {
    readSortControl();
    syncSortControl();
    const visible = sortedVisibleItems();
    const total = allItems.length;
    const shown = visible.length;
    const label = currentSort().label;
    setStatus(
      shown === total
        ? `${total} rows · sorted by ${label}${selectedSummary()} · read-only`
        : `Showing ${shown} of ${total} rows · sorted by ${label}${selectedSummary()} · read-only`,
    );
    renderInventory();
  }

  function sortByColumn(key) {
    if (!SORTABLE_KEYS.has(key)) return;
    const { key: activeKey, order } = currentSort();
    if (activeKey === key) {
      sortMode = `${key}-${order === 'asc' ? 'desc' : 'asc'}`;
    } else {
      sortMode = `${key}-asc`;
    }
    syncSortControl();
    applyView();
  }

  async function loadInventory(email) {
    const token = await window.EastCordAccount?.getAccessToken?.();
    if (!token) {
      showGate('Log in with the EastCord staff account to open the admin dashboard.');
      return;
    }

    setStatus('Loading used inventory...');
    const response = await fetch('/.netlify/functions/admin-used-inventory', {
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
      setStatus(payload.message || 'Inventory could not be loaded.', 'error');
      if (els.inventory) els.inventory.innerHTML = '';
      return;
    }

    showDashboard(email);
    allItems = Array.isArray(payload.items) ? payload.items : [];
    populateFilters();
    applyView();
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
    await loadInventory(email);
  }

  els.form?.addEventListener('submit', (event) => {
    event.preventDefault();
    applyView();
  });

  els.brand?.addEventListener('change', () => applyView());
  els.season?.addEventListener('change', () => applyView());
  els.size?.addEventListener('change', () => applyView());
  els.stock?.addEventListener('change', () => applyView());
  els.sort?.addEventListener('change', () => applyView());

  els.inventory?.addEventListener('click', (event) => {
    const sortButton = event.target.closest('[data-sort-key]');
    if (!sortButton) return;
    sortByColumn(sortButton.dataset.sortKey);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
