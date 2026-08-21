const INVENTORY_TABLE = 'usedtireinventory';
const INVENTORY_SELECT = 'id, tire_size, rim_size, type, brand, current_stock, selling_price, drive_link, is_flotation, width, profile, wheel_size, size_label, season';
const STATIC_INVENTORY_URL = '/assets/used-inventory.json';
const EMPTY_MESSAGE = 'No tires are listed right now. Please contact EastCord Tires for current availability.';
const SETUP_MESSAGE = 'Inventory is being connected. Supabase credentials are not configured yet.';
const NO_MATCH_MESSAGE = 'No tires match that search. Try different options or contact EastCord Tires.';
const SOLD_OUT_MESSAGE = 'Those tires are currently sold out. Please contact EastCord Tires to check availability or ask about similar tires.';
const TIRE_CALCULATOR_URL = '/#tire-size-calculator';
const LOW_STOCK_THRESHOLD = 2;
const INVENTORY_AUTO_REFRESH_MS = 30000;
const USED_TIRE_CART_KEY = 'eastcord_used_tire_cart_v1';

let inventory = [];
let inventoryLoaded = false;
let inventorySource = 'live';
let searchPerformed = false;
let lastResults = [];
let inventoryAutoRefreshInProgress = false;
let inventoryAutoRefreshTimer = null;
let markdownOpen = false;

bootInventory();

function bootInventory() {
  const start = () => {
    init().catch((error) => {
      console.error('[EastCord inventory] Init failed.', error);
      setLoadStatus(`Inventory failed to start: ${error?.message || 'unknown error'}`, 'error');
      inventoryLoaded = true;
      setSearchReadyState();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }

  start();
}

async function init() {
  const form = document.querySelector('#inventory-search-form');
  if (!form) {
    setLoadStatus('Search form not found on this page.', 'error');
    return;
  }

  bindInventoryControls();
  initPhotoLightbox();
  await Promise.all([loadInventory(), preloadPhotoCache()]);
  populateSearchOptions();
  setSearchReadyState();
  renderMarkdownSection();
  startInventoryAutoRefresh();
  hydrateUsedTireCustomerCart().catch((error) => {
    console.warn('[EastCord inventory] Saved tire cart could not be loaded from the customer account.', error);
  });
}

function startInventoryAutoRefresh() {
  if (inventoryAutoRefreshTimer) return;
  inventoryAutoRefreshTimer = window.setInterval(
    refreshInventoryAutomatically,
    INVENTORY_AUTO_REFRESH_MS,
  );
}

async function refreshInventoryAutomatically() {
  if (document.hidden || inventoryAutoRefreshInProgress) return;

  inventoryAutoRefreshInProgress = true;
  const previousVersion = getInventoryVersion(inventory);

  try {
    await loadInventory({ silent: true });
    const inventoryChanged = getInventoryVersion(inventory) !== previousVersion;
    if (inventoryChanged) {
      renderMarkdownSection();
      if (searchPerformed) runSearch();
    }
  } catch (error) {
    console.warn('[EastCord inventory] Automatic refresh failed.', error);
  } finally {
    inventoryAutoRefreshInProgress = false;
  }
}

function getInventoryVersion(items) {
  return JSON.stringify(items.map((item) => [
    item.id,
    item.brand,
    item.size,
    item.season,
    item.stock,
    item.price,
    item.details,
  ]));
}

function getAuthConfig() {
  return window.EASTCORD_AUTH_CONFIG || {};
}

function isInventoryConfigured() {
  const { supabaseUrl, supabaseAnonKey } = getAuthConfig();
  return Boolean(supabaseUrl && supabaseAnonKey && supabaseAnonKey.startsWith('eyJ'));
}

async function fetchInventoryRows() {
  try {
    inventorySource = 'live';
    return await fetchInventoryFromUrl('/.netlify/functions/get-used-inventory');
  } catch (proxyError) {
    console.warn('[EastCord inventory] Server proxy failed, trying Supabase directly.', proxyError);
  }

  if (isInventoryConfigured()) {
    try {
      inventorySource = 'live';
      return await fetchInventoryDirect();
    } catch (directError) {
      console.warn('[EastCord inventory] Direct Supabase failed, using saved inventory file.', directError);
    }
  }

  inventorySource = 'static';
  return fetchInventoryFromUrl(STATIC_INVENTORY_URL);
}

async function fetchInventoryDirect() {
  const { supabaseUrl, supabaseAnonKey } = getAuthConfig();
  const params = new URLSearchParams();
  params.set('select', INVENTORY_SELECT);
  params.append('order', 'brand.asc');
  params.append('order', 'tire_size.asc');

  const url = `${supabaseUrl}/rest/v1/${INVENTORY_TABLE}?${params.toString()}`;
  return fetchInventoryFromUrl(url, {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  });
}

async function fetchInventoryFromUrl(url, authHeaders = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders,
      },
      signal: controller.signal,
    });

    const body = await response.text();
    if (!response.ok) {
      let detail = body.slice(0, 240);
      try {
        const parsed = JSON.parse(body);
        detail = parsed.message || parsed.error || parsed.hint || detail;
      } catch (_) {
        // keep raw body snippet
      }
      throw new Error(`${response.status}: ${detail}`);
    }

    const data = JSON.parse(body);
    if (!Array.isArray(data)) {
      throw new Error('Unexpected inventory response format.');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Timed out loading inventory (10s). Refresh the page or check your connection.');
    }
    if (error instanceof TypeError) {
      throw new Error('Could not reach the inventory service (network or certificate error).');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getElements() {
  return {
    form: document.querySelector('#inventory-search-form'),
    width: document.querySelector('#inventory-width'),
    profile: document.querySelector('#inventory-profile'),
    rim: document.querySelector('#inventory-rim'),
    season: document.querySelector('#inventory-season'),
    brand: document.querySelector('#inventory-brand'),
    list: document.querySelector('#inventory-list'),
    status: document.querySelector('[data-inventory-status]'),
    loadStatus: document.querySelector('[data-inventory-load-status]'),
    results: document.querySelector('[data-inventory-results]'),
    submit: document.querySelector('[data-inventory-submit]'),
    markdownPrompt: document.querySelector('[data-markdown-prompt]'),
    markdownBanner: document.querySelector('[data-markdown-banner]'),
    markdownBannerTitle: document.querySelector('[data-markdown-banner-title]'),
    markdownClose: document.querySelector('[data-markdown-close]'),
    markdownSection: document.querySelector('[data-markdown-section]'),
    markdownList: document.querySelector('[data-markdown-list]'),
    markdownCount: document.querySelector('[data-markdown-count]'),
    markdownFilter: document.querySelector('[data-markdown-filter]'),
  };
}

function setLoadStatus(message, type = 'info') {
  const { loadStatus } = getElements();
  if (!loadStatus) return;
  loadStatus.textContent = message;
  loadStatus.dataset.statusType = type;
}

async function loadInventory(options = {}) {
  const { status } = getElements();
  if (!options.silent) {
    setLoadStatus('Loading inventory...', 'info');
  }

  if (!isInventoryConfigured()) {
    inventory = [];
    inventoryLoaded = true;
    setLoadStatus(SETUP_MESSAGE, 'error');
    if (status) {
      status.textContent = SETUP_MESSAGE;
      status.dataset.statusType = 'error';
    }
    return;
  }

  try {
    const data = await fetchInventoryRows();
    inventory = (data || []).map(normalizeInventoryRow).filter(Boolean);
    const inStockInventory = inventory.filter(isInStock);
    const searchableCount = inStockInventory.filter((item) => item.width && item.profile && item.rim).length;

    if (!inventory.length) {
      setLoadStatus(
        'No tires returned from Supabase. Check Row Level Security on usedtireinventory.',
        'error',
      );
    } else if (!searchableCount) {
      setLoadStatus(
        `${inventory.length} tires loaded, but tire sizes could not be parsed for search dropdowns.`,
        'error',
      );
    } else if (inventorySource === 'static') {
      setLoadStatus(
        `${searchableCount} tire size${searchableCount === 1 ? '' : 's'} ready (offline snapshot — live Supabase sync unavailable).`,
        'success',
      );
    } else {
      setLoadStatus(
        `${searchableCount} tire size${searchableCount === 1 ? '' : 's'} ready — choose width, profile, and wheel size below.`,
        'success',
      );
    }

    if (status && !searchPerformed) {
      status.textContent = inStockInventory.length
        ? `${inStockInventory.length} tire${inStockInventory.length === 1 ? '' : 's'} in stock — search by size to see matches`
        : EMPTY_MESSAGE;
      status.dataset.statusType = inStockInventory.length ? 'success' : 'info';
    }
  } catch (error) {
    console.error('[EastCord inventory] Could not load tire inventory from Supabase.', error);
    inventory = [];
    const message = error?.message || 'Unknown Supabase error';
    setLoadStatus(`Inventory could not load: ${message}`, 'error');
    if (status) {
      status.textContent = 'Inventory could not be loaded right now. Please refresh or contact EastCord Tires.';
      status.dataset.statusType = 'error';
    }
  } finally {
    inventoryLoaded = true;
  }
}

function normalizeInventoryRow(row) {
  if (!row) return null;

  const brand = clean(row.brand);
  const tireSizeRaw = clean(row.tire_size);
  const rimSize = clean(row.rim_size);
  const isFlotation = parseBoolean(row.is_flotation);
  const parsedSize = parseTireSize(tireSizeRaw, rimSize, isFlotation);
  const width = parsedSize?.width || clean(row.width) || null;
  const profile = parsedSize?.profile || clean(row.profile) || null;
  const rim = parsedSize?.rim || clean(row.wheel_size) || null;
  const size = formatTireSizeLabel(tireSizeRaw, { width, profile, rim }, isFlotation) || clean(row.size_label) || tireSizeRaw;
  const season = clean(row.season) || clean(row.type);
  const title = [brand, size].filter(Boolean).join(' ');

  return {
    id: row.id,
    sku: String(row.id || ''),
    type: 'Used',
    title: title || 'Tire',
    brand,
    model: '',
    size,
    width,
    profile,
    rim,
    season,
    seasonKey: normalizeSeason(season),
    loadRating: '',
    price: parsePrice(row.selling_price),
    stock: parseStock(row.current_stock),
    condition: '',
    details: clean(row.drive_link),
    syncedAt: null,
  };
}

function parseBoolean(value) {
  if (value === true) return true;
  return clean(value).toLowerCase() === 'true';
}

function formatTireSizeLabel(rawSize, parsedSize, isFlotation) {
  if (parsedSize?.width && parsedSize?.profile && parsedSize?.rim) {
    if (isFlotation) {
      return `${parsedSize.width}x${parsedSize.profile}R${parsedSize.rim}`;
    }
    return `${parsedSize.width}/${parsedSize.profile}R${parsedSize.rim}`;
  }

  return rawSize;
}

function parseTireSize(size, rimSize = '', isFlotation = false) {
  const value = clean(size);
  if (!value) return null;

  const standard = value.match(/(\d{3})\s*[\/-]\s*(\d{2})\s*[rR]?\s*(\d{2})/);
  if (standard) {
    return {
      width: standard[1],
      profile: standard[2],
      rim: standard[3],
    };
  }

  const flotationText = value.match(/(\d{2})\s*[xX]\s*(\d{2}(?:\.\d+)?)\s*[rR]?\s*(\d{2})/);
  if (flotationText) {
    return {
      width: flotationText[1],
      profile: flotationText[2],
      rim: flotationText[3],
    };
  }

  const encodedFlotation = isFlotation ? parseEncodedFlotationDecimal(value, rimSize) : null;
  if (encodedFlotation) {
    return encodedFlotation;
  }

  const digits = value.replace(/\D/g, '');

  if (isFlotation && digits.length === 8) {
    return {
      width: digits.slice(0, 2),
      profile: `${digits.slice(2, 4)}.${digits.slice(4, 6)}`,
      rim: normalizeRimSize(rimSize) || digits.slice(6, 8),
    };
  }

  if (digits.length === 7 && !isFlotation) {
    return {
      width: digits.slice(0, 3),
      profile: digits.slice(3, 5),
      rim: digits.slice(5, 7),
    };
  }

  const rim = normalizeRimSize(rimSize);
  if (isFlotation && rim && digits.length >= 4) {
    return {
      width: digits.slice(0, 2),
      profile: digits.slice(2, 4),
      rim,
    };
  }

  if (rim && digits.length >= 5) {
    return {
      width: digits.slice(0, 3),
      profile: digits.slice(3, 5),
      rim,
    };
  }

  return null;
}

function parseEncodedFlotationDecimal(value, rimSize) {
  if (!/^\d+\.\d+/.test(value)) return null;

  const [integerPart, fractionPart = ''] = value.split('.');
  if (integerPart.length < 4) return null;

  const width = integerPart.slice(0, 2);
  const profileWhole = integerPart.slice(3, 5);
  const profileDecimal = fractionPart.slice(0, 2).padEnd(2, '0');
  const profile = `${profileWhole}.${profileDecimal}`;
  const rim = normalizeRimSize(rimSize)
    || (integerPart.length >= 6 ? integerPart.slice(4, 6) : null);

  if (!width || !profileWhole || !rim) return null;

  return { width, profile, rim };
}

function normalizeRimSize(value) {
  const text = clean(value);
  if (!text) return null;

  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  if (num >= 10) return String(num);
  return String(num * 10);
}

function normalizeSeason(value) {
  const season = clean(value).toLowerCase();
  if (!season) return '';
  if (season.includes('winter')) return 'winter';
  if (season.includes('summer')) return 'summer';
  if (season.includes('terrain') || season.includes('all')) return 'all-season';
  return season;
}

function clean(value) {
  if (value === undefined || value === null) return '';
  let text = String(value).trim();
  if (/^\d+\.0+$/.test(text)) {
    text = text.replace(/\.0+$/, '');
  }
  return text;
}

function parsePrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function parseStock(value) {
  if (value === undefined || value === null || value === '') return 0;
  const amount = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function bindInventoryControls() {
  const { form, width, profile, rim, brand } = getElements();

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });

  getElements().markdownPrompt?.addEventListener('click', () => {
    toggleMarkdownSection();
  });

  getElements().markdownClose?.addEventListener('click', () => {
    markdownOpen = false;
    renderMarkdownSection();
  });

  width?.addEventListener('change', () => {
    refreshDependentOptions('width');
  });

  profile?.addEventListener('change', () => {
    refreshDependentOptions('profile');
  });

  rim?.addEventListener('change', () => {
    refreshDependentOptions('rim');
  });

  brand?.addEventListener('change', () => {
    if (brand.value) runSearch();
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tire-cart-action]');
    if (!button) return;
    handleTireCartAction(button);
  });

  getElements().markdownFilter?.addEventListener('input', () => {
    renderMarkdownRows();
  });

  document.addEventListener('change', (event) => {
    const select = event.target.closest('.used-tire-card-qty');
    if (!select) return;
    updateTireCardSetTotal(select);
  });

  document.querySelector('[data-inventory-refresh]')?.addEventListener('click', async (event) => {
    event.preventDefault();
    inventoryLoaded = false;
    searchPerformed = false;
    lastResults = [];
    hideResults();
    await loadInventory();
    populateSearchOptions();
    setSearchReadyState();
    renderMarkdownSection();
  });
}

