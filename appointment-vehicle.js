(() => {
  const VPIC = 'https://vpic.nhtsa.dot.gov/api/vehicles';
  const CURRENT_YEAR = new Date().getFullYear();
  const YEAR_START = 1990;
  const COLOURS = [
    'Black', 'White', 'Silver', 'Grey', 'Red', 'Blue', 'Green',
    'Brown', 'Beige', 'Gold', 'Orange', 'Yellow', 'Purple', 'Other',
  ];
  const WIDTHS = [155, 165, 175, 185, 195, 205, 215, 225, 235, 245, 255, 265, 275, 285, 295, 305, 315];
  const PROFILES = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
  const RIMS = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24];
  const COLOUR_SWATCHES = {
    Black: '#111317',
    White: '#ffffff',
    Silver: '#c5c8ce',
    Grey: '#6b7280',
    Red: '#df1f2d',
    Blue: '#2563eb',
    Green: '#16803c',
    Brown: '#7c4a1f',
    Beige: '#d8c3a5',
    Gold: '#c9a227',
    Orange: '#ea580c',
    Yellow: '#eab308',
    Purple: '#7c3aed',
    Other: 'linear-gradient(135deg, #df1f2d 0%, #111317 100%)',
  };
  const JUNK_MODELS = /^(miami|detroit|seoul|hwaseong|gwangmyeong|west point|georgia|ohio|alabama|mexico|canada|usa|united states|korea|south korea|china|japan|plant|assembly|unknown|incomplete|other|n\/a|none|null)$/i;
  const MOTORCYCLE_MODELS = /^(cb\d|cbr|crf|cr\s|gl\d|st\d|nc\d|vfr|rc\d|africa twin|gold wing|shadow|rebel|grom|super cub|metro|pcx|forza|ruckus)/i;
  const VEHICLE_TYPES = ['passenger', 'truck'];
  const CONSUMER_MAKES = [
    'Acura', 'Alfa Romeo', 'Aston Martin', 'Audi', 'Bentley', 'BMW', 'Bugatti', 'Buick', 'BYD',
    'Cadillac', 'Chevrolet', 'Chrysler', 'Daewoo', 'Datsun', 'Dodge', 'Eagle', 'Ferrari', 'Fiat',
    'Fisker', 'Ford', 'Genesis', 'Geo', 'GMC', 'Honda', 'Hummer', 'Hyundai', 'Ineos', 'Infiniti',
    'Isuzu', 'Jaguar', 'Jeep', 'Karma', 'Kia', 'Lamborghini', 'Land Rover', 'Lexus', 'Lincoln',
    'Lotus', 'Lucid', 'Maserati', 'Maybach', 'Mazda', 'McLaren', 'Mercedes-Benz', 'Mercury',
    'Mini', 'Mitsubishi', 'Nissan', 'Oldsmobile', 'Pagani', 'Peugeot', 'Plymouth', 'Polestar',
    'Pontiac', 'Porsche', 'Ram', 'Renault', 'Rivian', 'Rolls-Royce', 'Saab', 'Saturn', 'Scout',
    'Scion', 'Slate', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'VinFast', 'Volkswagen',
    'Volvo', 'Zeekr',
  ];
  const MAKE_DISPLAY = {
    bmw: 'BMW',
    byd: 'BYD',
    gmc: 'GMC',
    kia: 'Kia',
    mini: 'Mini',
    ram: 'Ram',
    'mercedes-benz': 'Mercedes-Benz',
    'land rover': 'Land Rover',
    'alfa romeo': 'Alfa Romeo',
    'rolls-royce': 'Rolls-Royce',
    'aston martin': 'Aston Martin',
  };
  const FALLBACK_MODELS = {
    Acura: ['ILX', 'Integra', 'MDX', 'RDX', 'TLX'],
    Audi: ['A3', 'A4', 'A6', 'Q3', 'Q5', 'Q7'],
    BMW: ['3 Series', '5 Series', 'X1', 'X3', 'X5'],
    Buick: ['Enclave', 'Encore', 'Envision'],
    Cadillac: ['CT5', 'Escalade', 'XT5', 'XT6'],
    Chevrolet: ['Blazer', 'Equinox', 'Malibu', 'Silverado', 'Suburban', 'Tahoe', 'Traverse', 'Trax'],
    Chrysler: ['300', 'Pacifica', 'Voyager'],
    Dodge: ['Charger', 'Durango', 'Hornet', 'Journey'],
    Ford: ['Bronco', 'Edge', 'Escape', 'Explorer', 'F-150', 'Maverick', 'Mustang', 'Ranger'],
    GMC: ['Acadia', 'Canyon', 'Sierra', 'Terrain', 'Yukon'],
    Honda: ['Accord', 'Civic', 'CR-V', 'HR-V', 'Odyssey', 'Passport', 'Pilot', 'Ridgeline'],
    Hyundai: ['Elantra', 'Elantra GT', 'Kona', 'Palisade', 'Santa Fe', 'Sonata', 'Tucson', 'Venue'],
    Infiniti: ['Q50', 'QX50', 'QX60', 'QX80'],
    Jeep: ['Cherokee', 'Compass', 'Gladiator', 'Grand Cherokee', 'Wrangler'],
    Kia: ['Cadenza', 'Forte', 'Forte Koup', 'K5', 'Niro', 'Optima', 'Rio', 'Rondo', 'Sedona', 'Seltos', 'Sorento', 'Soul', 'Sportage', 'Stinger', 'Telluride'],
    Lexus: ['ES', 'NX', 'RX', 'UX'],
    Mazda: ['CX-30', 'CX-5', 'CX-50', 'CX-90', 'Mazda3', 'Mazda6'],
    'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE'],
    Mini: ['Cooper', 'Countryman'],
    Mitsubishi: ['Eclipse Cross', 'Outlander', 'RVR'],
    Nissan: ['Altima', 'Frontier', 'Kicks', 'Murano', 'Pathfinder', 'Rogue', 'Sentra', 'Titan'],
    Ram: ['1500', '2500', 'ProMaster'],
    Subaru: ['Ascent', 'Crosstrek', 'Forester', 'Impreza', 'Outback'],
    Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
    Toyota: ['4Runner', 'Camry', 'Corolla', 'Highlander', 'Prius', 'RAV4', 'Sienna', 'Tacoma', 'Tundra'],
    Volkswagen: ['Atlas', 'Golf', 'Jetta', 'Tiguan'],
    Volvo: ['S60', 'XC40', 'XC60', 'XC90'],
  };

  const cache = {
    makes: [...new Set([...Object.keys(FALLBACK_MODELS), ...CONSUMER_MAKES])]
      .sort((a, b) => a.localeCompare(b)),
    makesLoaded: false,
    makesPromise: null,
    models: new Map(),
  };

  const els = {};

  function optionHtml(value, label = value) {
    return `<option value="${String(value).replace(/"/g, '&quot;')}">${label}</option>`;
  }

  function fillSelect(select, values, placeholder) {
    if (!select) return;
    const current = String(select.value || '');
    select.innerHTML = [optionHtml('', placeholder), ...values.map((value) => optionHtml(value))].join('');
    if (current && values.some((value) => String(value) === current)) {
      select.value = current;
    } else if (current) {
      select.insertAdjacentHTML('beforeend', optionHtml(current));
      select.value = current;
    }
    syncFancySelect(select);
  }

  function ensureOption(select, value) {
    if (!select || !value) return;
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (!exists) select.insertAdjacentHTML('beforeend', optionHtml(value));
    select.value = value;
    syncFancySelect(select);
  }

  function parseTireSize(value) {
    const match = String(value || '').toUpperCase().replace(/\s+/g, '').match(/(\d{3})\/(\d{2})Z?R(\d{2})/);
    if (!match) return null;
    return { width: match[1], profile: match[2], rim: match[3] };
  }

  function syncTireSize() {
    const width = els.width?.value || '';
    const profile = els.profile?.value || '';
    const rim = els.rim?.value || '';
    const complete = Boolean(width && profile && rim);
    const size = complete ? `${width}/${profile}R${rim}` : '';
    if (els.sizeValue) {
      els.sizeValue.value = size;
      els.sizeValue.dispatchEvent(new Event('input', { bubbles: true }));
      els.sizeValue.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (els.sizePreview) {
      els.sizePreview.textContent = complete
        ? size
        : `${width || '—'} / ${profile || '—'} R ${rim || '—'}`;
      els.sizePreview.classList.toggle('is-complete', complete);
    }
    syncFancySelect(els.width);
    syncFancySelect(els.profile);
    syncFancySelect(els.rim);
    refreshTireSizeSuggestions({ keepList: true });
  }

  function colourSwatch(name) {
    const fill = COLOUR_SWATCHES[name];
    if (!fill) return '';
    return `<span class="fancy-select-swatch" style="background:${fill}"></span>`;
  }

  function closeFancySelects(exceptRoot, { skipCommit = false } = {}) {
    document.querySelectorAll('[data-fancy-select].is-open').forEach((root) => {
      if (root === exceptRoot) return;
      if (!skipCommit) commitFancyInput(root);
      root.classList.remove('is-open');
      const menu = root.querySelector('[data-fancy-select-menu]');
      const trigger = root.querySelector('[data-fancy-select-trigger]');
      if (menu) menu.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
    });
  }

  function selectedOptionText(select) {
    if (!select?.value) return '';
    return select.options[select.selectedIndex]?.text || select.value;
  }

  function normalizeTypedValue(select, raw) {
    const typed = String(raw || '').trim();
    if (!typed) return '';
    if (select.matches('[data-vehicle-year], [name="Vehicle Year"]')) {
      const year = typed.replace(/\D/g, '');
      const numeric = Number(year);
      if (year.length !== 4 || numeric < 1950 || numeric > CURRENT_YEAR + 2) return null;
      return year;
    }
    if (select.matches('[data-tire-width], [data-tire-profile], [data-tire-rim]')) {
      const number = typed.replace(/\D/g, '');
      return number || null;
    }
    return typed;
  }

  function findMatchingOption(select, typed) {
    const needle = String(typed || '').trim().toLowerCase();
    if (!needle) return null;
    return Array.from(select.options).find((option) => (
      option.value
      && (option.value.toLowerCase() === needle || option.text.toLowerCase() === needle)
    )) || null;
  }

  function menuQuery(select, input) {
    const typed = String(input?.value || '').trim();
    const selectedText = selectedOptionText(select);
    if (!typed || typed.toLowerCase() === selectedText.toLowerCase()) return '';
    return typed;
  }

  function renderFancyMenu(select, query = '') {
    const root = select?.closest('[data-fancy-select]');
    const menu = root?.querySelector('[data-fancy-select-menu]');
    if (!root || !menu) return;
    const needle = String(query || '').trim().toLowerCase();
    const options = Array.from(select.options).filter((option) => option.value);
    const filtered = needle
      ? options.filter((option) => (
        option.text.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle)
      ))
      : options;
    const items = filtered.map((option) => {
      const selected = option.value === select.value;
      const swatch = root.dataset.fancySelect === 'colour' ? colourSwatch(option.value) : '';
      return `<button type="button" class="fancy-select-option${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-value="${String(option.value).replace(/"/g, '&quot;')}">${swatch}<span>${option.text}</span></button>`;
    });
    menu.innerHTML = items.join('');
    menu.hidden = !root.classList.contains('is-open') || !items.length;
  }

  function openFancySelect(root, { query } = {}) {
    const select = root.querySelector('select');
    const trigger = root.querySelector('[data-fancy-select-trigger]');
    const menu = root.querySelector('[data-fancy-select-menu]');
    if (!select || select.disabled || !trigger || !menu) return;
    closeFancySelects(root);
    root.classList.add('is-open');
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    renderFancyMenu(select, query ?? menuQuery(select, trigger));
  }

  function applySelectValue(select, value, { silent } = {}) {
    if (!select) return;
    const next = String(value || '').trim();
    if (!next) {
      select.value = '';
    } else {
      const match = findMatchingOption(select, next);
      if (match) select.value = match.value;
      else ensureOption(select, next);
    }
    syncFancySelect(select);
    if (!silent) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function commitFancyInput(root) {
    const select = root?.querySelector('select');
    const input = root?.querySelector('[data-fancy-select-trigger]');
    if (!select || !input || select.disabled) return;
    const normalized = normalizeTypedValue(select, input.value);
    if (normalized === null) {
      syncFancySelect(select);
      return;
    }
    if (normalized === selectedOptionText(select) || normalized === select.value) {
      syncFancySelect(select);
      return;
    }
    applySelectValue(select, normalized);
  }

  function syncFancySelect(select) {
    const root = select?.closest('[data-fancy-select]');
    if (!root) return;
    const trigger = root.querySelector('[data-fancy-select-trigger]');
    const menu = root.querySelector('[data-fancy-select-menu]');
    const swatchEl = root.querySelector('[data-fancy-select-swatch]');
    if (!trigger || !menu) return;

    const placeholder = select.options[0]?.text || 'Select';
    const hasValue = Boolean(select.value);
    const selectedText = hasValue ? selectedOptionText(select) : '';
    if (trigger.tagName === 'INPUT') {
      trigger.disabled = select.disabled;
      trigger.placeholder = placeholder;
      if (document.activeElement !== trigger) trigger.value = selectedText;
    }
    trigger.setAttribute('aria-expanded', root.classList.contains('is-open') ? 'true' : 'false');
    root.classList.toggle('is-disabled', select.disabled);
    root.classList.toggle('has-value', hasValue);
    if (swatchEl) {
      const fill = hasValue ? COLOUR_SWATCHES[select.value] : '';
      swatchEl.hidden = !fill;
      swatchEl.style.background = fill || 'transparent';
      root.classList.toggle('has-swatch', Boolean(fill));
    }
    renderFancyMenu(select, menuQuery(select, trigger));
  }

  function bindFancySelects() {
    const form = document.querySelector('[data-appointment-form]');
    if (!form || form.dataset.fancySelectBound === 'true') return;
    form.dataset.fancySelectBound = 'true';

    form.addEventListener('click', (event) => {
      const option = event.target.closest('.fancy-select-option');
      const root = event.target.closest('[data-fancy-select]');
      const trigger = event.target.closest('[data-fancy-select-trigger]');
      if (option && root) {
        const select = root.querySelector('select');
        if (!select || select.disabled) return;
        applySelectValue(select, option.dataset.value || '');
        closeFancySelects(null, { skipCommit: true });
        return;
      }
      if (!trigger || !root) return;
      const select = root.querySelector('select');
      if (!select || select.disabled) return;
      openFancySelect(root);
    });

    form.addEventListener('input', (event) => {
      const trigger = event.target.closest('[data-fancy-select-trigger]');
      const root = event.target.closest('[data-fancy-select]');
      if (!trigger || trigger.tagName !== 'INPUT' || !root) return;
      const select = root.querySelector('select');
      if (!select || select.disabled) return;
      openFancySelect(root, { query: trigger.value });
    });

    form.addEventListener('keydown', (event) => {
      const trigger = event.target.closest('[data-fancy-select-trigger]');
      const root = event.target.closest('[data-fancy-select]');
      if (!trigger || !root) return;
      const select = root.querySelector('select');
      if (!select || select.disabled) return;
      if (event.key === 'Escape') {
        closeFancySelects();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openFancySelect(root);
        root.querySelector('.fancy-select-option')?.focus();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const first = root.querySelector('.fancy-select-option');
        if (first) applySelectValue(select, first.dataset.value || '');
        else commitFancyInput(root);
        closeFancySelects(null, { skipCommit: true });
      }
    });

    form.querySelectorAll('[data-fancy-select] select').forEach((select) => {
      select.addEventListener('change', () => syncFancySelect(select));
      select.addEventListener('invalid', () => {
        const trigger = select.closest('[data-fancy-select]')?.querySelector('[data-fancy-select-trigger]');
        trigger?.focus();
      });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-fancy-select]')) closeFancySelects();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeFancySelects();
    });
  }

  function makeLookupKey(value) {
    return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  }

  function preferredMakeName(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const lookup = makeLookupKey(trimmed);
    const known = CONSUMER_MAKES.find((name) => makeLookupKey(name) === lookup)
      || Object.keys(FALLBACK_MODELS).find((name) => makeLookupKey(name) === lookup);
    if (known) return known;
    const mapped = MAKE_DISPLAY[trimmed.toLowerCase()];
    if (mapped) return mapped;
    return trimmed.replace(/\w+/g, (word) => {
      if (word.length <= 3) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    });
  }

  function isConsumerMake(name) {
    const lookup = makeLookupKey(name);
    return CONSUMER_MAKES.some((make) => makeLookupKey(make) === lookup)
      || Object.keys(FALLBACK_MODELS).some((make) => makeLookupKey(make) === lookup);
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function fallbackModelsForMake(make) {
    const match = Object.keys(FALLBACK_MODELS).find((name) => makeLookupKey(name) === makeLookupKey(make));
    return match ? FALLBACK_MODELS[match] : [];
  }

  function isLikelyModelName(name, make) {
    const model = String(name || '').trim();
    if (!model || model.length > 40) return false;
    if (JUNK_MODELS.test(model) || MOTORCYCLE_MODELS.test(model)) return false;
    if (make && model.toLowerCase() === String(make).toLowerCase()) return false;
    if (/\b(inc\.?|llc|ltd|corp|company|industries|trailers|manufacturing|steel|motors?|automotive)\b/i.test(model)) {
      return false;
    }
    return true;
  }

  function setTireSize(value) {
    const parsed = parseTireSize(value);
    if (!parsed) return;
    if (els.width && !WIDTHS.includes(Number(parsed.width))) {
      ensureOption(els.width, parsed.width);
    } else if (els.width) {
      els.width.value = parsed.width;
    }
    if (els.profile && !PROFILES.includes(Number(parsed.profile))) {
      ensureOption(els.profile, parsed.profile);
    } else if (els.profile) {
      els.profile.value = parsed.profile;
    }
    if (els.rim && !RIMS.includes(Number(parsed.rim))) {
      ensureOption(els.rim, parsed.rim);
    } else if (els.rim) {
      els.rim.value = parsed.rim;
    }
    if (els.profile) els.profile.disabled = !els.width?.value;
    if (els.rim) els.rim.disabled = !els.profile?.value;
    syncTireSize();
  }

  function vehicleSizeLabel(year, make, model) {
    return [year, make, model].filter(Boolean).join(' ');
  }

  function refreshTireSizeSuggestions({ keepList = false } = {}) {
    const box = els.sizeSuggestions;
    const list = els.sizeSuggestionList;
    const label = els.sizeSuggestionsLabel;
    if (!box || !list) return;

    const year = els.year?.value || '';
    const make = els.make?.value || '';
    const model = els.model?.value || '';
    const sizes = (year && make && model)
      ? (window.EastCordVehicleTireSizes?.lookup?.(year, make, model) || [])
      : [];

    if (!sizes.length) {
      box.hidden = true;
      if (!keepList) list.innerHTML = '';
      return;
    }

    const current = String(els.sizeValue?.value || '').toUpperCase();
    const existing = Array.from(list.querySelectorAll('[data-tire-size-suggestion]'))
      .map((button) => button.dataset.tireSizeSuggestion);
    if (!keepList || existing.join('|') !== sizes.join('|')) {
      list.innerHTML = sizes.map((size) => (
        `<button type="button" class="tire-size-suggestion" data-tire-size-suggestion="${size}">${size}</button>`
      )).join('');
    }
    list.querySelectorAll('[data-tire-size-suggestion]').forEach((button) => {
      const selected = String(button.dataset.tireSizeSuggestion || '').toUpperCase() === current;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (label) label.textContent = `Common sizes for ${vehicleSizeLabel(year, make, model)}`;
    box.hidden = false;
  }

  function bindTireSizeSuggestions() {
    const list = els.sizeSuggestionList;
    if (!list || list.dataset.bound === 'true') return;
    list.dataset.bound = 'true';
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tire-size-suggestion]');
      if (!button) return;
      setTireSize(button.dataset.tireSizeSuggestion || '');
    });
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Vehicle list request failed (${response.status})`);
    return response.json();
  }

  async function loadMakes() {
    if (cache.makesLoaded) return cache.makes;
    if (cache.makesPromise) return cache.makesPromise;
    cache.makesPromise = (async () => {
      try {
        const payloads = await Promise.all(VEHICLE_TYPES.map((type) => (
          fetchJson(`${VPIC}/GetMakesForVehicleType/${encodeURIComponent(type)}?format=json`)
            .catch(() => ({ Results: [] }))
        )));
        const remote = payloads.flatMap((payload) => payload.Results || [])
          .map((row) => String(row.MakeName || row.Make_Name || '').trim())
          .filter(isConsumerMake)
          .map(preferredMakeName);
        cache.makes = uniqueSorted([...cache.makes, ...remote]);
      } catch (error) {
        console.warn('[EastCord appointment] Vehicle make list is using the offline catalog.', error);
      }
      cache.makesLoaded = true;
      return cache.makes;
    })();
    return cache.makesPromise;
  }

  async function loadModels(year, make) {
    if (!year || !make) return [];
    const cacheKey = `${year}::${make}`.toLowerCase();
    if (cache.models.has(cacheKey)) return cache.models.get(cacheKey);

    const fallback = fallbackModelsForMake(make);
    let models = [...fallback];
    try {
      const payloads = await Promise.all(VEHICLE_TYPES.map((type) => (
        fetchJson(
          `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}/vehicletype/${encodeURIComponent(type)}?format=json`,
        ).catch(() => ({ Results: [] }))
      )));
      const remote = payloads.flatMap((payload) => payload.Results || [])
        .map((row) => String(row.Model_Name || '').trim())
        .filter((name) => isLikelyModelName(name, make));
      models = uniqueSorted(remote.length ? [...remote, ...fallback] : fallback);
    } catch (error) {
      console.warn('[EastCord appointment] Vehicle model list is using the offline catalog.', error);
      models = uniqueSorted(fallback);
    }
    cache.models.set(cacheKey, models);
    return models;
  }

  async function onYearChange() {
    const year = els.year?.value || '';
    if (els.make) {
      els.make.disabled = !year;
      if (!year) els.make.value = '';
    }
    if (year && els.make) {
      fillSelect(els.make, cache.makes, 'Select or type make');
      const makes = await loadMakes();
      if (els.year?.value !== year) return;
      fillSelect(els.make, makes, 'Select or type make');
    }
    if (year && els.make?.value) {
      await onMakeChange();
      return;
    }
    if (els.model) {
      els.model.disabled = true;
      fillSelect(els.model, [], 'Select or type model');
    }
    syncFancySelect(els.make);
    syncFancySelect(els.model);
    refreshTireSizeSuggestions();
  }

  async function onMakeChange() {
    const year = els.year?.value || '';
    const make = els.make?.value || '';
    if (!els.model) return;
    els.model.disabled = !year || !make;
    if (!year || !make) {
      fillSelect(els.model, [], 'Select or type model');
      refreshTireSizeSuggestions();
      return;
    }
    fillSelect(els.model, [], 'Loading models...');
    els.model.disabled = false;
    syncFancySelect(els.model);
    const models = await loadModels(year, make);
    if (els.year?.value !== year || els.make?.value !== make) return;
    fillSelect(els.model, models, models.length ? 'Select or type model' : 'Type the model');
    els.model.disabled = false;
    syncFancySelect(els.model);
    refreshTireSizeSuggestions();
  }

  async function setVehicle({ year, make, model, colour, tireSize } = {}) {
    if (year && els.year) {
      ensureOption(els.year, String(year));
      await onYearChange();
    }
    if (make && els.make) {
      ensureOption(els.make, make);
      els.make.disabled = false;
      await onMakeChange();
    }
    if (model && els.model) {
      ensureOption(els.model, model);
      els.model.disabled = false;
    }
    if (colour && els.colour) ensureOption(els.colour, colour);
    if (tireSize) setTireSize(tireSize);
    [els.year, els.make, els.model, els.colour, els.width, els.profile, els.rim].forEach(syncFancySelect);
    refreshTireSizeSuggestions();
  }

  function hydrateFromForm() {
    return setVehicle({
      year: els.year?.value,
      make: els.make?.value,
      model: els.model?.value,
      colour: els.colour?.value,
      tireSize: els.sizeValue?.value,
    });
  }

  function cacheElements() {
    const form = document.querySelector('[data-appointment-form]');
    els.year = form?.elements.namedItem('Vehicle Year');
    els.make = form?.elements.namedItem('Vehicle Make');
    els.model = form?.elements.namedItem('Vehicle Model');
    els.colour = form?.elements.namedItem('Vehicle Colour');
    els.width = form?.querySelector('[data-tire-width]');
    els.profile = form?.querySelector('[data-tire-profile]');
    els.rim = form?.querySelector('[data-tire-rim]');
    els.sizeValue = form?.elements.namedItem('Tire Size') || form?.querySelector('[data-tire-size-value]');
    els.sizePreview = form?.querySelector('[data-tire-size-preview]');
    els.sizeSuggestions = form?.querySelector('[data-tire-size-suggestions]');
    els.sizeSuggestionList = form?.querySelector('[data-tire-size-suggestion-list]');
    els.sizeSuggestionsLabel = form?.querySelector('[data-tire-size-suggestions-label]');
  }

  function init() {
    cacheElements();
    if (!els.year || !els.make || !els.model) return;

    const years = [];
    for (let year = CURRENT_YEAR + 1; year >= YEAR_START; year -= 1) years.push(String(year));
    fillSelect(els.year, years, 'Select or type year');
    fillSelect(els.make, cache.makes, 'Select or type make');
    fillSelect(els.model, [], 'Select or type model');
    if (els.colour) fillSelect(els.colour, COLOURS, 'Select or type colour');
    if (els.width) fillSelect(els.width, WIDTHS.map(String), 'Width');
    if (els.profile) fillSelect(els.profile, PROFILES.map(String), 'Profile');
    if (els.rim) fillSelect(els.rim, RIMS.map(String), 'Rim');
    syncTireSize();

    els.make.disabled = !els.year.value;
    els.model.disabled = !els.year.value || !els.make.value;
    if (els.profile) els.profile.disabled = !els.width?.value;
    if (els.rim) els.rim.disabled = !els.profile?.value;

    els.year.addEventListener('change', onYearChange);
    els.make.addEventListener('change', onMakeChange);
    els.model.addEventListener('change', () => refreshTireSizeSuggestions());
    els.width?.addEventListener('change', () => {
      if (els.profile) {
        els.profile.disabled = !els.width.value;
        if (!els.width.value) els.profile.value = '';
      }
      if (els.rim) {
        els.rim.disabled = !els.profile?.value;
        if (!els.profile?.value) els.rim.value = '';
      }
      syncTireSize();
    });
    els.profile?.addEventListener('change', () => {
      if (els.rim) {
        els.rim.disabled = !els.profile.value;
        if (!els.profile.value) els.rim.value = '';
      }
      syncTireSize();
    });
    els.rim?.addEventListener('change', syncTireSize);
    bindFancySelects();
    bindTireSizeSuggestions();
    loadMakes();
    [els.year, els.make, els.model, els.colour, els.width, els.profile, els.rim].forEach(syncFancySelect);
    refreshTireSizeSuggestions();
  }

  window.EastCordAppointmentVehicle = {
    init,
    setVehicle,
    setTireSize,
    hydrateFromForm,
  };
})();
