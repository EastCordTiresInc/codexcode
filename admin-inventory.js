(() => {
  const ADMIN_EMAIL = 'info@eastcordtires.ca';

  // Same column order as Sheet1 / SYNC_COLUMNS in google-sheets-inventory.js
  const SHEET_COLUMNS = [
    { key: 'id', label: 'id' },
    { key: 'tire_size', label: 'tire_size' },
    { key: 'rim_size', label: 'rim_size' },
    { key: 'type', label: 'type' },
    { key: 'brand', label: 'brand' },
    { key: 'opening_qty', label: 'opening_qty' },
    { key: 'add_qty', label: 'add_qty' },
    { key: 'remove_qty', label: 'remove_qty' },
    { key: 'current_stock', label: 'current_stock' },
    { key: 'selling_price', label: 'selling_price' },
    { key: 'drive_link', label: 'drive_link' },
    { key: 'is_flotation', label: 'is_flotation' },
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
    search: document.querySelector('[data-admin-inventory-search]'),
    stock: document.querySelector('[data-admin-inventory-stock]'),
    sort: document.querySelector('[data-admin-inventory-sort]'),
    status: document.querySelector('[data-admin-status]'),
    inventory: document.querySelector('[data-admin-inventory]'),
    brandList: document.querySelector('[data-filter-list="brand"]'),
    seasonList: document.querySelector('[data-filter-list="season"]'),
    sizeList: document.querySelector('[data-filter-list="size"]'),
    filters: document.querySelector('.admin-inventory-filters'),
  };

  let allItems = [];
  let sortMode = 'id-asc';
  const selectedBrands = new Set();
  const selectedSeasons = new Set();
  const selectedSizes = new Set();

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

  function itemSeason(item) {
    return clean(item.season) || clean(item.type) || 'Unspecified';
  }

  function itemBrand(item) {
    return clean(item.brand) || 'Unspecified';
  }

  function itemSize(item) {
    return clean(item.tire_size) || 'Unspecified';
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
      return Number.isFinite(amount) ? escapeHtml(amount) : escapeHtml(value);
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

  function renderFilterList(container, values, selected, group) {
    if (!container) return;
    if (!values.length) {
      container.innerHTML = '<p class="admin-filter-empty">None</p>';
      return;
    }

    container.innerHTML = values.map((value) => {
      const active = selected.has(value) ? ' is-active' : '';
      return `
        <button
          type="button"
          class="admin-filter-option${active}"
          data-filter-group="${escapeHtml(group)}"
          data-filter-value="${escapeHtml(value)}"
          aria-pressed="${selected.has(value) ? 'true' : 'false'}"
        >${escapeHtml(value)}</button>
      `;
    }).join('');
  }

  function populateFilters() {
    const brands = uniqueSorted(allItems.map(itemBrand));
    const seasons = uniqueSorted(allItems.map(itemSeason));
    const sizes = uniqueSorted(allItems.map(itemSize));

    for (const value of Array.from(selectedBrands)) {
      if (!brands.includes(value)) selectedBrands.delete(value);
    }
    for (const value of Array.from(selectedSeasons)) {
      if (!seasons.includes(value)) selectedSeasons.delete(value);
    }
    for (const value of Array.from(selectedSizes)) {
      if (!sizes.includes(value)) selectedSizes.delete(value);
    }

    renderFilterList(els.brandList, brands, selectedBrands, 'brand');
    renderFilterList(els.seasonList, seasons, selectedSeasons, 'season');
    renderFilterList(els.sizeList, sizes, selectedSizes, 'size');
  }

  function matchesFilters(item) {
    const query = clean(els.search?.value).toLowerCase();
    const stockFilter = els.stock?.value || 'all';
    const stock = Number(item.current_stock) || 0;

    if (selectedBrands.size && !selectedBrands.has(itemBrand(item))) return false;
    if (selectedSeasons.size && !selectedSeasons.has(itemSeason(item))) return false;
    if (selectedSizes.size && !selectedSizes.has(itemSize(item))) return false;
    if (stockFilter === 'in' && stock <= 0) return false;
    if (stockFilter === 'out' && stock > 0) return false;

    if (!query) return true;

    const haystack = SHEET_COLUMNS
      .map(({ key }) => String(item[key] ?? '').toLowerCase())
      .concat([itemSeason(item).toLowerCase()])
      .join(' ');

    return haystack.includes(query);
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
    if (selectedBrands.size) parts.push(`${selectedBrands.size} brand${selectedBrands.size === 1 ? '' : 's'}`);
    if (selectedSeasons.size) parts.push(`${selectedSeasons.size} season${selectedSeasons.size === 1 ? '' : 's'}`);
    if (selectedSizes.size) parts.push(`${selectedSizes.size} size${selectedSizes.size === 1 ? '' : 's'}`);
    return parts.length ? ` · ${parts.join(', ')} selected` : '';
  }

  function applyView() {
    readSortControl();
    syncSortControl();
    populateFilters();
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

  function toggleFilter(group, value) {
    const set = group === 'brand'
      ? selectedBrands
      : group === 'season'
        ? selectedSeasons
        : selectedSizes;
    if (set.has(value)) set.delete(value);
    else set.add(value);
    applyView();
  }

  function clearFilter(group) {
    if (group === 'brand') selectedBrands.clear();
    if (group === 'season') selectedSeasons.clear();
    if (group === 'size') selectedSizes.clear();
    applyView();
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

  els.search?.addEventListener('input', () => applyView());
  els.stock?.addEventListener('change', () => applyView());
  els.sort?.addEventListener('change', () => applyView());

  els.filters?.addEventListener('click', (event) => {
    const clearButton = event.target.closest('[data-clear-filter]');
    if (clearButton) {
      clearFilter(clearButton.dataset.clearFilter);
      return;
    }

    const option = event.target.closest('[data-filter-group][data-filter-value]');
    if (!option) return;
    toggleFilter(option.dataset.filterGroup, option.dataset.filterValue);
  });

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