function setSearchReadyState() {
  const { submit } = getElements();
  const configured = isInventoryConfigured() && inventoryLoaded;
  if (submit) {
    submit.disabled = !configured;
  }
}

function populateSearchOptions() {
  const { width, profile, rim, brand } = getElements();
  if (!width || !profile || !rim || !brand) return;

  const inStock = inventory.filter(isInStock);
  const widths = uniqueSorted(inStock.map((item) => item.width).filter(Boolean));
  fillSelect(width, widths, 'Select width');
  fillSelect(profile, uniqueProfiles('', inStock), 'Select profile');
  fillSelect(rim, uniqueRims('', '', inStock), 'Select wheel size');
  fillSelect(brand, uniqueSortedText(inStock.map((item) => item.brand).filter(Boolean)), 'Any brand', true);
}

function refreshDependentOptions(changedField) {
  const { width, profile, rim } = getElements();
  if (!width || !profile || !rim) return;

  const inStock = inventory.filter(isInStock);

  if (changedField === 'width') {
    fillSelect(profile, uniqueProfiles(width.value, inStock), 'Select profile');
    fillSelect(rim, uniqueRims(width.value, profile.value, inStock), 'Select wheel size');
    return;
  }

  if (changedField === 'profile') {
    fillSelect(rim, uniqueRims(width.value, profile.value, inStock), 'Select wheel size');
  }
}

function uniqueProfiles(widthValue = '', items = inventory) {
  return uniqueSorted(
    items
      .filter((item) => !widthValue || item.width === widthValue)
      .map((item) => item.profile)
      .filter(Boolean),
  );
}

function uniqueRims(widthValue = '', profileValue = '', items = inventory) {
  return uniqueSorted(
    items
      .filter((item) => {
        if (widthValue && item.width !== widthValue) return false;
        if (profileValue && item.profile !== profileValue) return false;
        return Boolean(item.rim);
      })
      .map((item) => item.rim)
      .filter(Boolean),
  );
}

function isInStock(item) {
  return (Number(item?.stock) || 0) > 0;
}

