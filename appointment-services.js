(function exposeAppointmentServices(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EastCordAppointmentServices = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TAX_RATE = 0.13;
  const DEPOSIT_RATE = 0.20;
  const SIZE_BANDS = {
    '14-16': { label: '14–16 inches', unitPrice: 16.25 },
    '17-19': { label: '17–19 inches', unitPrice: 18.75 },
    '20-22': { label: '20–22 inches', unitPrice: 21.25 },
    '23-24': { label: '23–24 inches', unitPrice: 25 },
  };
  const SERVICES = {
    'on-rim-swap': {
      name: 'On-rim tire swap',
      shortName: 'On-rim swap',
      unitPrice: 15,
      quantity: true,
      group: 'tire-swap',
    },
    'off-rim-swap': {
      name: 'Off-rim tire swap',
      shortName: 'Off-rim swap',
      sizePricing: true,
      quantity: true,
      group: 'tire-swap',
    },
    balancing: {
      name: 'Wheel balancing',
      shortName: 'Balancing',
      unitPrice: 15,
      quantity: true,
    },
    'flat-patch-plug': {
      name: 'Flat repair — patch and plug',
      shortName: 'Patch + plug',
      unitPrice: 50,
      quantity: true,
      group: 'flat-repair',
    },
    'flat-plug-only': {
      name: 'Flat repair — plug only',
      shortName: 'Plug only',
      unitPrice: 30,
      quantity: true,
      group: 'flat-repair',
    },
    'air-fill': {
      name: 'Air fill-up',
      shortName: 'Air fill-up',
      unitPrice: 20,
    },
    'tire-replacement': {
      name: 'Tire retorque',
      shortName: 'Tire retorque',
      unitPrice: 20,
    },
  };

  const LEGACY_SERVICES = {
    'seasonal-changeover-rims': { name: 'Seasonal Changeover - All 4 Tires Pre-Mounted on Rims', startingPrice: 40 },
    'seasonal-swap-not-mounted': { name: 'Seasonal Tire Swap - All 4 Tires Not Mounted on Rims', startingPrice: 80 },
    'mount-balance-1': { name: 'Mount & Balance - 1 Tire', startingPrice: 25 },
    'mount-balance-2': { name: 'Mount & Balance - 2 Tires', startingPrice: 50 },
    'mount-balance-3': { name: 'Mount & Balance - 3 Tires', startingPrice: 75 },
    'mount-balance-4': { name: 'Mount & Balance - 4 Tires', startingPrice: 100 },
  };

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function normalizeQuantity(value) {
    const quantity = Math.floor(Number(value));
    return Math.min(4, Math.max(1, Number.isFinite(quantity) ? quantity : 1));
  }

  function rimInchesFromTireSize(value) {
    const compact = String(value || '').toUpperCase().replace(/\s+/g, '');
    const fromR = Number(compact.match(/R(\d{2})/)?.[1]);
    if (Number.isFinite(fromR)) return fromR;
    const digits = compact.replace(/\D/g, '');
    return digits.length === 7 ? Number(digits.slice(-2)) : 0;
  }

  function sizeBandFromTireSize(value) {
    const diameter = rimInchesFromTireSize(value);
    if (diameter >= 14 && diameter <= 16) return '14-16';
    if (diameter >= 17 && diameter <= 19) return '17-19';
    if (diameter >= 20 && diameter <= 22) return '20-22';
    if (diameter >= 23 && diameter <= 24) return '23-24';
    return '';
  }

  function deriveOffRimSizeBandFromSizes(values) {
    const sizes = Array.isArray(values) ? values : [];
    if (!sizes.length) return '';
    const bands = sizes.map(sizeBandFromTireSize);
    if (bands.some((band) => !band)) return '';
    return new Set(bands).size === 1 ? bands[0] : '';
  }

  function normalizeSelections(selections) {
    const normalized = [];
    const selectedGroups = new Set();
    (Array.isArray(selections) ? selections : []).forEach((selection) => {
      const id = String(selection?.id || '').trim();
      const service = SERVICES[id];
      if (!service) return;
      if (service.group && selectedGroups.has(service.group)) return;
      if (service.group) selectedGroups.add(service.group);
      const quantity = service.quantity ? normalizeQuantity(selection.quantity) : 1;
      const sizeBand = service.sizePricing && SIZE_BANDS[selection.sizeBand] ? selection.sizeBand : '';
      normalized.push({ id, quantity, ...(sizeBand ? { sizeBand } : {}) });
    });
    return normalized;
  }

  function selectionPrice(selection) {
    const service = SERVICES[selection.id];
    if (!service || service.quoteRequired) return 0;
    const unitPrice = service.sizePricing
      ? SIZE_BANDS[selection.sizeBand]?.unitPrice
      : service.unitPrice;
    return roundMoney(Number(unitPrice || 0) * normalizeQuantity(selection.quantity));
  }

  function selectionLabel(selection) {
    const service = SERVICES[selection.id];
    if (!service) return '';
    if (service.quoteRequired) return `${service.shortName} (quote requested)`;
    const quantity = normalizeQuantity(selection.quantity);
    const size = selection.sizeBand ? `, ${SIZE_BANDS[selection.sizeBand]?.label || selection.sizeBand}` : '';
    return `${service.shortName} × ${quantity}${size}`;
  }

  function calculateSelections(selections) {
    const normalized = normalizeSelections(selections);
    const priced = normalized.filter((selection) => !SERVICES[selection.id].quoteRequired);
    const quoteRequests = normalized.filter((selection) => SERVICES[selection.id].quoteRequired);
    const serviceSubtotal = roundMoney(priced.reduce((sum, selection) => sum + selectionPrice(selection), 0));
    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const depositAmount = roundMoney(totalWithHst * DEPOSIT_RATE);
    const remainingBalance = roundMoney(totalWithHst - depositAmount);
    const labels = normalized.map(selectionLabel).filter(Boolean);
    return {
      id: 'multi-service-v1',
      name: labels.join(' + ') || 'Multiple tire services',
      selections: normalized,
      pricedSelections: priced,
      quoteRequests,
      serviceSubtotal,
      startingPrice: serviceSubtotal,
      hstAmount,
      totalWithHst,
      depositAmount,
      deposit: depositAmount,
      remainingBalance,
      remaining: remainingBalance,
      taxRate: TAX_RATE,
    };
  }

  function resolveService(item) {
    if (Array.isArray(item?.serviceSelections)) {
      if (!item.serviceSelections.length) return null;
      const selectedGroups = new Set();
      const valid = item.serviceSelections.every((selection) => {
        const service = SERVICES[String(selection?.id || '').trim()];
        if (!service) return false;
        if (service.group && selectedGroups.has(service.group)) return false;
        if (service.group) selectedGroups.add(service.group);
        if (service.quantity) {
          const quantity = Number(selection.quantity);
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) return false;
        }
        if (service.sizePricing && !SIZE_BANDS[selection.sizeBand]) return false;
        return true;
      });
      if (!valid) return null;
      const calculated = calculateSelections(item.serviceSelections);
      return calculated.selections.length ? calculated : null;
    }
    const legacy = LEGACY_SERVICES[item?.serviceId];
    if (!legacy) return null;
    const serviceSubtotal = roundMoney(legacy.startingPrice);
    const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const depositAmount = roundMoney(totalWithHst * DEPOSIT_RATE);
    return {
      id: item.serviceId,
      name: legacy.name,
      startingPrice: serviceSubtotal,
      serviceSubtotal,
      hstAmount,
      totalWithHst,
      depositAmount,
      remainingBalance: roundMoney(totalWithHst - depositAmount),
      taxRate: TAX_RATE,
      selections: [],
      quoteRequests: [],
    };
  }

  return {
    TAX_RATE,
    SIZE_BANDS,
    SERVICES,
    LEGACY_SERVICES,
    rimInchesFromTireSize,
    sizeBandFromTireSize,
    deriveOffRimSizeBandFromSizes,
    normalizeSelections,
    selectionPrice,
    selectionLabel,
    calculateSelections,
    resolveService,
  };
}));
