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
    makes: Object.keys(FALLBACK_MODELS),
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
    if (current && values.some((value) => String(value) === current)) select.value = current;
  }

  function ensureOption(select, value) {
    if (!select || !value) return;
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (!exists) select.insertAdjacentHTML('beforeend', optionHtml(value));
    select.value = value;
  }

  function parseTireSize(value) {
    const match = String(value || '').toUpperCase().replace(/\s+/g, '').match(/(\d{3})\/(\d{2})Z?R(\d{2})/);
    if (!match) return null;
    return { width: match[1], profile: match[2], rim: match[3] };
  }

  function syncTireSize() {
    if (!els.sizeValue) return;
    const width = els.width?.value || '';
    const profile = els.profile?.value || '';
    const rim = els.rim?.value || '';
    els.sizeValue.value = width && profile && rim ? `${width}/${profile}R${rim}` : '';
    els.sizeValue.dispatchEvent(new Event('input', { bubbles: true }));
    els.sizeValue.dispatchEvent(new Event('change', { bubbles: true }));
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

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Vehicle list request failed (${response.status})`);
    return response.json();
  }

  async function loadMakes() {
    fillSelect(els.make, cache.makes, 'Select make');
  }

  async function loadModels(year, make) {
    if (!year || !make) return [];
    const key = `${year}::${make}`.toLowerCase();
    if (cache.models.has(key)) return cache.models.get(key);

    const fallback = FALLBACK_MODELS[make] || [];
    let models = [...fallback];
    try {
      const payload = await fetchJson(
        `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${encodeURIComponent(year)}?format=json`,
      );
      const remote = (payload.Results || [])
        .map((row) => String(row.Model_Name || '').trim())
        .filter((name) => (
          name
          && name.length <= 40
          && !/\b(inc\.?|llc|ltd|corp|company|industries|trailers|manufacturing|steel)\b/i.test(name)
        ));
      models = remote.length
        ? [...new Set(remote)].sort((a, b) => a.localeCompare(b))
        : [...fallback].sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.warn('[EastCord appointment] Vehicle model list is using the offline catalog.', error);
      models = [...fallback].sort((a, b) => a.localeCompare(b));
    }
    cache.models.set(key, models);
    return models;
  }

  async function onYearChange() {
    const year = els.year?.value || '';
    if (els.make) {
      els.make.disabled = !year;
      if (!year) els.make.value = '';
    }
    if (year && els.make && cache.makes.length) fillSelect(els.make, cache.makes, 'Select make');
    if (year && els.make?.value) {
      await onMakeChange();
      return;
    }
    if (els.model) {
      els.model.disabled = true;
      fillSelect(els.model, [], 'Select model');
    }
  }

  async function onMakeChange() {
    const year = els.year?.value || '';
    const make = els.make?.value || '';
    if (!els.model) return;
    els.model.disabled = !year || !make;
    if (!year || !make) {
      fillSelect(els.model, [], 'Select model');
      return;
    }
    fillSelect(els.model, FALLBACK_MODELS[make] || [], 'Select model');
    els.model.disabled = false;
    const models = await loadModels(year, make);
    if (els.year?.value !== year || els.make?.value !== make) return;
    fillSelect(els.model, models, 'Select model');
    els.model.disabled = false;
  }

  async function setVehicle({ year, make, model, tireSize } = {}) {
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
    if (tireSize) setTireSize(tireSize);
  }

  function hydrateFromForm() {
    return setVehicle({
      year: els.year?.value,
      make: els.make?.value,
      model: els.model?.value,
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
  }

  function init() {
    cacheElements();
    if (!els.year || !els.make || !els.model) return;

    const years = [];
    for (let year = CURRENT_YEAR + 1; year >= YEAR_START; year -= 1) years.push(String(year));
    fillSelect(els.year, years, 'Select year');
    fillSelect(els.make, cache.makes, 'Select make');
    fillSelect(els.model, [], 'Select model');
    if (els.colour) fillSelect(els.colour, COLOURS, 'Select colour');
    if (els.width) fillSelect(els.width, WIDTHS.map(String), 'Select width');
    if (els.profile) fillSelect(els.profile, PROFILES.map(String), 'Select profile');
    if (els.rim) fillSelect(els.rim, RIMS.map(String), 'Select rim');

    els.make.disabled = !els.year.value;
    els.model.disabled = !els.year.value || !els.make.value;
    if (els.profile) els.profile.disabled = !els.width?.value;
    if (els.rim) els.rim.disabled = !els.profile?.value;

    els.year.addEventListener('change', onYearChange);
    els.make.addEventListener('change', onMakeChange);
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
  }

  window.EastCordAppointmentVehicle = {
    init,
    setVehicle,
    setTireSize,
    hydrateFromForm,
  };
})();