function getPricing() {
  return window.EastCordUsedTirePricing || {
    MARKDOWN_RATE: 0.15,
    MARKDOWN_PERCENT: 15,
    isMarkdownStock(stock) {
      const count = Math.max(0, Number(stock) || 0);
      return count > 0 && count < 4;
    },
    getUsedTireUnitPrice(listPrice, stock) {
      const price = Number(listPrice);
      if (!Number.isFinite(price) || price <= 0) return null;
      const rounded = Math.round(price * 100) / 100;
      return this.isMarkdownStock(stock) ? Math.round(price * (1 - this.MARKDOWN_RATE) * 100) / 100 : rounded;
    },
  };
}

function markdownOffLabel() {
  const percent = Number(getPricing().MARKDOWN_PERCENT);
  return `${Number.isFinite(percent) ? percent : 15}% off`;
}

function isMarkdownTire(item) {
  return getPricing().isMarkdownStock(item?.stock);
}

function getTireSalePrice(item) {
  return getPricing().getUsedTireUnitPrice(item?.price, item?.stock);
}

function brandsMatch(left, right) {
  return clean(left).toLowerCase() === clean(right).toLowerCase();
}

function matchesSearchFilters(item, filters) {
  if (filters.width && item.width !== filters.width) return false;
  if (filters.profile && item.profile !== filters.profile) return false;
  if (filters.rim && item.rim !== filters.rim) return false;

  if (filters.season && filters.season !== 'all' && item.seasonKey && item.seasonKey !== filters.season) {
    return false;
  }

  if (filters.brand && !brandsMatch(item.brand, filters.brand)) {
    return false;
  }

  return true;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}

function uniqueSortedText(values) {
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }));
}

function formatProfileOption(value) {
  const text = clean(value);
  if (!text) return text;
  if (/^\d+\.\d+$/.test(text)) {
    return Number(text).toFixed(2);
  }
  return text;
}

function fillSelect(select, values, placeholder, allowEmpty = false) {
  const current = select.value;
  select.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = formatProfileOption(value);
    select.appendChild(option);
  });

  if (current && (values.includes(current) || (allowEmpty && current === ''))) {
    select.value = current;
  } else {
    select.value = '';
  }
}

function getSearchFilters() {
  const { width, profile, rim, season, brand } = getElements();
  return {
    width: width?.value || '',
    profile: profile?.value || '',
    rim: rim?.value || '',
    season: season?.value || '',
    brand: brand?.value || '',
  };
}

function hasCompleteSize(filters) {
  return Boolean(filters.width && filters.profile && filters.rim);
}

function formatSearchSummary(filters) {
  const { season, brand } = getElements();
  const parts = [];

  if (hasCompleteSize(filters)) {
    parts.push(`${filters.width}/${filters.profile}R${filters.rim}`);
  }

  if (filters.brand) {
    parts.push(brand?.selectedOptions?.[0]?.textContent || formatBrandLabel(filters.brand));
  }

  if (filters.season === 'all') {
    parts.push('any season');
  } else if (filters.season) {
    parts.push(season?.selectedOptions?.[0]?.textContent?.toLowerCase() || filters.season);
  }

  return parts.join(' · ');
}

function runSearch() {
  const selected = getSearchFilters();
  const completeSize = hasCompleteSize(selected);
  const filters = completeSize
    ? selected
    : { ...selected, width: '', profile: '', rim: '' };

  if (markdownOpen) {
    markdownOpen = false;
    renderMarkdownSection();
  }

  if (!completeSize && !filters.brand) {
    showResultsSection();
    renderSearchMessage('Please select a brand, or choose width, profile, and wheel size to search.');
    return;
  }

  searchPerformed = true;
  showResultsSection();

  const summary = formatSearchSummary(filters);
  const matching = inventory.filter((item) => matchesSearchFilters(item, filters));
  lastResults = matching.filter(isInStock);

  if (completeSize) {
    lastResults = mergeSameSizeLeftovers(lastResults, filters);
  }

  if (!lastResults.length && matching.some((item) => !isInStock(item))) {
    renderSoldOutMessage(summary);
    return;
  }

  renderResults(lastResults, summary);
}

function mergeSameSizeLeftovers(results, filters) {
  const seen = new Set(results.map((item) => String(item.id)));
  const extra = inventory.filter((item) => {
    if (seen.has(String(item.id))) return false;
    if (!isInStock(item) || !isMarkdownTire(item)) return false;
    if (item.width !== filters.width || item.profile !== filters.profile || item.rim !== filters.rim) {
      return false;
    }
    return true;
  });
  return extra.length ? results.concat(extra) : results;
}

function renderSoldOutMessage(summary) {
  const { list, status } = getElements();
  const detail = summary || 'that search';

  if (status) {
    status.textContent = `Sold out for ${detail}.`;
    status.dataset.statusType = 'error';
  }
  if (list) {
    list.innerHTML = renderInventoryEmptyState(SOLD_OUT_MESSAGE, {
      extraClass: 'used-inventory-sold-out',
    });
  }
}

function showResultsSection() {
  const { results } = getElements();
  if (results) results.hidden = false;
}

function hideResults() {
  const { results, status } = getElements();
  if (results) results.hidden = true;
  if (status) {
    status.textContent = '';
    delete status.dataset.statusType;
  }
}

function renderSearchMessage(message, options = {}) {
  const { list, status } = getElements();
  const { includeCalculatorLink = false, extraClass = '' } = options;

  if (status) {
    status.textContent = message;
    status.dataset.statusType = 'info';
  }
  if (list) {
    list.innerHTML = renderInventoryEmptyState(message, { includeCalculatorLink, extraClass });
  }
}

function renderInventoryEmptyState(message, options = {}) {
  const { includeCalculatorLink = true, extraClass = '' } = options;
  const calculatorLink = includeCalculatorLink
    ? `<p class="used-inventory-empty-link">Not sure of your size? <a href="${TIRE_CALCULATOR_URL}">Try our tire size calculator</a>.</p>`
    : '';

  return `
    <div class="used-inventory-empty ${extraClass}">
      <p>${escapeHtml(message)}</p>
      ${calculatorLink}
    </div>
  `;
}

function renderResults(products, summary = formatSearchSummary(getSearchFilters())) {
  const { list, status } = getElements();

  if (!inventoryLoaded) {
    renderSearchMessage('Loading inventory...');
    return;
  }

  if (!isInventoryConfigured()) {
    renderSearchMessage(SETUP_MESSAGE);
    return;
  }

  if (!inventory.filter(isInStock).length) {
    renderSearchMessage(EMPTY_MESSAGE);
    return;
  }

  if (!products.length) {
    if (status) {
      status.textContent = `No matches for ${summary || 'that search'}.`;
      status.dataset.statusType = 'info';
    }
    if (list) {
      list.innerHTML = renderInventoryEmptyState(NO_MATCH_MESSAGE);
    }
    return;
  }

  const fullSets = products.filter((item) => !isMarkdownTire(item));
  const leftovers = products.filter(isMarkdownTire);

  if (status) {
    status.textContent = formatSplitSearchStatus(fullSets.length, leftovers.length, summary);
    status.dataset.statusType = 'success';
  }

  if (!list) return;

  let photoIndex = 0;
  const sections = [];

  if (fullSets.length) {
    sections.push(renderSearchGroup({
      title: 'Full sets',
      note: '4 or more in stock',
      items: fullSets,
      startIndex: photoIndex,
    }));
    photoIndex += fullSets.length;
  }

  if (leftovers.length) {
    sections.push(renderSearchGroup({
      title: `Markdowns — ${markdownOffLabel()}`,
      note: leftovers.length === 1
        ? 'Fewer than 4 left of this size'
        : 'Fewer than 4 left — priced to move',
      items: leftovers,
      startIndex: photoIndex,
      leftover: true,
    }));
  }

  list.innerHTML = sections.join('');
  updateUsedTireCartCount();
  hydrateTireCardPhotos(list);
}

function formatSplitSearchStatus(setCount, leftoverCount, summary) {
  const parts = [];
  if (setCount) {
    parts.push(`${setCount} full set${setCount === 1 ? '' : 's'}`);
  }
  if (leftoverCount) {
    parts.push(`${leftoverCount} markdown${leftoverCount === 1 ? '' : 's'} at ${markdownOffLabel()}`);
  }
  return `${parts.join(' and ')} for ${summary}.`;
}

function renderSearchGroup({ title, note, items, startIndex = 0, leftover = false }) {
  return `
    <section class="used-inventory-group${leftover ? ' is-leftover' : ''}">
      <div class="used-inventory-group-header">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(note)}</p>
      </div>
      <div class="inventory-list">
        ${items.map((item, index) => renderUsedTireCard(item, startIndex + index)).join('')}
      </div>
    </section>
  `;
}

function getSortedMarkdownTires() {
  return inventory.filter(isMarkdownTire).sort(compareMarkdownTires);
}

function compareMarkdownTires(left, right) {
  const widthDelta = (Number(left.width) || 0) - (Number(right.width) || 0);
  if (widthDelta !== 0) return widthDelta;
  const profileDelta = (Number(left.profile) || 0) - (Number(right.profile) || 0);
  if (profileDelta !== 0) return profileDelta;
  const rimDelta = (Number(left.rim) || 0) - (Number(right.rim) || 0);
  if (rimDelta !== 0) return rimDelta;
  return String(left.brand || '').localeCompare(String(right.brand || ''), undefined, { sensitivity: 'base' });
}

function matchesMarkdownFilter(item, query) {
  if (!query) return true;
  const haystack = [item.size, item.brand, item.title, item.season]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function toggleMarkdownSection() {
  const markdownTires = getSortedMarkdownTires();
  if (!markdownTires.length) return;
  markdownOpen = !markdownOpen;
  renderMarkdownSection();
  if (markdownOpen) {
    getElements().markdownSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateMarkdownPrompt(count) {
  const { markdownPrompt, markdownBanner, markdownBannerTitle } = getElements();
  if (markdownBanner) {
    markdownBanner.hidden = count < 1;
    markdownBanner.classList.toggle('is-open', markdownOpen && count > 0);
  }
  if (markdownBannerTitle) {
    markdownBannerTitle.textContent = count
      ? `${count} markdown used tire${count === 1 ? '' : 's'}`
      : 'Markdown used tires';
  }
  if (!markdownPrompt) return;

  markdownPrompt.setAttribute('aria-expanded', markdownOpen ? 'true' : 'false');
  markdownPrompt.textContent = markdownOpen
    ? 'Hide markdown list'
    : `Browse ${count} markdown${count === 1 ? '' : 's'}`;
}

function renderMarkdownSection() {
  const { markdownSection, markdownList, markdownCount, markdownFilter } = getElements();
  if (!markdownSection || !markdownList) return;

  const markdownTires = getSortedMarkdownTires();
  if (!markdownTires.length) {
    markdownOpen = false;
  }

  updateMarkdownPrompt(markdownTires.length);
  markdownSection.hidden = !markdownOpen || !markdownTires.length;

  if (markdownCount) {
    markdownCount.textContent = markdownTires.length
      ? `${markdownTires.length} markdown size${markdownTires.length === 1 ? '' : 's'} — ${markdownOffLabel()}`
      : '';
  }

  if (!markdownOpen || !markdownTires.length) {
    markdownList.innerHTML = '';
    if (markdownFilter && !markdownTires.length) markdownFilter.value = '';
    return;
  }

  renderMarkdownRows();
}

function leftoverGroupLabel(stock) {
  if (stock >= 3) return { key: 3, title: 'Sets of 3', note: '3 matching tires left' };
  if (stock === 2) return { key: 2, title: 'Pairs', note: '2 matching tires left' };
  return { key: 1, title: 'Sets of 1', note: '1 left' };
}

function renderMarkdownRows() {
  const { markdownList, markdownFilter } = getElements();
  if (!markdownList) return;

  const query = clean(markdownFilter?.value).toLowerCase();
  const visible = getSortedMarkdownTires().filter((item) => matchesMarkdownFilter(item, query));

  if (!visible.length) {
    const typed = clean(markdownFilter?.value);
    markdownList.innerHTML = `<p class="used-markdown-empty">No markdown tires match “${escapeHtml(typed)}”. Try a size like 205 or a brand like Toyo.</p>`;
    return;
  }

  const grouped = new Map();
  visible.forEach((item) => {
    const group = leftoverGroupLabel(Math.max(0, Number(item.stock) || 0));
    if (!grouped.has(group.key)) grouped.set(group.key, { ...group, items: [] });
    grouped.get(group.key).items.push(item);
  });

  const boardHead = `
    <div class="used-markdown-board-head">
      <span class="visually-hidden">Photo</span>
      <span>Size</span>
      <span>Brand</span>
      <span>Left</span>
      <span>Was</span>
      <span>Now</span>
      <span>Save</span>
      <span class="visually-hidden">Reserve</span>
    </div>
  `;

  markdownList.innerHTML = [3, 2, 1]
    .filter((key) => grouped.has(key))
    .map((key) => {
      const group = grouped.get(key);
      return `
        <section class="used-markdown-group">
          <div class="used-markdown-group-header">
            <h3>${escapeHtml(group.title)}</h3>
            <p>${escapeHtml(group.note)} · ${group.items.length} size${group.items.length === 1 ? '' : 's'}</p>
          </div>
          ${boardHead}
          ${group.items.map((item) => renderMarkdownRow(item)).join('')}
        </section>
      `;
    })
    .join('');
  hydrateTireCardPhotos(markdownList);
}

function renderMarkdownRow(item) {
  const brandLabel = formatBrandLabel(item.brand);
  const seasonLabel = formatSeasonLabel(item.season);
  const stockCount = Math.max(0, Number(item.stock) || 0);
  const maxQty = Math.max(1, Math.min(stockCount || 1, 4));
  const listPrice = item.price;
  const unitPrice = getTireSalePrice(item);
  const savings = listPrice !== null && unitPrice !== null
    ? Math.max(0, Math.round((listPrice - unitPrice) * 100) / 100)
    : null;
  const qtyId = `used-tire-qty-sale-${item.id}`;
  const qtyOptions = Array.from({ length: maxQty }, (_, index) => {
    const value = index + 1;
    return `<option value="${value}"${value === 1 ? ' selected' : ''}>${value}</option>`;
  }).join('');
  const lastClass = stockCount === 1 ? ' is-last' : '';
  const canBuy = stockCount > 0 && unitPrice !== null;
  const photoLink = isPhotoLink(item.details) ? item.details : '';

  return `
    <article class="used-markdown-row">
      <div class="used-markdown-row-photo">
        ${photoLink
    ? renderTirePhotoGallery(item, photoLink, EAGER_PHOTO_CARDS, { compact: true })
    : '<div class="used-markdown-photo-empty">No photo</div>'}
      </div>
      <div class="used-markdown-row-size">
        <strong>${escapeHtml(item.size || 'N/A')}</strong>
        <span>${escapeHtml(seasonLabel)}</span>
      </div>
      <p class="used-markdown-row-brand">${escapeHtml(brandLabel)}</p>
      <p class="used-markdown-row-stock${lastClass}">${escapeHtml(stockCount ? `${stockCount} left` : 'Sold out')}</p>
      <p class="used-markdown-row-was">${listPrice !== null ? `Was ${escapeHtml(formatPrice(listPrice))}` : ''}</p>
      <p class="used-markdown-row-now">${escapeHtml(formatPrice(unitPrice))}</p>
      <p class="used-markdown-row-save">${savings !== null ? `Save ${escapeHtml(formatPrice(savings))}` : ''}</p>
      <div class="used-markdown-row-actions">
        <label class="visually-hidden" for="${escapeHtml(qtyId)}">Quantity</label>
        <select
          id="${escapeHtml(qtyId)}"
          class="used-tire-card-qty"
          data-unit-price="${unitPrice ?? ''}"
          ${canBuy ? '' : 'disabled'}
        >
          ${qtyOptions}
        </select>
        <button
          class="used-tire-card-cta is-secondary is-compact"
          type="button"
          data-tire-cart-action="add"
          data-inventory-id="${escapeHtml(item.id)}"
          ${canBuy ? '' : 'disabled'}
        >Add</button>
        <button
          class="used-tire-card-cta is-compact"
          type="button"
          data-tire-cart-action="reserve"
          data-inventory-id="${escapeHtml(item.id)}"
          ${canBuy ? '' : 'disabled'}
        >Reserve</button>
      </div>
      <p class="used-tire-card-cart-status" data-tire-cart-status aria-live="polite"></p>
    </article>
  `;
}

function renderUsedTireCard(item, cardIndex = 0, options = {}) {
  const idPrefix = options.idPrefix || '';
  const brandLabel = formatBrandLabel(item.brand);
  const brandSlug = getBrandLogoSlug(item.brand);
  const brandLogo = getBrandLogoPath(item.brand);
  const seasonLabel = formatSeasonLabel(item.season);
  const stockCount = Math.max(0, Number(item.stock) || 0);
  const maxQty = Math.max(1, Math.min(stockCount || 1, 4));
  const listPrice = item.price;
  const unitPrice = getTireSalePrice(item);
  const markdown = isMarkdownTire(item) && unitPrice !== null;
  const defaultQty = Math.min(4, maxQty);
  const setTotal = unitPrice === null ? null : unitPrice * defaultQty;
  const photoLink = isPhotoLink(item.details) ? item.details : '';
  const qtyId = `used-tire-qty-${idPrefix}${item.id}`;

  const qtyOptions = Array.from({ length: maxQty }, (_, index) => {
    const value = index + 1;
    const selected = value === defaultQty ? ' selected' : '';
    return `<option value="${value}"${selected}>${value}</option>`;
  }).join('');
  const stockAlert = renderStockAlert(stockCount, markdown);

  return `
    <article class="used-tire-card${stockCount ? '' : ' is-sold-out'}${markdown ? ' is-markdown' : ''}">
      ${markdown ? `<p class="used-tire-card-sale-badge">${escapeHtml(markdownOffLabel())}</p>` : ''}
      <div class="used-tire-card-brand">
        ${brandLogo
    ? `<img src="${escapeHtml(brandLogo)}" alt="${escapeHtml(brandLabel)}" data-brand="${escapeHtml(brandSlug)}" loading="lazy" />`
    : `<span>${escapeHtml(brandLabel)}</span>`}
      </div>

      ${stockAlert}

      ${renderTirePhotoGallery(item, photoLink, cardIndex)}

      <div class="used-tire-card-heading">
        <p class="used-tire-card-type">${escapeHtml(item.type || 'Used')}</p>
        <h3>${escapeHtml(item.title)}</h3>
        <hr class="used-tire-card-divider" />
      </div>

      <div class="used-tire-card-details">
        <div class="used-tire-card-season">
          ${renderSeasonIcon(item.seasonKey)}
          <span>${escapeHtml(seasonLabel)}</span>
        </div>
        <p class="used-tire-card-line">
          <span class="used-tire-card-label">Size:</span>
          <span class="used-tire-card-size-value">${escapeHtml(item.size || 'N/A')}</span>
        </p>
        <p class="used-tire-card-line">
          <span class="used-tire-card-label">Brand:</span>
          <strong>${escapeHtml(brandLabel)}</strong>
        </p>
        <p class="used-tire-card-line">
          <span class="used-tire-card-label">Weather type:</span>
          <strong>${escapeHtml(seasonLabel)}</strong>
        </p>
        <p class="used-tire-card-line">
          <span class="used-tire-card-label">Stock:</span>
          <strong>${escapeHtml(stockCount ? `${stockCount} in stock` : 'Out of stock')}</strong>
        </p>
      </div>

      <div class="used-tire-card-pricing">
        <div class="used-tire-card-qty-row">
          <label class="used-tire-card-qty-label" for="${escapeHtml(qtyId)}">Qty</label>
          <select
            id="${escapeHtml(qtyId)}"
            class="used-tire-card-qty"
            data-unit-price="${unitPrice ?? ''}"
            ${stockCount ? '' : 'disabled'}
          >
            ${qtyOptions}
          </select>
        </div>
        <div class="used-tire-card-price-block">
          <span class="used-tire-card-price-label">Per tire</span>
          ${markdown && listPrice !== null
    ? `<p class="used-tire-card-list-price">Was ${escapeHtml(formatPrice(listPrice))}</p>`
    : ''}
          <strong class="used-tire-card-price">${escapeHtml(formatPrice(unitPrice))}</strong>
          ${markdown && listPrice !== null && unitPrice !== null
    ? `<p class="used-tire-card-save">You save ${escapeHtml(formatPrice(Math.max(0, Math.round((listPrice - unitPrice) * 100) / 100)))}</p>`
    : ''}
          ${setTotal !== null
    ? `<p class="used-tire-card-set-total"><span data-set-label>Set of ${defaultQty}</span>: <span data-set-total>${escapeHtml(formatPrice(setTotal))}</span></p>`
    : ''}
        </div>
      </div>

      <div class="used-tire-card-actions">
        <button
          class="used-tire-card-cta is-secondary"
          type="button"
          data-tire-cart-action="add"
          data-inventory-id="${escapeHtml(item.id)}"
          ${stockCount && unitPrice !== null ? '' : 'disabled'}
        >Add to Cart</button>
        <button
          class="used-tire-card-cta"
          type="button"
          data-tire-cart-action="reserve"
          data-inventory-id="${escapeHtml(item.id)}"
          ${stockCount && unitPrice !== null ? '' : 'disabled'}
        >Reserve</button>
      </div>
      <p class="used-tire-card-cart-status" data-tire-cart-status aria-live="polite"></p>
    </article>
  `;
}

function sameTireId(left, right) {
  return String(left ?? '') === String(right ?? '');
}

function getUsedTireCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(USED_TIRE_CART_KEY) || '[]');
    if (window.EastCordAccount?.normalizeUsedTireCartItems) {
      return window.EastCordAccount.normalizeUsedTireCartItems(stored);
    }
    return Array.isArray(stored)
      ? stored.filter((item) => item?.type === 'used_tire' && item.inventoryId)
      : [];
  } catch (error) {
    console.warn('[EastCord inventory] Used tire cart could not be read.', error);
    return [];
  }
}

function saveUsedTireCart(cart) {
  const normalized = window.EastCordAccount?.normalizeUsedTireCartItems
    ? window.EastCordAccount.normalizeUsedTireCartItems(cart)
    : (Array.isArray(cart) ? cart : []);
  localStorage.setItem(USED_TIRE_CART_KEY, JSON.stringify(normalized));
  updateUsedTireCartCount();
  window.EastCordAccount?.notifyUsedTireCartChanged?.(normalized);
  window.EastCordAccount?.saveCustomerCart?.('used_tire', normalized).catch((error) => {
    console.warn('[EastCord inventory] Used tire cart account sync failed.', error);
  });
}

async function hydrateUsedTireCustomerCart() {
  if (!window.EastCordAccount?.loadCustomerCart) return;
  try {
    const mergedCart = await window.EastCordAccount.loadCustomerCart('used_tire', getUsedTireCart());
    const normalizedCart = window.EastCordAccount.normalizeUsedTireCartItems
      ? window.EastCordAccount.normalizeUsedTireCartItems([
        ...(Array.isArray(mergedCart) ? mergedCart : []),
        ...getUsedTireCart(),
      ])
      : mergedCart;
    const latestLocal = getUsedTireCart();
    if (normalizedCart.length >= latestLocal.length) {
      localStorage.setItem(USED_TIRE_CART_KEY, JSON.stringify(normalizedCart));
    }
    updateUsedTireCartCount();
    window.EastCordAccount?.notifyUsedTireCartChanged?.(getUsedTireCart());
  } catch (error) {
    console.warn('[EastCord inventory] Saved tire cart could not be loaded from the customer account.', error);
  }
}

function updateUsedTireCartCount() {
  if (window.EastCordAccount?.updateCartCount) {
    window.EastCordAccount.updateCartCount();
    return;
  }
  const count = getUsedTireCart().reduce((total, item) => total + (Number(item.qty) || 0), 0);
  document.querySelectorAll('[data-tire-cart-count]').forEach((element) => {
    element.textContent = count ? ` (${count})` : '';
  });
}

function addUsedTireToCart(item, qty) {
  const stock = Math.max(0, Number(item.stock) || 0);
  const requestedQty = Math.max(1, Number(qty) || 1);
  const salePrice = getTireSalePrice(item);
  const cart = getUsedTireCart();
  const existing = cart.find((entry) => sameTireId(entry.inventoryId, item.id));

  if (existing) {
    existing.qty = Math.min(4, stock, (Number(existing.qty) || 0) + requestedQty);
    existing.maxStock = stock;
    existing.listPrice = item.price;
    existing.unitPrice = salePrice;
    existing.markdown = isMarkdownTire(item);
  } else {
    cart.push({
      id: `used-tire-${item.id}`,
      type: 'used_tire',
      inventoryId: Number(item.id) || item.id,
      qty: Math.min(4, stock, requestedQty),
      maxStock: stock,
      listPrice: item.price,
      unitPrice: salePrice,
      markdown: isMarkdownTire(item),
      title: item.title,
      brand: item.brand,
      size: item.size,
      season: item.season,
    });
  }

  saveUsedTireCart(cart);
}

function handleTireCartAction(button) {
  const item = inventory.find((entry) => sameTireId(entry.id, button.dataset.inventoryId));
  const card = button.closest('.used-tire-card, .used-markdown-row');
  const qty = card?.querySelector('.used-tire-card-qty')?.value || 1;
  const status = card?.querySelector('[data-tire-cart-status]');

  if (!item || !isInStock(item) || getTireSalePrice(item) === null) {
    if (status) status.textContent = 'This tire is not currently available to reserve.';
    return;
  }

  addUsedTireToCart(item, qty);

  if (button.dataset.tireCartAction === 'reserve') {
    window.location.href = '/tire-cart.html';
    return;
  }

  button.textContent = 'Added';
  if (status) {
    status.innerHTML = `Added to tire cart. <a href="/tire-cart.html">View tire cart</a>`;
  }
}

function updateTireCardSetTotal(select) {
  const card = select.closest('.used-tire-card');
  const setTotalEl = card?.querySelector('[data-set-total]');
  const setLabelEl = card?.querySelector('[data-set-label]');
  const unitPrice = Number(select.dataset.unitPrice);
  const qty = Number(select.value);

  if (!setTotalEl || !Number.isFinite(unitPrice)) return;

  setTotalEl.textContent = formatPrice(unitPrice * qty);
  if (setLabelEl) {
    setLabelEl.textContent = `Set of ${qty}`;
  }
}

const drivePhotoCache = new Map();
let photoCacheByFolder = null;
let photoGalleryObserver = null;
const PHOTO_CACHE_URLS = ['/assets/tire-photo-cache.json', '/assets/drive-photo-cache.json'];
const PHOTO_LIST_ENDPOINTS = [
  '/.netlify/functions/get-tire-photos',
  '/.netlify/functions/get-drive-photos',
];
const PHOTO_PROXY_ENDPOINTS = [
  '/.netlify/functions/get-tire-image',
  '/.netlify/functions/get-drive-photo',
];
const CARD_PHOTO_PIXELS = 800;
const ZOOM_PHOTO_PIXELS = 1600;
const EAGER_PHOTO_CARDS = 4;
const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp|gif|heic|bmp)$/i;
const IMAGE_MIME_PREFIX = 'image/';

function renderPhotoControlsBar() {
  return `
    <div class="used-tire-card-photo-controls" hidden>
      <button type="button" class="used-tire-card-photo-nav is-prev" aria-label="Previous photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>
      </button>
      <span class="used-tire-card-photo-count"></span>
      <button type="button" class="used-tire-card-photo-zoom-btn" aria-label="Zoom photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
        <span>Zoom</span>
      </button>
      <button type="button" class="used-tire-card-photo-nav is-next" aria-label="Next photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>
      </button>
    </div>
  `;
}

function renderTirePhotoGallery(item, photoLink, cardIndex = 0, options = {}) {
  if (!photoLink) return '';

  const driveRef = parseDriveLink(photoLink);
  if (!driveRef) return '';

  const eager = cardIndex < EAGER_PHOTO_CARDS;
  const compact = Boolean(options.compact);

  if (driveRef.type === 'file') {
    return renderPhotoGalleryMarkup({
      photos: [toPhotoEntry({ id: driveRef.id, name: `${item.title} photo` })],
      driveUrl: photoLink,
      eager,
      label: item.title,
      compact,
    });
  }

  const cached = getPhotosFromCacheFolder(driveRef.id);
  if (cached.length) {
    return renderPhotoGalleryMarkup({
      photos: cached,
      folderId: driveRef.id,
      driveUrl: photoLink,
      eager,
      label: item.title,
      compact,
    });
  }

  return `
    <div
      class="used-tire-card-photos is-loading${compact ? ' is-compact' : ''}"
      data-tire-photos
      data-folder-id="${escapeHtml(driveRef.id)}"
      data-drive-url="${escapeHtml(photoLink)}"
      aria-label="Photos for ${escapeHtml(item.title)}"
    >
      <div class="used-tire-card-photo-track">
        <div class="used-tire-card-photo-slide is-placeholder is-active">
          <span class="used-tire-card-photo-status">Loading photos…</span>
        </div>
      </div>
      ${renderPhotoControlsBar()}
    </div>
  `;
}

function renderPhotoGalleryMarkup({ photos, folderId = '', driveUrl, eager = false, label = 'Tire', compact = false }) {
  const folderAttr = folderId ? ` data-folder-id="${escapeHtml(folderId)}"` : '';
  return `
    <div
      class="used-tire-card-photos${compact ? ' is-compact' : ''}"
      data-tire-photos
      data-photos-ready="true"
      ${folderAttr}
      data-drive-url="${escapeHtml(driveUrl)}"
      aria-label="Photos for ${escapeHtml(label)}"
    >
      <div class="used-tire-card-photo-track">
        ${renderPhotoSlides(photos, eager)}
      </div>
      ${renderPhotoControlsBar()}
    </div>
  `;
}

function hydrateTireCardPhotos(list) {
  if (!list) return;

  list.querySelectorAll('[data-tire-photos][data-photos-ready="true"]').forEach((gallery) => {
    finishGallerySetup(gallery);
  });

  const pending = [...list.querySelectorAll('[data-tire-photos].is-loading[data-folder-id]')];
  if (!pending.length) return;

  if (!('IntersectionObserver' in window)) {
    pending.forEach((gallery) => loadCardPhotos(gallery));
    return;
  }

  if (!photoGalleryObserver) {
    photoGalleryObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        photoGalleryObserver.unobserve(entry.target);
        loadCardPhotos(entry.target);
      });
    }, { rootMargin: '400px 0px', threshold: 0.01 });
  }

  pending.forEach((gallery) => photoGalleryObserver.observe(gallery));
}

function finishGallerySetup(gallery) {
  if (!gallery || gallery.dataset.photosBound === 'true') return;

  const track = gallery.querySelector('.used-tire-card-photo-track');
  const controls = gallery.querySelector('.used-tire-card-photo-controls');
  const slides = [...(track?.querySelectorAll('.used-tire-card-photo-slide') || [])];
  if (!track || !slides.length) return;

  gallery.dataset.photosBound = 'true';
  bindPhotoImages(track);
  gallery.classList.toggle('has-multiple-photos', slides.length > 1);

  if (controls) {
    if (gallery.classList.contains('is-compact')) {
      controls.hidden = true;
    } else {
      controls.hidden = false;
      if (slides.length > 1) {
        bindPhotoGalleryControls(gallery, slides.length);
      }
    }
  }
}

async function loadCardPhotos(gallery) {
  if (!gallery || gallery.dataset.photosReady === 'true') return;

  const folderId = gallery.dataset.folderId;
  const track = gallery.querySelector('.used-tire-card-photo-track');
  if (!folderId || !track) return;

  gallery.dataset.photosReady = 'true';

  try {
    const photos = await fetchDrivePhotos(folderId);
    gallery.classList.remove('is-loading');

    if (!photos.length) {
      hidePhotoGallery(gallery);
      return;
    }

    const card = gallery.closest('.used-tire-card');
    const cardIndex = card
      ? [...(card.parentElement?.children || [])].indexOf(card)
      : EAGER_PHOTO_CARDS;
    track.innerHTML = renderPhotoSlides(photos, cardIndex < EAGER_PHOTO_CARDS);
    finishGallerySetup(gallery);
  } catch (error) {
    console.warn('[EastCord inventory] Could not load tire photos.', error);
    hidePhotoGallery(gallery);
  }
}

function isValidDrivePhoto(photo) {
  if (!photo?.id) return false;
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(photo.id)) return false;
  if (photo.id.startsWith('AIza')) return false;
  return Boolean(photo.url || photo.sources?.length || photo.zoomUrl);
}

function isImageFile(file) {
  if (file.mimeType?.startsWith(IMAGE_MIME_PREFIX)) return true;
  return IMAGE_NAME_PATTERN.test(file.name || '');
}

function buildGoogleThumbUrl(photoId, pixels = CARD_PHOTO_PIXELS) {
  if (!photoId) return '';
  return `https://lh3.googleusercontent.com/d/${photoId}=s${pixels}`;
}

function buildDriveThumbUrl(photoId, pixels = CARD_PHOTO_PIXELS) {
  if (!photoId) return '';
  return `https://drive.google.com/thumbnail?id=${photoId}&sz=w${pixels}`;
}

function buildPhotoProxyUrl(photoId, size = `w${CARD_PHOTO_PIXELS}`, endpointIndex = 0) {
  if (!photoId) return '';
  const endpoint = PHOTO_PROXY_ENDPOINTS[endpointIndex] || PHOTO_PROXY_ENDPOINTS[0];
  const params = new URLSearchParams({
    id: photoId,
    sz: size,
  });
  return `${endpoint}?${params.toString()}`;
}

function toPhotoEntry(file) {
  const id = file.id;
  const name = file.name || 'Tire photo';
  const cardUrl = buildGoogleThumbUrl(id, CARD_PHOTO_PIXELS);
  const zoomUrl = buildGoogleThumbUrl(id, ZOOM_PHOTO_PIXELS);

  return {
    id,
    name,
    url: cardUrl,
    sources: buildCardPhotoSources({ id, url: cardUrl }),
    zoomUrl,
    viewUrl: `https://drive.google.com/file/d/${id}/view`,
  };
}

function buildCardPhotoSources(photo) {
  const id = photo.id;
  return [...new Set([
    photo.url,
    buildGoogleThumbUrl(id, CARD_PHOTO_PIXELS),
    buildDriveThumbUrl(id, CARD_PHOTO_PIXELS),
    buildPhotoProxyUrl(id, `w${CARD_PHOTO_PIXELS}`, 0),
    buildPhotoProxyUrl(id, `w${CARD_PHOTO_PIXELS}`, 1),
  ].filter(Boolean))];
}

function buildZoomSources(photoId) {
  return [
    buildGoogleThumbUrl(photoId, ZOOM_PHOTO_PIXELS),
    buildDriveThumbUrl(photoId, ZOOM_PHOTO_PIXELS),
    buildPhotoProxyUrl(photoId, `w${ZOOM_PHOTO_PIXELS}`, 0),
    buildPhotoProxyUrl(photoId, `w${ZOOM_PHOTO_PIXELS}`, 1),
  ].filter(Boolean);
}

function renderPhotoSlides(photos, eager = false) {
  return photos.map((photo, index) => {
    const sources = buildCardPhotoSources(photo);
    const isFirst = index === 0;
    const srcAttr = isFirst ? `src="${escapeHtml(sources[0])}"` : '';
    const loading = isFirst && eager ? 'eager' : 'lazy';
    const fetchPriority = isFirst && eager ? 'high' : 'low';
    const activeClass = isFirst ? ' is-active' : '';
    return `
      <div class="used-tire-card-photo-slide${activeClass}">
        <img
          ${srcAttr}
          data-photo-id="${escapeHtml(photo.id)}"
          data-photo-src="${escapeHtml(sources[0])}"
          alt="${escapeHtml(photo.name)}"
          loading="${loading}"
          fetchpriority="${fetchPriority}"
          decoding="async"
          referrerpolicy="no-referrer"
        />
      </div>
    `;
  }).join('');
}

function hidePhotoGallery(gallery) {
  if (!gallery) return;
  gallery.classList.remove('is-loading');
  if (gallery.classList.contains('is-compact')) {
    gallery.classList.add('is-empty');
    const track = gallery.querySelector('.used-tire-card-photo-track');
    if (track) {
      track.innerHTML = `
        <div class="used-tire-card-photo-slide is-placeholder is-active">
          <span class="used-tire-card-photo-status">No photo</span>
        </div>
      `;
    }
    const controls = gallery.querySelector('.used-tire-card-photo-controls');
    if (controls) controls.hidden = true;
    return;
  }
  gallery.hidden = true;
}

function ensureSlideImageLoaded(slide) {
  const img = slide?.querySelector('img[data-photo-src]');
  if (!img || img.getAttribute('src')) return;
  img.src = img.dataset.photoSrc;
}

function bindPhotoImages(track) {
  track.querySelectorAll('img[data-photo-id]').forEach((img) => {
    const photoId = img.dataset.photoId;
    const sources = buildCardPhotoSources({
      id: photoId,
      url: img.dataset.photoSrc || img.getAttribute('src') || '',
    });
    let attempt = Math.max(0, sources.indexOf(img.getAttribute('src') || img.dataset.photoSrc || ''));

    img.addEventListener('error', () => {
      attempt += 1;
      if (attempt < sources.length) {
        img.src = sources[attempt];
        return;
      }

      const gallery = img.closest('[data-tire-photos]');
      const slide = img.closest('.used-tire-card-photo-slide');
      if (!slide) return;
      slide.remove();

      const remainingSlides = [...(gallery?.querySelectorAll('.used-tire-card-photo-slide') || [])];
      if (!remainingSlides.length) {
        hidePhotoGallery(gallery);
        return;
      }

      const nextSlide = remainingSlides[0];
      nextSlide.classList.add('is-active');
      ensureSlideImageLoaded(nextSlide);
    });
  });
}

function getGoogleApiKey() {
  return window.EASTCORD_AUTH_CONFIG?.googleApiKey || '';
}

async function preloadPhotoCache() {
  if (photoCacheByFolder) return photoCacheByFolder;

  for (const url of PHOTO_CACHE_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const cache = await response.json();
      if (cache && typeof cache === 'object') {
        photoCacheByFolder = cache;
        return photoCacheByFolder;
      }
    } catch (error) {
      console.warn('[EastCord inventory] Photo cache fetch failed.', url, error);
    }
  }

  photoCacheByFolder = {};
  return photoCacheByFolder;
}

function getPhotosFromCacheFolder(folderId) {
  const cache = photoCacheByFolder || {};
  const photos = Array.isArray(cache[folderId]) ? cache[folderId] : [];
  return photos.map(normalizeCachedPhoto).filter(isValidDrivePhoto);
}

async function loadStaticPhotoCache(folderId) {
  await preloadPhotoCache();
  return getPhotosFromCacheFolder(folderId);
}

function normalizeCachedPhoto(photo) {
  if (!photo?.id) return photo;
  return toPhotoEntry({
    id: photo.id,
    name: photo.name || 'Tire photo',
    mimeType: /\.heic$/i.test(photo.name || '') ? 'image/heic' : '',
  });
}

async function fetchFromDriveClient(folderId) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) return [];

  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = [
    'https://www.googleapis.com/drive/v3/files',
    `?q=${query}`,
    `&key=${encodeURIComponent(apiKey)}`,
    '&fields=files(id,name,mimeType,thumbnailLink)',
    '&pageSize=20',
    '&supportsAllDrives=true',
    '&includeItemsFromAllDrives=true',
  ].join('');

  try {
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) return [];
    return (payload.files || [])
      .filter(isImageFile)
      .map(toPhotoEntry)
      .filter(isValidDrivePhoto);
  } catch (error) {
    console.warn('[EastCord inventory] Client Drive API failed.', error);
    return [];
  }
}

async function fetchFromPhotoServer(folderId) {
  for (const endpoint of PHOTO_LIST_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?folderId=${encodeURIComponent(folderId)}`);
      let payload = {};
      try {
        payload = await response.json();
      } catch (error) {
        continue;
      }

      if (!response.ok) continue;

      const photos = Array.isArray(payload.photos) ? payload.photos : [];
      const normalized = photos
        .map((photo) => normalizeCachedPhoto(photo))
        .filter(isValidDrivePhoto);
      if (normalized.length) return normalized;
    } catch (error) {
      console.warn('[EastCord inventory] Photo server failed.', endpoint, error);
    }
  }

  return [];
}

async function fetchDrivePhotos(folderId) {
  if (drivePhotoCache.has(folderId)) {
    return drivePhotoCache.get(folderId);
  }

  const request = (async () => {
    const cached = getPhotosFromCacheFolder(folderId);
    if (cached.length) return cached;

    const staticCached = await loadStaticPhotoCache(folderId);
    if (staticCached.length) return staticCached;

    const [serverPhotos, clientPhotos] = await Promise.all([
      fetchFromPhotoServer(folderId),
      fetchFromDriveClient(folderId),
    ]);

    if (serverPhotos.length) return serverPhotos;
    return clientPhotos;
  })();

  drivePhotoCache.set(folderId, request);

  try {
    const photos = await request;
    if (photos.length) {
      drivePhotoCache.set(folderId, Promise.resolve(photos));
    } else {
      drivePhotoCache.delete(folderId);
    }
    return photos;
  } catch (error) {
    drivePhotoCache.delete(folderId);
    throw error;
  }
}

let photoLightboxEl = null;
let photoLightboxItems = [];
let photoLightboxIndex = 0;

function initPhotoLightbox() {
  if (document.body.dataset.photoZoomBound) return;
  document.body.dataset.photoZoomBound = 'true';

  document.addEventListener('click', (event) => {
    if (event.target.closest('.used-tire-card-photo-nav')) return;

    const zoomTrigger = event.target.closest('.used-tire-card-photo-zoom-btn');
    const compactGallery = event.target.closest('.used-tire-card-photos.is-compact:not(.is-empty)');
    const gallery = zoomTrigger?.closest('[data-tire-photos]') || compactGallery;
    const img = gallery?.querySelector('.used-tire-card-photo-slide.is-active img');
    if (!gallery || !img) return;

    event.preventDefault();
    openPhotoLightbox(gallery, img);
  });
}

function ensurePhotoLightbox() {
  if (photoLightboxEl) return photoLightboxEl;

  photoLightboxEl = document.createElement('div');
  photoLightboxEl.className = 'used-tire-photo-lightbox';
  photoLightboxEl.hidden = true;
  photoLightboxEl.innerHTML = `
    <button type="button" class="used-tire-photo-lightbox-backdrop" aria-label="Close zoom"></button>
    <div class="used-tire-photo-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Tire photo zoom">
      <button type="button" class="used-tire-photo-lightbox-close" aria-label="Close zoom">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <button type="button" class="used-tire-photo-lightbox-nav is-prev" aria-label="Previous photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>
      </button>
      <img class="used-tire-photo-lightbox-image" alt="" referrerpolicy="no-referrer" />
      <button type="button" class="used-tire-photo-lightbox-nav is-next" aria-label="Next photo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>
      </button>
      <p class="used-tire-photo-lightbox-count"></p>
    </div>
  `;

  document.body.appendChild(photoLightboxEl);

  photoLightboxEl.querySelector('.used-tire-photo-lightbox-backdrop')
    ?.addEventListener('click', closePhotoLightbox);
  photoLightboxEl.querySelector('.used-tire-photo-lightbox-close')
    ?.addEventListener('click', closePhotoLightbox);
  photoLightboxEl.querySelector('.used-tire-photo-lightbox-nav.is-prev')
    ?.addEventListener('click', () => stepPhotoLightbox(-1));
  photoLightboxEl.querySelector('.used-tire-photo-lightbox-nav.is-next')
    ?.addEventListener('click', () => stepPhotoLightbox(1));

  document.addEventListener('keydown', (event) => {
    if (photoLightboxEl?.hidden) return;
    if (event.key === 'Escape') closePhotoLightbox();
    if (event.key === 'ArrowLeft') stepPhotoLightbox(-1);
    if (event.key === 'ArrowRight') stepPhotoLightbox(1);
  });

  return photoLightboxEl;
}

function buildZoomUrl(photoId, fallbackSrc = '') {
  if (photoId) {
    return buildGoogleThumbUrl(photoId, ZOOM_PHOTO_PIXELS);
  }
  const idMatch = String(fallbackSrc).match(/[?&]id=([^&]+)|\/d\/([^=/?&]+)/);
  if (idMatch) {
    return buildGoogleThumbUrl(decodeURIComponent(idMatch[1] || idMatch[2]), ZOOM_PHOTO_PIXELS);
  }
  return fallbackSrc;
}

function collectGalleryZoomItems(gallery) {
  return [...gallery.querySelectorAll('.used-tire-card-photo-slide img')]
    .map((img) => ({
      photoId: img.dataset.photoId || '',
      zoomUrl: buildZoomUrl(img.dataset.photoId, img.src || img.dataset.photoSrc),
      alt: img.alt || 'Tire photo',
    }))
    .filter((item) => item.zoomUrl);
}

function openPhotoLightbox(gallery, activeImg) {
  const lightbox = ensurePhotoLightbox();
  photoLightboxItems = collectGalleryZoomItems(gallery);
  if (!photoLightboxItems.length) return;

  const imgs = [...gallery.querySelectorAll('.used-tire-card-photo-slide img')];
  photoLightboxIndex = Math.max(0, imgs.indexOf(activeImg));

  lightbox.hidden = false;
  document.body.classList.add('used-tire-photo-lightbox-open');
  renderPhotoLightboxSlide();
}

function closePhotoLightbox() {
  if (!photoLightboxEl) return;
  photoLightboxEl.hidden = true;
  document.body.classList.remove('used-tire-photo-lightbox-open');
  photoLightboxItems = [];
  photoLightboxIndex = 0;
}

function stepPhotoLightbox(direction) {
  if (!photoLightboxItems.length) return;
  photoLightboxIndex = Math.max(0, Math.min(photoLightboxIndex + direction, photoLightboxItems.length - 1));
  renderPhotoLightboxSlide();
}

function renderPhotoLightboxSlide() {
  if (!photoLightboxEl || !photoLightboxItems.length) return;

  const item = photoLightboxItems[photoLightboxIndex];
  const image = photoLightboxEl.querySelector('.used-tire-photo-lightbox-image');
  const count = photoLightboxEl.querySelector('.used-tire-photo-lightbox-count');
  const prev = photoLightboxEl.querySelector('.used-tire-photo-lightbox-nav.is-prev');
  const next = photoLightboxEl.querySelector('.used-tire-photo-lightbox-nav.is-next');
  const hasMultiple = photoLightboxItems.length > 1;

  if (image) {
    const sources = item.photoId ? buildZoomSources(item.photoId) : [item.zoomUrl].filter(Boolean);
    let attempt = 0;
    image.onerror = () => {
      attempt += 1;
      if (attempt < sources.length) {
        image.src = sources[attempt];
      }
    };
    image.src = sources[0] || item.zoomUrl;
    image.alt = item.alt;
  }

  if (count) {
    count.textContent = hasMultiple ? `${photoLightboxIndex + 1} / ${photoLightboxItems.length}` : '';
    count.hidden = !hasMultiple;
  }

  if (prev) {
    prev.hidden = !hasMultiple;
    prev.disabled = photoLightboxIndex <= 0;
  }

  if (next) {
    next.hidden = !hasMultiple;
    next.disabled = photoLightboxIndex >= photoLightboxItems.length - 1;
  }
}

function bindPhotoGalleryControls(gallery, totalPhotos) {
  const track = gallery.querySelector('.used-tire-card-photo-track');
  const countEl = gallery.querySelector('.used-tire-card-photo-count');
  const prevButton = gallery.querySelector('.used-tire-card-photo-nav.is-prev');
  const nextButton = gallery.querySelector('.used-tire-card-photo-nav.is-next');
  if (!track || !countEl || !prevButton || !nextButton) return;

  const slides = [...track.querySelectorAll('.used-tire-card-photo-slide')];
  let activeIndex = 0;

  const setActiveSlide = (index) => {
    activeIndex = Math.max(0, Math.min(index, totalPhotos - 1));
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle('is-active', slideIndex === activeIndex);
    });
    ensureSlideImageLoaded(slides[activeIndex]);
    countEl.textContent = `${activeIndex + 1} / ${totalPhotos}`;
    prevButton.disabled = activeIndex <= 0;
    nextButton.disabled = activeIndex >= totalPhotos - 1;
  };

  prevButton.addEventListener('click', () => setActiveSlide(activeIndex - 1));
  nextButton.addEventListener('click', () => setActiveSlide(activeIndex + 1));

  setActiveSlide(0);
}

function parseDriveLink(url) {
  const value = clean(url);
  if (!value) return null;

  const folderMatch = value.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) {
    return { type: 'folder', id: folderMatch[1] };
  }

  const fileMatch = value.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return { type: 'file', id: fileMatch[1] };
  }

  return null;
}

function formatBrandLabel(brand) {
  const label = clean(brand);
  if (!label) return 'Tire';
  return label.split('/')[0].trim();
}

function formatSeasonLabel(season) {
  const label = clean(season);
  if (!label) return 'All season';
  return label
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getBrandLogoSlug(brand) {
  const normalized = formatBrandLabel(brand).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const map = {
    bridgestone: 'bridgestone',
    continental: 'continental',
    firestone: 'firestone',
    goodyear: 'goodyear',
    hankook: 'hankook',
    michelin: 'michelin',
    yokohama: 'yokohama',
    bfgoodrich: 'bfgoodrich',
    'general-tire': 'general-tire',
  };

  return map[normalized] || '';
}

function getBrandLogoPath(brand) {
  const slug = getBrandLogoSlug(brand);
  return slug ? `/assets/brands/${slug}.svg?v=3` : null;
}

function isPhotoLink(value) {
  const link = clean(value);
  return /^https?:\/\//i.test(link);
}

function renderStockAlert(stockCount, markdown = false) {
  if (stockCount <= 0) {
    return `<p class="used-tire-card-stock-alert is-sold-out">Sold out — contact EastCord Tires for availability.</p>`;
  }
  if (markdown) {
    return `<p class="used-tire-card-stock-alert is-markdown">Only ${stockCount} left</p>`;
  }
  if (stockCount <= LOW_STOCK_THRESHOLD) {
    return `<p class="used-tire-card-stock-alert is-low">Only ${stockCount} left in stock — order soon.</p>`;
  }
  return '<p class="used-tire-card-stock-alert is-placeholder" aria-hidden="true">&nbsp;</p>';
}

function renderSeasonIcon(seasonKey) {
  if (seasonKey === 'winter') {
    return `
      <svg class="used-tire-card-season-icon is-winter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M12 3v18M5.6 5.6l12.8 12.8M20.4 5.6 7.6 18.4M3 12h18" />
      </svg>
    `;
  }

  if (seasonKey === 'summer') {
    return `
      <svg class="used-tire-card-season-icon is-summer" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      </svg>
    `;
  }

  return `
    <svg class="used-tire-card-season-icon is-all-season" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <circle cx="8" cy="9" r="3.5" />
      <path d="M8 2.5v2M8 13.5v2M3.5 9h2M10.5 9h2M5.1 5.1l1.4 1.4M9.5 9.5l1.4 1.4M5.1 12.9l1.4-1.4M9.5 9.5l1.4-1.4" />
      <path d="M14 14c0-2.2 1.8-4 4-4 1.4 0 2.6.7 3.3 1.8" />
      <path d="M18 10.5V9M21.5 14h-1.8M19.8 11.8l1.2-1.2" />
    </svg>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(price) {
  if (price === null) return 'Call for price';
  if (window.EastCordAccount?.money) {
    return window.EastCordAccount.money(price);
  }
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(price);
}
