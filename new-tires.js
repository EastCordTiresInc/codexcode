(() => {
  const fallbackMessage = 'New tire shopping is temporarily unavailable. Please contact EastCord Tires for assistance.';
  const QUOTE_STORAGE_KEY = 'eastcord_new_tire_quote_v1';
  const INSTALL_SLOT_KEY = 'eastcord_new_tire_install_slot_v1';
  const NEW_TIRE_SHIPPING_DAYS = 4;
  const TIME_WINDOWS = [
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '12:00 PM - 1:00 PM',
    '1:00 PM - 2:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM',
    '5:00 PM - 6:00 PM',
    '6:00 PM - 7:00 PM',
    '7:00 PM - 8:00 PM',
  ];
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  let currentProfile = null;
  let selectedQuote = readStoredQuote();
  let didAutoScroll = false;
  let lastClickedCard = null;
  let highlightedCard = null;
  let lastHighlightRect = null;
  let highlightHoldUntil = 0;
  let highlightPulseTimer = 0;
  let widgetApi = null;
  let lastNotifiedOrderKey = '';
  let lastSavedOrder = readConfirmedOrder();
  let installSlot = null;
  let calendarMonth = new Date();
  const boundWidgets = new WeakSet();

  function showFallback(message = fallbackMessage) {
    const messageElement = document.querySelector('[data-tireconnect-message]');
    const widgetShell = document.querySelector('[data-tireconnect-shell]');
    if (messageElement) {
      messageElement.textContent = message;
      messageElement.hidden = false;
    }
    if (widgetShell) widgetShell.classList.add('is-unavailable');
  }

  function eventPayload(event) {
    if (!event || typeof event !== 'object') return {};
    if (Array.isArray(event.tires) || event.tire || event.brand_name) return event;
    if (event.data && typeof event.data === 'object') return event.data;
    if (event.detail && typeof event.detail === 'object') return event.detail;
    return event;
  }

  function resolveWidgetEvent(event) {
    if (event && typeof event.resolve === 'function') {
      logFlow('widget.resolve', eventPayload(event));
      event.resolve();
    }
  }

  function rejectWidgetEvent(event) {
    if (event && typeof event.reject === 'function') {
      logFlow('widget.reject', eventPayload(event));
      event.reject();
    }
  }

  function confirmedOrderStorageKey() {
    return 'eastcord_confirmed_new_tire_order_v1';
  }

  function readConfirmedOrder() {
    try {
      return JSON.parse(sessionStorage.getItem(confirmedOrderStorageKey()) || 'null');
    } catch (error) {
      return null;
    }
  }

  function rememberConfirmedOrder(orderId, fulfillment) {
    if (!orderId) return;
    lastSavedOrder = { id: String(orderId), fulfillment: fulfillment === 'Installation' ? 'Installation' : 'Pickup' };
    try {
      sessionStorage.setItem(confirmedOrderStorageKey(), JSON.stringify(lastSavedOrder));
    } catch (error) {
      /* keep memory copy */
    }
  }

  function installationBookingUrl(orderId) {
    const params = new URLSearchParams();
    params.set('source', 'new-tires');
    if (orderId) params.set('newTireOrder', orderId);
    return `/appointment.html?${params.toString()}#appointment-booking`;
  }

  function startOfLocalDay(value = new Date()) {
    const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function earliestInstallDate() {
    const date = startOfLocalDay();
    date.setDate(date.getDate() + NEW_TIRE_SHIPPING_DAYS + 1);
    return date;
  }

  function parseDateValue(value) {
    if (!value) return null;
    const date = startOfLocalDay(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function readInstallSlot() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(INSTALL_SLOT_KEY) || 'null');
      if (!saved?.date || !saved?.time) return null;
      if (startOfLocalDay(saved.date) < earliestInstallDate()) return null;
      if (!TIME_WINDOWS.includes(saved.time)) return null;
      return { date: saved.date, time: saved.time };
    } catch (error) {
      return null;
    }
  }

  function rememberInstallSlot(slot) {
    installSlot = slot;
    try {
      if (slot?.date && slot?.time) sessionStorage.setItem(INSTALL_SLOT_KEY, JSON.stringify(slot));
      else sessionStorage.removeItem(INSTALL_SLOT_KEY);
    } catch (error) {
      /* keep memory copy */
    }
  }

  function datetimeEls() {
    return {
      wrap: document.querySelector('[data-new-tire-datetime]'),
      popover: document.querySelector('[data-new-tire-datetime-popover]'),
      title: document.querySelector('[data-cal-title]'),
      body: document.querySelector('[data-cal-body]'),
      time: document.querySelector('[data-new-tire-time]'),
      dateField: document.querySelector('[data-new-tire-preferred-date]'),
      timeField: document.querySelector('[data-new-tire-preferred-time]'),
    };
  }

  function syncDatetimeFields() {
    const els = datetimeEls();
    if (els.dateField) els.dateField.value = installSlot?.date || '';
    if (els.timeField) els.timeField.value = installSlot?.time || '';
    if (els.time && installSlot?.time) els.time.value = installSlot.time;
  }

  function fillTimeOptions() {
    const select = datetimeEls().time;
    if (!select || select.dataset.filled === 'true') return;
    select.innerHTML = ['<option value="">Select a time</option>']
      .concat(TIME_WINDOWS.map((slot) => `<option value="${slot}">${slot}</option>`))
      .join('');
    select.dataset.filled = 'true';
  }

  function renderCalendar() {
    const els = datetimeEls();
    if (!els.body || !els.title) return;
    const view = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    els.title.textContent = `${MONTH_NAMES[view.getMonth()]} ${view.getFullYear()}`;
    const start = new Date(view);
    start.setDate(1 - start.getDay());
    const minDate = earliestInstallDate();
    const today = formatDateValue(startOfLocalDay());
    const selected = installSlot?.date || '';
    const rows = [];
    for (let week = 0; week < 6; week += 1) {
      const cells = [];
      for (let day = 0; day < 7; day += 1) {
        const cell = new Date(start);
        cell.setDate(start.getDate() + (week * 7) + day);
        const value = formatDateValue(cell);
        const outside = cell.getMonth() !== view.getMonth();
        const unavailable = startOfLocalDay(cell) < minDate;
        const classes = [
          value === today ? 'is-today' : '',
          value === selected ? 'is-selected' : '',
          outside || unavailable ? 'is-outside' : '',
        ].filter(Boolean).join(' ');
        cells.push(
          `<td><button type="button" data-cal-day="${value}" class="${classes}" ${unavailable ? 'disabled' : ''}>${cell.getDate()}</button></td>`,
        );
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    els.body.innerHTML = rows.join('');
  }

  function openDatetimePopover() {
    const els = datetimeEls();
    if (!els.popover || !els.wrap || els.wrap.hidden) return;
    fillTimeOptions();
    if (!installSlot?.date) calendarMonth = earliestInstallDate();
    renderCalendar();
    syncDatetimeFields();
    els.popover.hidden = false;
    els.wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function showInstallDatetime() {
    const els = datetimeEls();
    if (!els.wrap) return;
    const wantsInstall = selectedFulfillment() === 'Installation';
    els.wrap.hidden = !wantsInstall;
    if (!wantsInstall) return;
    if (els.popover) els.popover.hidden = false;
    fillTimeOptions();
    renderCalendar();
    syncDatetimeFields();
  }

  function confirmDatetimeSelection() {
    const els = datetimeEls();
    const date = installSlot?.date || '';
    const time = els.time?.value || installSlot?.time || '';
    if (!date || !time) {
      openDatetimePopover();
      return false;
    }
    rememberInstallSlot({ date, time });
    syncDatetimeFields();
    renderCalendar();
    logFlow('panel.installSlot', installSlot);
    return true;
  }

  function bindInstallDatetime() {
    const els = datetimeEls();
    if (!els.wrap || els.wrap.dataset.bound === 'true') return;
    els.wrap.dataset.bound = 'true';
    installSlot = readInstallSlot();
    calendarMonth = parseDateValue(installSlot?.date) || earliestInstallDate();
    fillTimeOptions();
    syncDatetimeFields();
    els.wrap.querySelector('[data-cal-prev]')?.addEventListener('click', () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    els.wrap.querySelector('[data-cal-next]')?.addEventListener('click', () => {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    els.body?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cal-day]');
      if (!button || button.disabled) return;
      installSlot = { date: button.getAttribute('data-cal-day'), time: els.time?.value || installSlot?.time || '' };
      renderCalendar();
      syncDatetimeFields();
    });
    els.time?.addEventListener('change', () => {
      if (!installSlot?.date) return;
      installSlot = { date: installSlot.date, time: els.time.value };
      syncDatetimeFields();
    });
    els.wrap.querySelector('[data-new-tire-datetime-done]')?.addEventListener('click', confirmDatetimeSelection);
  }

  function bindChoiceInfo() {
    const fieldset = document.querySelector('[data-new-tire-fulfillment-form] .new-tire-choice');
    if (!fieldset || fieldset.dataset.infoBound === 'true') return;
    fieldset.dataset.infoBound = 'true';
    fieldset.querySelectorAll('[data-choice-info]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const tip = document.getElementById(button.getAttribute('aria-controls') || '');
        const open = tip && tip.hidden;
        fieldset.querySelectorAll('[data-choice-info]').forEach((other) => {
          const otherTip = document.getElementById(other.getAttribute('aria-controls') || '');
          if (otherTip) otherTip.hidden = true;
          other.setAttribute('aria-expanded', 'false');
        });
        if (open && tip) {
          tip.hidden = false;
          button.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  function logFlow(step, detail) {
    if (detail === undefined) console.log(`[EastCord new tires] ${step}`);
    else console.log(`[EastCord new tires] ${step}`, detail);
  }

  function isLocalHost() {
    return /localhost|127\.0\.0\.1/i.test(window.location.hostname);
  }

  function readStoredQuote() {
    try {
      const quote = JSON.parse(sessionStorage.getItem(QUOTE_STORAGE_KEY) || 'null');
      if (!isUsableTire(quote?.tires?.[0])) return null;
      const tire = quote.tires[0];
      quote.tires[0] = {
        ...tire,
        brand: cleanTireField(tire.brand),
        model: cleanTireField(tire.model),
        size: tireSizeValue(tire.size),
      };
      if (!isUsableTire(quote.tires[0])) return null;
      return quote;
    } catch (error) {
      return null;
    }
  }

  const TIRE_BRANDS = [
    'BFGoodrich', 'BF Goodrich', 'Firestone', 'Bridgestone', 'Michelin', 'Goodyear',
    'Continental', 'Pirelli', 'Toyo', 'Hankook', 'Kumho', 'Nexen', 'Falken',
    'Yokohama', 'Cooper', 'General', 'Dunlop', 'Nitto', 'Ironman', 'GT Radial',
    'Uniroyal', 'Kelly', 'Mastercraft', 'Nokian', 'Sailun', 'Maxxis', 'Kenda',
    'Starfire', 'Achilles', 'Atturo', 'Vercelli', 'Thunderer', 'Primewell',
  ];

  function isWidgetChrome(value) {
    const text = String(value || '')
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return true;
    if (/^(summary|price summary|quote|order|cart|your cart|details?|done|pickup|installation|tires for)$/i.test(text)) return true;
    return /^(revise search|change (tire|search|vehicle)|search by|search tires|price summary|see out|add to cart|place order|place your order|add to compare|powered by|tireconnect|qty|quantity|warranty|category|recommended|specs|features|reviews|sub-total|taxes|total price|per tire|touring|performance|winter|summer|all season|all weather|in stock|load more|show more|next|previous|filters?|sort by|best match|preferred date|how do you want)$/i.test(text);
  }

  function cleanTireField(value) {
    if (value && typeof value === 'object') {
      return cleanTireField(value.name || value.title || value.label || value.brand_name || '');
    }
    const text = String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/found\s+\d+\s+tires(?:\s+for:?\s*)?/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[:\-–]+\s*/, '')
      .trim();
    if (!text) return '';
    return isWidgetChrome(text) ? '' : text;
  }

  function tireSizeValue(value) {
    const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
    const metric = compact.match(/(\d{3}\/\d{2}Z?R\d{2})/);
    if (metric) return metric[1];
    const flotation = compact.match(/(\d{2}X\d{2}(?:\.\d{1,2})?R\d{2})/);
    return flotation ? flotation[1] : '';
  }

  function isUsableTire(tire) {
    if (!tire) return false;
    return Boolean(tireSizeValue(tire.size) || cleanTireField(tire.brand));
  }

  function mergeTire(current = {}, incoming = {}) {
    return {
      brand: cleanTireField(incoming.brand) || cleanTireField(current.brand) || '',
      model: cleanTireField(incoming.model) || cleanTireField(current.model) || '',
      size: tireSizeValue(incoming.size) || tireSizeValue(current.size) || '',
      qty: incoming.qty || current.qty || 1,
      price: Number(incoming.price) > 0 ? Number(incoming.price) : (Number(current.price) || 0),
      partNumber: cleanTireField(incoming.partNumber) || cleanTireField(current.partNumber) || '',
    };
  }

  function storeQuote(quote, { replace = false } = {}) {
    if (!quote?.tires?.length) return;
    const mergedTires = replace
      ? quote.tires.map((tire) => mergeTire({}, tire))
      : quote.tires.map((tire, index) => (
        mergeTire(selectedQuote?.tires?.[index] || selectedQuote?.tires?.[0] || {}, tire)
      ));
    if (!mergedTires.some(isUsableTire)) return;
    selectedQuote = {
      ...(replace ? {} : (selectedQuote || {})),
      ...quote,
      tires: mergedTires,
      vehicle: replace ? (quote.vehicle || {}) : { ...(selectedQuote?.vehicle || {}), ...(quote.vehicle || {}) },
    };
    try {
      sessionStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(selectedQuote));
    } catch (error) {
      /* keep memory copy */
    }
  }

  function clearQuote() {
    selectedQuote = null;
    didAutoScroll = false;
    try {
      sessionStorage.removeItem(QUOTE_STORAGE_KEY);
    } catch (error) {
      selectedQuote = null;
    }
    const input = detailsInput();
    if (input) input.value = '';
    lastClickedCard = null;
    hideHighlightOverlay();
    syncFulfillmentUi();
  }

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    return `$${amount.toFixed(2)}`;
  }

  function detailsInput() {
    return document.querySelector('[data-new-tire-details]');
  }

  function extractTires(payload) {
    if (Array.isArray(payload.tires) && payload.tires.length) return payload.tires;
    if (Array.isArray(payload.items) && payload.items.length) return payload.items;
    if (payload.tire && typeof payload.tire === 'object') return [payload.tire];
    if (Array.isArray(payload.quote?.tires) && payload.quote.tires.length) return payload.quote.tires;
    if (payload.brand_name || payload.brand || payload.model_name || payload.model || payload.size) return [payload];
    return [];
  }

  function quoteFromSelectEvent(payload) {
    const tires = extractTires(payload);
    const vehicle = payload.vehicle || {};
    if (!tires.length) return null;
    return {
      tires: tires.map((tire) => ({
        brand: cleanTireField(
          tire.brand_name
          || tire.brand
          || tire.manufacturer
          || tire.manufacturer_name
          || tire.tire_brand
          || tire.vendor
          || tire.make,
        ),
        model: cleanTireField(tire.model_name || tire.model || tire.product_name || tire.tire_model),
        size: tireSizeValue(tire.size || tire.sizeShort || tire.size_short || tire.tire_size || tire.size_display),
        qty: Math.max(1, Math.min(8, Number(tire.selectedQuantity ?? tire.selected_quantity ?? tire.quantity ?? tire.qty) || 4)),
        price: Math.max(0, Number(tire.price || tire.unit_price || tire.unitPrice || tire.display_price || tire.price_per_tire || tire.retail_price) || 0),
        partNumber: String(tire.part_number || tire.partNumber || '').trim(),
      })),
      vehicle: {
        year: String(vehicle.year || '').trim(),
        make: String(vehicle.make || '').trim(),
        model: String(vehicle.model || '').trim(),
        submodel: String(vehicle.submodel || vehicle.trim || '').trim(),
      },
      hash: window.location.hash || '',
    };
  }

  function decodeTireId(value) {
    try {
      const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(padded);
      const parts = decoded.split(/\|\|?/).map((part) => part.trim()).filter(Boolean);
      if (!parts.length) return {};
      return {
        brand: /^[A-Za-z][A-Za-z0-9 .+-]*$/.test(parts[0] || '') ? parts[0] : '',
        partNumber: parts[1] || '',
        model: parts.find((part, index) => index > 1 && /[A-Za-z]/.test(part) && part.length > 2 && part.length < 48) || '',
      };
    } catch (error) {
      return {};
    }
  }

  function widgetPlainText() {
    const root = document.getElementById('tireconnect');
    if (!root) return '';
    let text = String(root.innerText || '');
    const iframe = root.querySelector('iframe');
    if (iframe) {
      try {
        text += `\n${iframe.contentDocument?.body?.innerText || ''}`;
      } catch (error) {
        /* cross-origin */
      }
    }
    const alts = [...root.querySelectorAll('img')].map((img) => img.getAttribute('alt') || '').join('\n');
    return `${text}\n${alts}`;
  }

  const ADD_TO_CART_LABEL = 'Add to cart';
  const OUT_THE_DOOR_LABEL = /see\s+out[-\s]?the[-\s]?door[-\s]?price/i;

  function isOutTheDoorLabel(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return Boolean(text) && text.length <= 80 && OUT_THE_DOOR_LABEL.test(text);
  }

  function setWidgetButtonLabel(el, label) {
    if (!el || el.nodeType !== 1) return;
    if ('value' in el && isOutTheDoorLabel(el.value)) el.value = label;
    if (el.getAttribute?.('aria-label') && isOutTheDoorLabel(el.getAttribute('aria-label'))) {
      el.setAttribute('aria-label', label);
    }
    if (el.getAttribute?.('title') && isOutTheDoorLabel(el.getAttribute('title'))) {
      el.setAttribute('title', label);
    }
    const texts = [];
    const walker = (el.ownerDocument || document).createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (String(walker.currentNode.nodeValue || '').replace(/\s+/g, ' ').trim()) {
        texts.push(walker.currentNode);
      }
    }
    if (!texts.length) {
      if (isOutTheDoorLabel(el.textContent)) el.textContent = label;
      return;
    }
    texts[0].nodeValue = label;
    texts.slice(1).forEach((node) => {
      node.nodeValue = '';
    });
  }

  function relabelWidgetButtons() {
    collectWidgetElements(document.getElementById('tireconnect')).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (!/^(BUTTON|A|INPUT)$/i.test(el.tagName) && el.getAttribute('role') !== 'button') return;
      if (!isOutTheDoorLabel(widgetButtonLabel(el))) return;
      if ([...el.children].some((child) => isOutTheDoorLabel(widgetButtonLabel(child)))) return;
      setWidgetButtonLabel(el, ADD_TO_CART_LABEL);
    });
  }

  function isWidgetSummaryPage() {
    const hash = window.location.hash || '';
    if (/(summary|quote)/i.test(hash) && !/results/i.test(hash)) return true;
    const text = widgetPlainText();
    if (/BACK TO SUMMARY|CREDIT CARD NUMBER|PAY WITH CREDIT CARD/i.test(text)) return false;
    return /CHANGE\s*TIRE/i.test(text) && /warranty|category|size:|price summary|sub-total|summary/i.test(text);
  }

  function isWidgetCheckoutPage() {
    const text = widgetPlainText();
    return /PLACE YOUR ORDER|BACK TO SUMMARY|PAY WITH CREDIT CARD|CREDIT CARD NUMBER/i.test(text);
  }

  function syncSummaryLayout() {
    document.querySelector('.new-tires-workspace')?.classList.remove('is-widget-summary');
  }

  function onWidgetDomChanged() {
    syncSummaryLayout();
    relabelWidgetButtons();
    revealNativeOrderButton();
    ensureSummaryOrderButton();
    bindNativeOrderFallback();
    highlightSelectedWidgetTires();
    syncDemoOrderButton();
    refreshScrapedBrand();
  }

  function isLocalCheckoutOpen() {
    const overlay = document.getElementById('eastcord-widget-checkout');
    return Boolean(overlay && !overlay.hidden);
  }

  function isNativeOrderAction(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'eastcord-widget-order' || el.id === 'eastcord-native-order' || el.hasAttribute?.('data-new-tire-demo-order')) return false;
    const text = widgetButtonLabel(el);
    if (!/^(order|order now|continue)$/i.test(text)) return false;
    return ![...el.children].some((child) => /^(order|order now|continue)$/i.test(widgetButtonLabel(child)));
  }

  function unhideWidgetNode(node) {
    if (!node || node.id === 'tireconnect') return;
    node.removeAttribute?.('data-eastcord-hide-field');
    node.removeAttribute?.('hidden');
    if (node.hidden) node.hidden = false;
    if (node.style) {
      node.style.removeProperty('display');
      node.style.removeProperty('visibility');
      node.style.removeProperty('opacity');
    }
    if (node.classList) {
      [...node.classList].forEach((name) => {
        if (/^(ignore|hidden|hide|invisible|is-hidden|d-none)$/i.test(name)) {
          node.classList.remove(name);
        }
      });
    }
  }

  function ensureWidgetOrderCss(root = document.getElementById('tireconnect')) {
    const docs = new Set([document]);
    collectWidgetElements(root).forEach((el) => {
      if (el.tagName !== 'IFRAME') return;
      try {
        if (el.contentDocument) docs.add(el.contentDocument);
      } catch (error) {
        /* cross-origin */
      }
    });
    docs.forEach((doc) => {
      if (!doc?.head || doc.getElementById('eastcord-show-native-order')) return;
      const style = doc.createElement('style');
      style.id = 'eastcord-show-native-order';
      style.textContent = [
        '[data-eastcord-hide-field="true"]{display:revert!important;visibility:visible!important;opacity:1!important}',
      ].join('');
      doc.head.appendChild(style);
    });
  }

  function revealNativeOrderButton() {
    ensureWidgetOrderCss();
    if (isWidgetCheckoutPage()) return;
    const nodes = collectWidgetElements(document.getElementById('tireconnect')).filter(isNativeOrderAction);
    logFlow('widget.revealOrder', { summary: isWidgetSummaryPage(), count: nodes.length });
    nodes.forEach((el) => {
      let node = el;
      for (let i = 0; i < 6 && node && node.id !== 'tireconnect'; i += 1) {
        unhideWidgetNode(node);
        node = node.parentElement;
      }
    });
  }

  function summaryActionButton(label) {
    return collectWidgetElements(document.getElementById('tireconnect')).find((el) => (
      el.nodeType === 1 && label.test(widgetButtonLabel(el))
    ));
  }

  function visibleNativeOrderButtons() {
    return collectWidgetElements(document.getElementById('tireconnect')).filter((el) => (
      isNativeOrderAction(el) && isElementVisible(el)
    ));
  }

  function startWidgetCheckout() {
    const api = widgetApi || window.TCWidget;
    const names = ['startEcommerceOrder', 'startOrder', 'placeOrder', 'openCheckout', 'goToCheckout'];
    for (const name of names) {
      if (typeof api?.[name] !== 'function') continue;
      logFlow('widget.checkoutMethod', name);
      api[name]();
      return true;
    }
    return clickWidgetCheckoutCta();
  }

  function handleSummaryOrderClick(event) {
    event?.preventDefault?.();
    logFlow('checkout.summaryOrderClick');
    const gate = memberGate();
    if (!gate.ok) {
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      scrollToFulfillment();
      return;
    }
    pushCustomerIntoWidget();
    const native = visibleNativeOrderButtons()[0];
    if (native) clickClickable(native);
    else startWidgetCheckout();
    window.setTimeout(() => {
      if (isWidgetCheckoutPage()) {
        logFlow('checkout.nativeOpened');
        closeLocalWidgetCheckout();
        return;
      }
      if (isDemoOrderEnabled()) {
        openLocalWidgetCheckout();
        return;
      }
      setFulfillmentMessage('Continue checkout in the tire search to place the order. After payment, we save the tires to your account.');
    }, 700);
  }

  function bindNativeOrderFallback() {
    collectWidgetElements(document.getElementById('tireconnect')).filter(isNativeOrderAction).forEach((el) => {
      if (el.dataset.eastcordOrderBound === 'true') return;
      el.dataset.eastcordOrderBound = 'true';
      el.addEventListener('click', () => {
        logFlow('checkout.nativeOrderClick');
        window.setTimeout(() => {
          if (isWidgetCheckoutPage()) {
            closeLocalWidgetCheckout();
            return;
          }
          if (isDemoOrderEnabled()) openLocalWidgetCheckout();
        }, 700);
      });
    });
  }

  function checkoutOverlay() {
    return document.getElementById('eastcord-widget-checkout');
  }

  function fillCheckoutSummary() {
    const box = document.querySelector('[data-eastcord-checkout-summary]');
    if (!box) return;
    const tire = selectedQuote?.tires?.[0] || {};
    const qty = Math.max(1, Number(tire.qty) || 1);
    const unit = Number(tire.price) || 0;
    const totals = totalsFromWidget();
    const subtotal = totals.subtotal || unit * qty;
    const tax = totals.tax || Math.round(subtotal * 0.13 * 100) / 100;
    const total = totals.total || Math.round((subtotal + tax) * 100) / 100;
    box.innerHTML = [
      ['Tire', [tire.brand, tire.model, tire.size].filter(Boolean).join(' ') || 'Selected tire'],
      ['Quantity', String(qty)],
      ['Sub-total', money(subtotal) || '—'],
      ['Taxes', money(tax) || '—'],
      ['Total', money(total) || '—'],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
  }

  function openLocalWidgetCheckout() {
    if (!isDemoOrderEnabled()) return;
    const overlay = checkoutOverlay();
    if (!overlay) return;
    logFlow('checkout.localOverlay.open');
    highlightHoldUntil = 0;
    hideHighlightOverlay();
    fillCheckoutSummary();
    overlay.hidden = false;
    overlay.scrollTop = 0;
    overlay.querySelector('[name="card"]')?.focus();
  }

  function closeLocalWidgetCheckout() {
    const overlay = checkoutOverlay();
    if (overlay) overlay.hidden = true;
  }

  function bindLocalWidgetCheckout() {
    const overlay = checkoutOverlay();
    if (!overlay || overlay.dataset.bound === 'true') return;
    overlay.dataset.bound = 'true';
    overlay.querySelector('[data-eastcord-checkout-back]')?.addEventListener('click', closeLocalWidgetCheckout);
    overlay.querySelector('[data-eastcord-checkout-gpay]')?.addEventListener('click', () => {
      payLocalWidgetCheckout('gpay');
    });
    overlay.querySelector('[data-eastcord-checkout-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      payLocalWidgetCheckout('card');
    });
    overlay.querySelector('[name="card"]')?.addEventListener('input', (event) => {
      const digits = String(event.target.value || '').replace(/\D/g, '').slice(0, 16);
      event.target.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
    });
    overlay.querySelector('[name="expiry"]')?.addEventListener('input', (event) => {
      const digits = String(event.target.value || '').replace(/\D/g, '').slice(0, 4);
      event.target.value = digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
    });
  }

  async function payLocalWidgetCheckout(method) {
    logFlow('checkout.localPay', method);
    if (!isDemoOrderEnabled()) return;
    const gate = memberGate();
    if (!gate.ok) {
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      scrollToFulfillment();
      return;
    }
    if (!hasCapturedTire()) {
      setFulfillmentMessage('Select a tire in the search first, then place the order.', true);
      return;
    }
    const form = document.querySelector('[data-eastcord-checkout-form]');
    const card = String(form?.elements?.namedItem('card')?.value || '').replace(/\s+/g, '');
    if (method === 'card' && !/^\d{13,19}$/.test(card)) {
      setFulfillmentMessage('Enter a test card number, such as 4242 4242 4242 4242.', true);
      return;
    }
    const totals = totalsFromWidget();
    const tire = selectedQuote?.tires?.[0] || {};
    const qty = Math.max(1, Number(tire.qty) || 1);
    const unit = Number(tire.price) || 0;
    const subtotal = totals.subtotal || Math.round(unit * qty * 100) / 100;
    const tax = totals.tax || Math.round(subtotal * 0.13 * 100) / 100;
    const total = totals.total || Math.round((subtotal + tax) * 100) / 100;
    const payload = mockSubmittedOrderPayload({
      order_number: `widget-test-${Date.now()}`,
      subtotal,
      total_tax: tax,
      total_price: total,
      notes_extra: method === 'gpay' ? 'Local widget test: G Pay' : `Local widget test card ending ${card.slice(-4)}`,
    });
    const payBtn = form?.querySelector('[type="submit"]');
    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = 'PLACING ORDER...';
    }
    try {
      const result = await handleWidgetOrderComplete({
        ...payload,
        status: 'submitted',
      }, 'widget-checkout');
      logFlow('checkout.localPay.done', result);
      if (result?.saved) closeLocalWidgetCheckout();
    } finally {
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.textContent = 'PLACE YOUR ORDER';
      }
    }
  }

  function ensureSummaryOrderButton() {
    const clone = document.getElementById('eastcord-native-order');
    const onSummary = isWidgetSummaryPage()
      || Boolean(summaryActionButton(/^save your quote$/i) && summaryActionButton(/^request an appointment$/i));
    if (!onSummary || isWidgetCheckoutPage() || isLocalCheckoutOpen() || visibleNativeOrderButtons().length) {
      clone?.remove();
      return;
    }
    const quote = summaryActionButton(/^save your quote$/i);
    const appt = summaryActionButton(/^request an appointment$/i);
    const slot = (appt || quote)?.closest?.('button, a, [role="button"]') || appt || quote;
    if (!slot?.parentElement) {
      clone?.remove();
      return;
    }
    if (clone) return;
    logFlow('widget.injectSummaryOrder');
    const button = document.createElement('button');
    button.id = 'eastcord-native-order';
    button.type = 'button';
    button.textContent = 'ORDER';
    button.addEventListener('click', handleSummaryOrderClick);
    slot.parentElement.classList.add('eastcord-summary-actions');
    slot.parentElement.appendChild(button);
  }

  function isSelectCtaText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return isOutTheDoorLabel(text) || /add to cart|place order/i.test(text);
  }

  function collectWidgetElements(root, list = []) {
    if (!root) return list;
    if (root.nodeType === 1) list.push(root);
    if (root.shadowRoot) collectWidgetElements(root.shadowRoot, list);
    if (root.tagName === 'IFRAME') {
      try {
        if (root.contentDocument?.body) collectWidgetElements(root.contentDocument.body, list);
      } catch (error) {
        /* cross-origin */
      }
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach((el) => {
        list.push(el);
        if (el.shadowRoot) collectWidgetElements(el.shadowRoot, list);
        if (el.tagName === 'IFRAME') {
          try {
            if (el.contentDocument?.body) collectWidgetElements(el.contentDocument.body, list);
          } catch (error) {
            /* cross-origin */
          }
        }
      });
    }
    return list;
  }

  function findSelectButtons(root) {
    return collectWidgetElements(root).filter((el) => {
      if (el.nodeType !== 1) return false;
      if (!isSelectCtaText(el.textContent) && !isSelectCtaText(el.value)) return false;
      return ![...el.children].some((child) => isSelectCtaText(child.textContent) || isSelectCtaText(child.value));
    });
  }

  function cardMatchesTire(card, tire) {
    const text = String(card.innerText || '');
    const hay = `${text}\n${collectBrandHaystack(card)}`;
    const compact = `${text}${hay}`.replace(/\s+/g, '').toLowerCase();
    const sizeKey = String(tire.size || '').match(/(\d{3}\s*\/\s*\d{2}\s*R\s*\d{2})/i)?.[1]?.replace(/\s+/g, '').toLowerCase();
    const brand = String(tire.brand || '').replace(/tires?$/i, '').replace(/\s+/g, ' ').trim();
    if (!sizeKey || !compact.includes(sizeKey)) return false;
    if (!brand || brand.length < 3) return true;
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^A-Za-z])${escaped}(?:$|[^A-Za-z])`, 'i').test(hay);
  }

  function isFullTireCard(el) {
    if (!el || el.nodeType !== 1) return false;
    const text = String(el.innerText || '').replace(/\s+/g, ' ').toLowerCase();
    const ctaCount = (text.match(/add to cart|place order|see out/g) || []).length;
    if (ctaCount < 1 || ctaCount > 3) return false;
    if (!/per tire/.test(text)) return false;
    return /\d{3}\s*\/\s*\d{2}\s*r\s*\d{2}/.test(text);
  }

  function knownBrandIn(text) {
    const haystack = String(text || '');
    if (!haystack.trim()) return '';
    return TIRE_BRANDS.find((name) => (
      new RegExp(`(?:^|[^A-Za-z])${name.replace(/\s+/g, '[\\s_-]*')}(?:$|[^A-Za-z])`, 'i').test(haystack)
    )) || '';
  }

  function brandFromElement(node) {
    if (!node) return '';
    const chunks = [String(node.innerText || ''), String(node.getAttribute?.('data-brand') || '')];
    const collect = node.querySelectorAll ? node.querySelectorAll('img, [alt], [title], [data-brand], source') : [];
    collect.forEach((el) => {
      ['alt', 'title', 'aria-label', 'src', 'srcset', 'href', 'data-src', 'data-brand'].forEach((attr) => {
        const value = el.getAttribute?.(attr);
        if (value) chunks.push(value);
      });
      if (el.src) chunks.push(el.src);
      if (el.currentSrc) chunks.push(el.currentSrc);
    });
    return knownBrandIn(chunks.join('\n'));
  }

  function quoteFromCard(card) {
    if (!card) return null;
    const text = String(card.innerText || '');
    const size = tireSizeValue(text);
    const skip = /add to compare|size:|warranty|qty|per tire|add to cart|place order|specs|features|performance|all season|all weather|summer|winter|n\/a|km|see out/i;
    const brand = brandFromElement(card)
      || knownBrandIn(text)
      || String(text).split(/\n/).map((line) => cleanTireField(line)).find((line) => (
        line
        && !skip.test(line)
        && !tireSizeValue(line)
        && !/\$/.test(line)
        && line.length >= 2
        && line.length <= 32
        && /[A-Za-z]/.test(line)
      )) || '';
    const qty = Math.max(1, Number(card.querySelector?.('select')?.value) || 4);
    const price = Number(String(text.match(/\$([\d,.]+)/)?.[1] || '').replace(/,/g, '')) || 0;
    if (!brand && !size) return null;
    return {
      tires: [{ brand: cleanTireField(brand), model: '', size, qty, price, partNumber: '' }],
      vehicle: {},
      hash: window.location.hash || '',
    };
  }

  function visualCardFrom(node) {
    const root = document.getElementById('tireconnect');
    let el = node && node.nodeType === 1 ? node : node?.parentElement;
    while (el && el !== document.body) {
      if (isFullTireCard(el)) return el;
      if (el === root) break;
      el = el.parentElement || el.getRootNode?.()?.host;
    }
    el = node && node.nodeType === 1 ? node : node?.parentElement;
    let fallback = node;
    while (el && el !== document.body) {
      if (el.getBoundingClientRect) {
        const rect = el.getBoundingClientRect();
        if (rect.width >= 200 && rect.height >= 280 && rect.height <= 1800 && rect.width <= 1200) {
          fallback = el;
        }
      }
      if (el === root) break;
      el = el.parentElement || el.getRootNode?.()?.host;
    }
    return fallback;
  }

  function applyCardHighlightStyles(card) {
    if (!card || card.id === 'tireconnect') return;
    card.setAttribute('data-eastcord-tire-card', 'true');
  }

  function clearCardHighlightStyles(card) {
    if (!card) return;
    card.removeAttribute('data-eastcord-tire-card');
    card.classList?.remove('eastcord-tire-card-selected');
    ['border', 'box-shadow', 'background-color', 'outline', 'outline-offset', 'border-radius'].forEach((prop) => {
      card.style.removeProperty(prop);
    });
  }

  function isHighlightableCard(card) {
    if (!card?.isConnected || card.id === 'tireconnect') return false;
    const rect = card.getBoundingClientRect();
    const root = document.getElementById('tireconnect');
    const rootRect = root?.getBoundingClientRect?.();
    if (rect.width < 140 || rect.height < 140) return false;
    if (rect.width > 520 || rect.height > 760) return false;
    if (rootRect && (rect.width > rootRect.width * 0.7 || rect.height > rootRect.height * 0.82)) return false;
    return true;
  }

  function ensureHighlightOverlay() {
    let overlay = document.getElementById('eastcord-tire-highlight');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'eastcord-tire-highlight';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
    return overlay;
  }

  function hideHighlightOverlay() {
    window.clearInterval(highlightPulseTimer);
    highlightHoldUntil = 0;
    const overlay = document.getElementById('eastcord-tire-highlight');
    if (overlay) overlay.hidden = true;
    highlightedCard = null;
    lastHighlightRect = null;
    const root = document.getElementById('tireconnect');
    collectWidgetElements(root).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (el.getAttribute?.('data-eastcord-tire-card') === 'true' || el.classList?.contains('eastcord-tire-card-selected')) {
        clearCardHighlightStyles(el);
      }
    });
  }

  function placeHighlightOverlay(card) {
    const overlay = ensureHighlightOverlay();
    if (!isHighlightableCard(card)) {
      overlay.hidden = true;
      return;
    }
    const rect = card.getBoundingClientRect();
    highlightedCard = card;
    lastClickedCard = card;
    lastHighlightRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    overlay.hidden = false;
    overlay.style.left = `${Math.round(rect.left - 4)}px`;
    overlay.style.top = `${Math.round(rect.top - 4)}px`;
    overlay.style.width = `${Math.round(rect.width + 8)}px`;
    overlay.style.height = `${Math.round(rect.height + 8)}px`;
  }

  function findMatchingCards() {
    const root = document.getElementById('tireconnect');
    if (!root || !hasCapturedTire()) return [];
    const seen = new Set();
    const matches = [];
    const remember = (card) => {
      if (!card || seen.has(card)) return;
      if (!selectedQuote.tires.some((tire) => cardMatchesTire(card, tire))) return;
      seen.add(card);
      matches.push(card);
    };
    findSelectButtons(root).forEach((button) => remember(visualCardFrom(button)));
    collectWidgetElements(root).forEach((el) => {
      if (isFullTireCard(el)) remember(el);
    });
    const clicked = lastClickedCard?.isConnected ? visualCardFrom(lastClickedCard) : null;
    if (clicked && (matches.includes(clicked) || selectedQuote.tires.some((tire) => cardMatchesTire(clicked, tire)))) {
      return [clicked];
    }
    if (!matches.length) return [];
    const smallest = matches.slice().sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (ar.width * ar.height) - (br.width * br.height);
    })[0];
    return smallest ? [smallest] : [];
  }

  function holdTireHighlight() {
    highlightHoldUntil = Date.now() + 12000;
    window.clearInterval(highlightPulseTimer);
    let ticks = 0;
    highlightPulseTimer = window.setInterval(() => {
      highlightSelectedWidgetTires();
      ticks += 1;
      if (ticks >= 24) window.clearInterval(highlightPulseTimer);
    }, 400);
  }

  function isWidgetResultsPage() {
    const root = document.getElementById('tireconnect');
    return collectWidgetElements(root).some((el) => isFullTireCard(el));
  }

  function highlightSelectedWidgetTires() {
    syncSummaryLayout();
    if (isLocalCheckoutOpen() || isWidgetCheckoutPage() || isWidgetSummaryPage() || !isWidgetResultsPage()) {
      hideHighlightOverlay();
      return;
    }
    let matches = findMatchingCards().filter(isHighlightableCard);
    if (!matches.length && isHighlightableCard(lastClickedCard)) {
      matches = [visualCardFrom(lastClickedCard) || lastClickedCard].filter(isHighlightableCard);
    }
    const root = document.getElementById('tireconnect');
    collectWidgetElements(root).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (el.getAttribute?.('data-eastcord-tire-card') === 'true' && !matches.includes(el)) {
        clearCardHighlightStyles(el);
      }
    });
    if (!matches.length) {
      hideHighlightOverlay();
      return;
    }
    const visible = matches.find((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > 90 && rect.top < window.innerHeight - 20;
    }) || matches[0];
    lastClickedCard = visible;
    placeHighlightOverlay(visible);
  }

  function bindWidgetHighlightClicks() {
    if (document.body.dataset.eastcordHighlightBound === 'true') return;
    document.body.dataset.eastcordHighlightBound = 'true';
    document.addEventListener('click', (event) => {
      const root = document.getElementById('tireconnect');
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (root && !path.includes(root) && !root.contains(event.target)) return;
      if (path.some((node) => node && node.nodeType === 1 && (isNativeOrderAction(node) || node.id === 'eastcord-native-order'))) return;
      const cta = path.find((node) => node && node.nodeType === 1 && isSelectCtaText(node.textContent || node.value));
      if (!cta) return;
      const card = visualCardFrom(cta);
      lastClickedCard = card;
      highlightedCard = card;
      const quote = quoteFromCard(card);
      if (quote) applyCapturedQuote(quote, { replace: true, scroll: false });
      holdTireHighlight();
      placeHighlightOverlay(card);
      window.setTimeout(highlightSelectedWidgetTires, 50);
      window.setTimeout(highlightSelectedWidgetTires, 250);
      window.setTimeout(highlightSelectedWidgetTires, 700);
      window.setTimeout(highlightSelectedWidgetTires, 1600);
    }, true);
    document.addEventListener('scroll', () => {
      placeHighlightOverlay(highlightedCard);
    }, true);
    window.addEventListener('resize', () => {
      placeHighlightOverlay(highlightedCard);
    });
  }

  function scrapeUnitPrice(text) {
    const perTire = String(text || '').match(/\$\s*([\d,]+\.\d{2})\s*per\s*tire/i);
    if (perTire) return Number(perTire[1].replace(/,/g, '')) || 0;
    const labeled = String(text || '').match(/(?:price each|unit price)[:\s]*\$\s*([\d,]+\.\d{2})/i);
    if (labeled) return Number(labeled[1].replace(/,/g, '')) || 0;
    const amounts = [...String(text || '').matchAll(/\$\s*([\d,]+\.\d{2})/g)]
      .map((match) => Number(match[1].replace(/,/g, '')))
      .filter((amount) => amount >= 40 && amount <= 900);
    return amounts[0] || 0;
  }

  function summaryBrandRoot() {
    const root = document.getElementById('tireconnect');
    const change = collectWidgetElements(root).find((el) => /change\s*tire/i.test(widgetButtonLabel(el)));
    let node = change;
    while (node && node !== root) {
      const text = String(node.innerText || '');
      if (/change\s*tire/i.test(text) && /warranty|category|size:/i.test(text) && text.length < 4000) {
        return node;
      }
      node = node.parentElement || node.getRootNode?.()?.host;
    }
    return root;
  }

  function collectBrandHaystack(root) {
    const chunks = [];
    collectWidgetElements(root).forEach((el) => {
      if (!el || el.nodeType !== 1) return;
      chunks.push(String(el.className || ''), String(el.id || ''));
      ['alt', 'title', 'aria-label', 'src', 'srcset', 'href', 'data-src', 'data-brand', 'data-srcset'].forEach((attr) => {
        const value = el.getAttribute?.(attr);
        if (value) chunks.push(value);
      });
      if (el.src) chunks.push(el.src);
      if (el.currentSrc) chunks.push(el.currentSrc);
      if (el.tagName === 'SVG' || el.tagName === 'IMG' || el.tagName === 'USE' || el.tagName === 'IMAGE') {
        try { chunks.push(el.outerHTML || ''); } catch (error) { /* ignore */ }
      }
      try {
        const bg = el.ownerDocument?.defaultView?.getComputedStyle?.(el)?.backgroundImage || '';
        if (bg && bg !== 'none') chunks.push(bg);
      } catch (error) {
        /* ignore */
      }
    });
    try { chunks.push(root?.outerHTML || ''); } catch (error) { /* ignore */ }
    return chunks.join('\n');
  }

  function scrapeBrand(text = '') {
    const scoped = isWidgetSummaryPage() ? summaryBrandRoot() : document.getElementById('tireconnect');
    return knownBrandIn(text)
      || knownBrandIn(collectBrandHaystack(scoped))
      || knownBrandIn(widgetPlainText())
      || '';
  }

  function refreshScrapedBrand() {
    if (!isWidgetSummaryPage()) return;
    const quote = quoteFromWidget();
    const currentBrand = cleanTireField(selectedQuote?.tires?.[0]?.brand);
    const scrapedBrand = cleanTireField(quote?.tires?.[0]?.brand);
    if (!scrapedBrand || scrapedBrand === currentBrand) return;
    applyCapturedQuote(quote || selectedQuote, { scroll: false });
  }

  function quoteFromWidget() {
    const text = widgetPlainText();
    const fromCard = quoteFromCard(lastClickedCard || highlightedCard);
    const fromHash = quoteFromHash();
    if (!text.trim()) return fromCard || fromHash;
    const onQuotePage = /PRICE SUMMARY|CHANGE TIRE|PER TIRE/i.test(text)
      || /summary|quote/i.test(window.location.hash || '');
    if (!onQuotePage) return fromCard || fromHash;
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const size = tireSizeValue(text) || fromCard?.tires?.[0]?.size || fromHash?.tires?.[0]?.size || '';
    const brand = isWidgetSummaryPage()
      ? (scrapeBrand(text) || fromCard?.tires?.[0]?.brand || fromHash?.tires?.[0]?.brand || '')
      : (fromCard?.tires?.[0]?.brand || fromHash?.tires?.[0]?.brand || scrapeBrand(text) || '');
    const skip = /price summary|change tire|revise search|per tire|see out|add to cart|place order|qty|warranty|category|add to compare|recommended|specs|features|reviews|sub-total|taxes|total price|touring|performance|winter|summer|all season|powered by|tireconnect|search by|in stock|load more|sort by|best match|summary|found\s+\d+\s+tires|tires for/i;
    const model = lines.find((line) => {
      if (skip.test(line) || isWidgetChrome(line)) return false;
      if (brand && line.toLowerCase() === brand.toLowerCase()) return false;
      if (size && line.replace(/\s+/g, '').toUpperCase().includes(size.replace(/\s+/g, '').toUpperCase())) return false;
      if (line.length < 4 || line.length > 70) return false;
      return /[A-Za-z]/.test(line);
    }) || fromCard?.tires?.[0]?.model || fromHash?.tires?.[0]?.model || '';
    const scraped = {
      brand: cleanTireField(brand),
      model: cleanTireField(model),
      size,
      qty: fromCard?.tires?.[0]?.qty || fromHash?.tires?.[0]?.qty || 4,
      price: scrapeUnitPrice(text) || fromCard?.tires?.[0]?.price || 0,
      partNumber: fromHash?.tires?.[0]?.partNumber || '',
    };
    const tire = mergeTire(fromCard?.tires?.[0] || fromHash?.tires?.[0] || {}, scraped);
    if (!isUsableTire(tire)) return fromCard || fromHash;
    return {
      tires: [tire],
      vehicle: fromCard?.vehicle || fromHash?.vehicle || {},
      hash: window.location.hash || '',
    };
  }

  function quoteFromHash() {
    const raw = decodeURIComponent(window.location.hash || '');
    if (!raw) return null;
    const qtyMatch = raw.match(/quantities(?:\[|%5B)0(?:\]|%5D)=(\d+)/i);
    const qty = Math.max(1, Number(qtyMatch?.[1]) || 0);
    const width = raw.match(/(?:width|t>width)[^0-9]{0,6}(\d{3})/i)?.[1];
    const height = raw.match(/(?:height|t>height)[^0-9]{0,6}(\d{2})/i)?.[1];
    const rim = raw.match(/(?:rim|t>rim)[^0-9]{0,6}(\d{2})/i)?.[1];
    const sizeFromParts = width && height && rim ? `${width}/${height}R${rim}` : '';
    const size = tireSizeValue(raw) || sizeFromParts;
    const encodedId = raw.match(/tire_ids(?:\[|%5B)0(?:\]|%5D)=([^&]+)/i)?.[1] || '';
    const decoded = decodeTireId(encodedId);
    const tire = {
      brand: cleanTireField(decoded.brand),
      model: cleanTireField(decoded.model),
      size,
      qty: qty || 4,
      price: 0,
      partNumber: decoded.partNumber || '',
    };
    if (!isUsableTire(tire)) return null;
    return {
      tires: [tire],
      vehicle: {},
      hash: window.location.hash || '',
    };
  }

  function hasCapturedTire(quote = selectedQuote) {
    return isUsableTire(quote?.tires?.[0]);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatQuoteSummary(quote) {
    if (!hasCapturedTire(quote)) {
      return 'Select a tire in the search. We copy the brand and size for you.';
    }
    return quote.tires.map((tire) => {
      const name = [tire.brand, tire.size].filter(Boolean).join(' ');
      const qty = tire.qty ? `${tire.qty} tires` : '';
      const price = money(tire.price);
      return [name, qty, price].filter(Boolean).join(' · ');
    }).join('\n');
  }

  function selectedTireFactsHtml(quote) {
    return (quote?.tires || []).map((tire) => {
      const rows = [
        ['Brand', cleanTireField(tire.brand) || '—'],
        ['Size', tireSizeValue(tire.size) || '—'],
        ['Quantity', String(tire.qty || 4)],
        ['Price/tire', money(tire.price) || '—'],
      ];
      return rows.map(([label, value]) => (
        `<div class="new-tire-selected-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
      )).join('');
    }).join('');
  }

  function returnUrl() {
    return `/new-tires.html${window.location.hash || selectedQuote?.hash || ''}`;
  }

  function updateAuthLinks() {
    const redirect = encodeURIComponent(returnUrl());
    const login = document.querySelector('[data-new-tire-login]');
    const signup = document.querySelector('[data-new-tire-signup]');
    if (login) login.href = `/login.html?redirect=${redirect}`;
    if (signup) signup.href = `/signup.html?redirect=${redirect}`;
    try {
      localStorage.setItem('eastcord_auth_redirect', returnUrl());
    } catch (error) {
      /* ignore */
    }
  }

  function selectedFulfillment() {
    const checked = document.querySelector('[data-new-tire-fulfillment-form] input[name="Fulfillment Preference"]:checked');
    return checked?.value === 'Installation' ? 'Installation' : 'Pickup';
  }

  function setFulfillmentMessage(message, isError = false) {
    const el = document.querySelector('[data-new-tire-fulfillment-message]');
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || '';
    el.dataset.error = isError ? 'true' : 'false';
  }

  function isSideBySideLayout() {
    return window.matchMedia('(min-width: 980px)').matches;
  }

  function scrollToFulfillment() {
    if (isSideBySideLayout()) return;
    const panel = document.querySelector('[data-new-tire-fulfillment]');
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyCapturedQuote(quote, { scroll = true, allowScrape = false, replace = false } = {}) {
    if (!quote?.tires?.length) return;
    storeQuote(quote, { replace });
    if (allowScrape) storeQuote(quoteFromWidget());
    syncFulfillmentUi();
    if (scroll && hasCapturedTire(selectedQuote) && !didAutoScroll) {
      didAutoScroll = true;
      window.setTimeout(scrollToFulfillment, 250);
    }
  }

  function syncFulfillmentUi() {
    const selected = document.querySelector('[data-new-tire-selected]');
    const selectedLabel = document.querySelector('[data-new-tire-selected-label]');
    const detailsField = document.querySelector('[data-new-tire-details-field]');
    const auth = document.querySelector('[data-new-tire-auth]');
    const submit = document.querySelector('[data-new-tire-submit]');
    const phoneField = document.querySelector('[data-new-tire-phone-field]');
    const phoneInput = phoneField?.querySelector('input');
    const signedIn = Boolean(currentProfile);
    const captured = hasCapturedTire();

    if (selected) selected.hidden = !captured;
    if (selectedLabel) selectedLabel.innerHTML = selectedTireFactsHtml(selectedQuote);
    if (detailsField) detailsField.hidden = captured;
    if (detailsInput() && captured) {
      detailsInput().required = false;
      detailsInput().value = formatQuoteSummary(selectedQuote);
    } else if (detailsInput()) {
      detailsInput().required = false;
    }
    if (auth) auth.hidden = signedIn;
    if (submit) submit.hidden = true;
    const needsPhone = signedIn && !String(currentProfile?.phone || '').trim();
    if (phoneField) phoneField.hidden = !needsPhone;
    if (phoneInput) {
      phoneInput.required = needsPhone;
      if (!needsPhone) phoneInput.value = currentProfile?.phone || '';
    }
    updateAuthLinks();
    highlightSelectedWidgetTires();
    syncDemoOrderButton();
  }

  async function refreshProfile() {
    currentProfile = await window.EastCordAccount?.getCurrentProfile?.() || null;
    syncFulfillmentUi();
    pushCustomerIntoWidget();
  }

  function phoneValue() {
    return String(
      document.querySelector('[data-new-tire-phone-field] input')?.value || currentProfile?.phone || '',
    ).trim();
  }

  function splitName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return {
      first_name: parts[0] || 'Customer',
      last_name: parts.slice(1).join(' ') || parts[0] || 'EastCord',
    };
  }

  function fulfillmentNote() {
    const order = lastSavedOrder || readConfirmedOrder();
    if (selectedFulfillment() === 'Installation' && order?.id) {
      return `EastCord fulfillment: Installation. Order ${order.id} is confirmed. Book installation at ${window.location.origin}${installationBookingUrl(order.id)}. Linked new tires. Next 4 days after purchase cannot be booked. Hours 8:00 AM to 8:00 PM.`;
    }
    return selectedFulfillment() === 'Installation'
      ? 'EastCord fulfillment: Installation. After the tire ORDER is saved, send the customer to book installation. Linked new tires. Next 4 days after purchase cannot be booked. Hours 8:00 AM to 8:00 PM.'
      : 'EastCord fulfillment: Pickup. Email or text the customer when tires arrive. No appointment.';
  }

  function rememberWidget(target) {
    if (target && typeof target.on === 'function') widgetApi = target;
  }

  function pushCustomerIntoWidget() {
    if (!currentProfile) return;
    const api = widgetApi || window.TCWidget;
    if (!api || typeof api.addCustomerInfo !== 'function') return;
    const names = splitName(currentProfile.name);
    try {
      api.addCustomerInfo({
        first_name: names.first_name,
        last_name: names.last_name,
        phone_number: phoneValue(),
        email: currentProfile.email || '',
        way_to_contact: 'email',
        notes: fulfillmentNote(),
      });
      logFlow('widget.addCustomerInfo', { email: currentProfile.email || '' });
    } catch (error) {
      logFlow('widget.addCustomerInfo.error', error);
    }
  }

  function quoteFromWidgetPayload(payload) {
    const data = eventPayload(payload);
    const nested = data.quote && typeof data.quote === 'object' ? data.quote : data;
    const leadQuote = Array.isArray(data.leads) ? data.leads[0]?.quotes?.[0] : null;
    const source = (leadQuote && typeof leadQuote === 'object') ? leadQuote : nested;
    return quoteFromSelectEvent({
      ...source,
      tires: source.tires || nested.tires || data.tires,
      vehicle: source.vehicle || nested.vehicle || data.vehicle,
    });
  }

  function customerFromWidgetPayload(payload) {
    const data = eventPayload(payload);
    const nested = data.customer && typeof data.customer === 'object' ? data.customer : {};
    const leadCustomer = Array.isArray(data.leads) ? data.leads[0]?.customer : null;
    const src = (nested.first_name || nested.email || nested.phone_number)
      ? nested
      : (leadCustomer && typeof leadCustomer === 'object' ? leadCustomer : {});
    const name = [src.first_name, src.last_name].filter(Boolean).join(' ').trim()
      || currentProfile?.name
      || '';
    return {
      name,
      email: String(src.email || currentProfile?.email || '').trim(),
      phone: String(src.phone_number || src.phone || phoneValue()).trim(),
    };
  }

  function totalsFromWidget() {
    const text = widgetPlainText();
    const moneyMatch = (pattern) => Number(String(text.match(pattern)?.[1] || '').replace(/,/g, '')) || 0;
    return {
      subtotal: moneyMatch(/sub-total[:\s]*\$([\d,.]+)/i),
      tax: moneyMatch(/taxes[:\s]*\$([\d,.]+)/i),
      total: moneyMatch(/(?:payment due|total price)[:\s]*\$([\d,.]+)/i),
    };
  }

  function orderNotifyKey(payload) {
    const items = (payload.items || []).map((item) => (
      `${item.qty || 1}-${item.brand || ''}-${item.size || ''}-${item.partNumber || ''}`
    )).join(',');
    return [
      payload.orderNumber || '',
      payload.customer?.email || '',
      payload.fulfillment || '',
      items,
    ].join('|');
  }

  function successMessage(fulfillment) {
    return fulfillment === 'Installation'
      ? 'Tires saved to your account. Next we will open installation booking, linked to these new tires and your purchase date. The next 4 days after purchase cannot be booked.'
      : 'Order placed. We will email you when your tires are ready for pickup. No appointment is needed.';
  }

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function selectedTireQty() {
    const tires = selectedQuote?.tires || [];
    const qty = tires.reduce((sum, tire) => sum + (Number(tire.qty) || 1), 0);
    return Math.min(4, Math.max(1, qty || 4));
  }

  function panelInstallationAppointment() {
    if (selectedFulfillment() !== 'Installation' || !installSlot?.date || !installSlot?.time) return null;
    const qty = selectedTireQty();
    const serviceSubtotal = qty * 25;
    const hstAmount = roundMoney(serviceSubtotal * 0.13);
    const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
    const depositAmount = roundMoney(totalWithHst * 0.2);
    return {
      type: 'appointment',
      serviceId: `mount-balance-${qty}`,
      serviceName: `Mount & Balance - ${qty} Tire${qty === 1 ? '' : 's'}`,
      startingPrice: serviceSubtotal,
      serviceSubtotal,
      hstAmount,
      totalWithHst,
      taxRate: 0.13,
      depositAmount,
      remainingBalance: roundMoney(totalWithHst - depositAmount),
      preferredDate: installSlot.date,
      preferredTimeWindow: installSlot.time,
      numberOfTires: qty,
      tireSize: selectedQuote?.tires?.[0]?.size || '',
      city: 'Milton',
      fullServiceAddress: 'To be confirmed with the new tire installation',
      parkingAccessNotes: 'Booked with new tire order',
      additionalNotes: 'Mock or widget new-tire installation booking.',
      awaitingNewTireOrder: true,
      source: 'new-tires',
    };
  }

  function pendingInstallationAppointments() {
    let fromCart = [];
    try {
      fromCart = (window.EastCordAccount?.getCart?.() || []).filter((item) => {
        if (item?.type !== 'appointment') return false;
        if (item.newTireOrderId) return false;
        return item.awaitingNewTireOrder || item.source === 'new-tires' || String(item.serviceId || '').startsWith('mount-balance');
      });
    } catch (error) {
      fromCart = [];
    }
    const panel = panelInstallationAppointment();
    if (!panel) return fromCart;
    const already = fromCart.some((item) => (
      item.preferredDate === panel.preferredDate && item.preferredTimeWindow === panel.preferredTimeWindow
    ));
    return already ? fromCart : [panel, ...fromCart];
  }

  function linkCartAppointmentsToOrder(orderId, appointmentIds = []) {
    if (!orderId || !window.EastCordAccount?.getCart || !window.EastCordAccount?.saveCart) return;
    const unused = [...appointmentIds].filter(Boolean);
    const next = window.EastCordAccount.getCart().map((item) => {
      if (item?.type !== 'appointment' || item.newTireOrderId) return item;
      if (!(item.awaitingNewTireOrder || item.source === 'new-tires' || String(item.serviceId || '').startsWith('mount-balance'))) {
        return item;
      }
      const matched = unused.findIndex((id) => id === item.bookingId);
      const bookingId = matched >= 0 ? unused.splice(matched, 1)[0] : (unused.shift() || item.bookingId);
      return {
        ...item,
        newTireOrderId: orderId,
        bookingId,
        awaitingNewTireOrder: false,
        source: 'new-tires',
      };
    });
    window.EastCordAccount.saveCart(next);
    window.EastCordAccount.saveCustomerCart?.('appointment', next).catch(() => {});
  }

  function memberGate() {
    if (!currentProfile) {
      return {
        ok: false,
        message: 'Please log in or create an account first. Then finish checkout in the tire search.',
      };
    }
    if (!phoneValue()) {
      return { ok: false, message: 'Please enter a phone number, then finish checkout in the tire search.' };
    }
    return { ok: true };
  }

  function captureQuoteFromWidgetEvent(event, { replace = true, allowScrape = false } = {}) {
    const quote = quoteFromWidgetPayload(event);
    if (quote) applyCapturedQuote(quote, { replace, allowScrape, scroll: false });
    return quote;
  }

  function isCompletedOrderStatus(status) {
    return status === 'submitted' || status === 'success';
  }

  function itemsFromWidgetPayload(data) {
    const fromEvent = (quoteFromWidgetPayload(data)?.tires || []).filter((tire) => isUsableTire(tire));
    const fromSelected = selectedQuote?.tires || [];
    if (!fromEvent.length) return fromSelected;
    if (!fromSelected.length) return fromEvent;
    return fromEvent.map((tire, index) => mergeTire(fromSelected[index] || fromSelected[0] || {}, tire));
  }

  async function handleWidgetOrderComplete(event, source = 'callback') {
    const data = eventPayload(event);
    const status = String(data.status || data.order_status || '').toLowerCase();
    logFlow(`checkout.complete.${source}`, { status, data });
    captureQuoteFromWidgetEvent(event);
    const gate = memberGate();
    if (!gate.ok) {
      logFlow('supabase.skipped', gate.message);
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      scrollToFulfillment();
      return { saved: false };
    }
    const customer = customerFromWidgetPayload(event);
    const items = itemsFromWidgetPayload(data);
    logFlow('supabase.prepare', { customer, items, fulfillment: selectedFulfillment() });
    if (!items.length) {
      logFlow('supabase.skipped', 'No tire details on the completed order.');
      setFulfillmentMessage('Checkout finished, but EastCord could not copy the tire details. Contact info@eastcordtires.ca so we can attach this order to your account.', true);
      return { saved: false };
    }
    if (!customer.email || !customer.phone || !customer.name) {
      logFlow('supabase.skipped', 'Missing customer name, email, or phone. Log in and complete checkout.');
      setFulfillmentMessage('Checkout finished in the tire search. Log in so EastCord can save this order to your account.', true);
      return { saved: false };
    }
    const nested = data.quote && typeof data.quote === 'object' ? data.quote : data;
    const widgetCustomer = data.customer && typeof data.customer === 'object' ? data.customer : {};
    const address = widgetCustomer.address || {};
    const addressLine = [
      address.address_line_1 || address.address_1,
      address.address_line_2 || address.address_2,
      address.city,
      address.province,
      address.postal_code,
      address.country,
    ].filter(Boolean).join(', ');
    const scrapedTotals = totalsFromWidget();
    return saveWidgetOrderToAccount({
      customer,
      fulfillment: selectedFulfillment(),
      items,
      notes: [
        formatQuoteSummary(selectedQuote) || fulfillmentNote(),
        addressLine ? `Address: ${addressLine}` : '',
        widgetCustomer.notes ? `Widget notes: ${widgetCustomer.notes}` : '',
        data.notes_extra || '',
        source === 'demo' || source === 'widget-checkout'
          ? 'Local widget test checkout. No live card was charged.'
          : 'Paid in the TireConnect widget checkout.',
      ].filter(Boolean).join('\n'),
      vehicle: selectedQuote?.vehicle || nested.vehicle || {},
      orderNumber: String(data.order_number || nested.order_number || ''),
      recordedLocally: source === 'demo' || source === 'widget-checkout',
      appointments: [],
      totals: {
        subtotal: nested.subtotal ?? data.subtotal ?? scrapedTotals.subtotal,
        tax: nested.total_tax ?? data.total_tax ?? scrapedTotals.tax,
        total: nested.total_price ?? data.total_price ?? scrapedTotals.total,
        deposit: data.deposit_payment,
        outstanding: data.outstanding_balance,
      },
    });
  }

  function mockSubmittedOrderPayload(overrides = {}) {
    const names = splitName(currentProfile?.name || 'Demo Customer');
    const tire = selectedQuote?.tires?.[0] || {
      brand: 'Toyo',
      model: 'Celsius',
      size: '215/50R17',
      qty: 4,
      price: 159.99,
      partNumber: '128430',
    };
    const qty = Math.max(1, Number(tire.qty) || 4);
    const unit = Number(tire.price) || 159.99;
    const subtotal = Math.round(unit * qty * 100) / 100;
    const payload = {
      status: 'submitted',
      order_number: `demo-${Date.now()}`,
      total_price: subtotal,
      subtotal,
      total_tax: 0,
      quote: {
        tires: [{
          brand_name: tire.brand || 'Toyo',
          model_name: tire.model || 'Celsius',
          size: tire.size || '215/50R17',
          quantity: qty,
          part_number: tire.partNumber || '128430',
          price: unit,
        }],
        vehicle: selectedQuote?.vehicle || { year: 2022, make: 'Honda', model: 'Civic' },
      },
      customer: {
        first_name: names.first_name,
        last_name: names.last_name,
        email: currentProfile?.email || 'demo@eastcordtires.ca',
        phone_number: phoneValue() || '3658225553',
      },
    };
    return { ...payload, ...overrides };
  }

  function isDemoOrderEnabled() {
    return isLocalHost();
  }

  function syncDemoOrderButton() {
    const button = document.querySelector('[data-new-tire-demo-order]');
    const hint = document.querySelector('[data-new-tire-demo-hint]');
    if (!button) return;
    const enabled = isDemoOrderEnabled();
    button.hidden = !enabled;
    if (hint) hint.hidden = !enabled;
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => {
      logFlow('demo.buttonClick');
      simulateSubmittedOrder();
    });
  }

  async function simulateSubmittedOrder(overrides = {}) {
    logFlow('demo.simulateSubmittedOrder.start');
    const button = document.querySelector('[data-new-tire-demo-order]');
    const gate = memberGate();
    if (!gate.ok) {
      logFlow('demo.simulateSubmittedOrder.blocked', gate.message);
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      scrollToFulfillment();
      return { saved: false };
    }
    if (!hasCapturedTire()) {
      setFulfillmentMessage('Select a tire in the search first, then use Mock order.', true);
      syncFulfillmentUi();
      return { saved: false };
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving mock order…';
    }
    try {
      const payload = mockSubmittedOrderPayload(overrides);
      logFlow('demo.mockPayload', payload);
      applyCapturedQuote(quoteFromWidgetPayload(payload) || selectedQuote, { replace: false, scroll: false });
      const result = await handleWidgetOrderComplete(payload, 'demo');
      logFlow('demo.simulateSubmittedOrder.done', result);
      return result;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Mock order';
      }
    }
  }

  async function saveWidgetOrderToAccount(payload) {
    const key = orderNotifyKey(payload);
    logFlow('supabase.submit.start', payload);
    if (key && key === lastNotifiedOrderKey) {
      logFlow('supabase.submit.duplicate', key);
      return { saved: true, duplicate: true, orderId: lastSavedOrder?.id || '' };
    }

    try {
      const token = await window.EastCordAccount?.getAccessToken?.();
      logFlow('supabase.submit.auth', { hasToken: Boolean(token) });
      const response = await fetch('/.netlify/functions/save-new-tire-widget-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      logFlow('supabase.submit.response', { status: response.status, data });
      if (!response.ok) {
        setFulfillmentMessage(
          data.message
            || (payload.recordedLocally
              ? 'The demo order could not be saved to your account. Log in and try again.'
              : 'Checkout finished in the tire search. EastCord still needs to save this order to your account.'),
          true,
        );
        return { saved: false };
      }
      lastNotifiedOrderKey = key;
      rememberConfirmedOrder(data.orderId, payload.fulfillment);
      linkCartAppointmentsToOrder(data.orderId, data.appointmentIds || []);
      const goBook = payload.fulfillment === 'Installation' && data.orderId;
      setFulfillmentMessage(
        goBook
          ? 'Tires saved to your account. Opening installation booking for these new tires…'
          : (payload.recordedLocally
            ? `Mock order saved. Tire order ${data.orderId || ''} is in your account.`
            : successMessage(payload.fulfillment)),
        false,
      );
      if (!payload.recordedLocally) {
        try {
          sessionStorage.removeItem(QUOTE_STORAGE_KEY);
        } catch (error) {
          /* ignore */
        }
      }
      logFlow('supabase.submit.saved', {
        orderId: data.orderId || '',
        alreadySaved: data.alreadySaved,
        redirectInstall: Boolean(goBook),
      });
      if (goBook) {
        window.location.href = installationBookingUrl(data.orderId);
      }
      return {
        saved: true,
        orderId: data.orderId || '',
        appointmentIds: data.appointmentIds || [],
        appointmentCount: Number(data.appointmentCount || 0),
      };
    } catch (error) {
      logFlow('supabase.submit.error', error);
      setFulfillmentMessage(
        payload.recordedLocally
          ? 'The demo order could not be saved. Log in and try again.'
          : 'Checkout finished in the tire search. If it does not appear on My Account, contact info@eastcordtires.ca.',
        true,
      );
      return { saved: false };
    }
  }

  function bindWidgetEvents(target) {
    if (!target || typeof target.on !== 'function') return;
    if (boundWidgets.has(target)) return;
    boundWidgets.add(target);
    rememberWidget(target);
    logFlow('widget.eventsBound');

    const listen = (name, handler) => {
      target.on(name, (event) => {
        logFlow(`callback.${name}`, eventPayload(event));
        return handler(event);
      });
    };

    listen('onTireSelect', (event) => {
      const fromEvent = quoteFromSelectEvent(eventPayload(event));
      const fromCard = quoteFromCard(lastClickedCard || highlightedCard);
      applyCapturedQuote(fromEvent || fromCard, { replace: false });
      if (fromCard) applyCapturedQuote(fromCard, { replace: false, scroll: false });
      holdTireHighlight();
      window.setTimeout(highlightSelectedWidgetTires, 50);
      window.setTimeout(highlightSelectedWidgetTires, 400);
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
    listen('onSummaryInitiated', (event) => {
      applyCapturedQuote(quoteFromWidgetPayload(event) || quoteFromSelectEvent(eventPayload(event)), { allowScrape: true });
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
    listen('onPageChanged', (event) => {
      const page = String(eventPayload(event).page || event?.page || '');
      logFlow('checkout.pageChanged', page);
      if (/summary|quote|order|checkout|payment/i.test(page)) {
        applyCapturedQuote(quoteFromHash() || selectedQuote, { allowScrape: true });
        pushCustomerIntoWidget();
      }
      syncSummaryLayout();
      resolveWidgetEvent(event);
    });
    listen('onResultsReviseClick', (event) => {
      didAutoScroll = false;
      hideHighlightOverlay();
      resolveWidgetEvent(event);
    });
    listen('onResultsReviseClicked', (event) => {
      didAutoScroll = false;
      hideHighlightOverlay();
      resolveWidgetEvent(event);
    });
    listen('onAppointmentClick', (event) => {
      captureQuoteFromWidgetEvent(event);
      rejectWidgetEvent(event);
      if (selectedFulfillment() === 'Pickup') {
        logFlow('appointment.blockedPickup');
        setFulfillmentMessage('Pickup orders do not need an appointment. We email you when the tires are ready.', true);
        syncFulfillmentUi();
        return;
      }
      const order = lastSavedOrder || readConfirmedOrder();
      if (order?.id) {
        logFlow('appointment.redirectAfterOrder', order.id);
        window.location.href = installationBookingUrl(order.id);
        return;
      }
      setFulfillmentMessage('Complete ORDER in the tire search first. After the tires are saved to your account, we will take you to book installation.', true);
      syncFulfillmentUi();
    });
    const handleOrderClick = (event) => {
      logFlow('checkout.orderClick', eventPayload(event));
      const gate = memberGate();
      if (!gate.ok) {
        rejectWidgetEvent(event);
        setFulfillmentMessage(gate.message, true);
        syncFulfillmentUi();
        scrollToFulfillment();
        return;
      }
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    };
    listen('onEcommerceOrderClick', handleOrderClick);
    listen('onOrderClick', handleOrderClick);
    listen('onOrderInitiated', (event) => {
      logFlow('checkout.orderInitiated', eventPayload(event));
      const gate = memberGate();
      if (!gate.ok) {
        rejectWidgetEvent(event);
        setFulfillmentMessage(gate.message, true);
        syncFulfillmentUi();
        scrollToFulfillment();
        return;
      }
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
    listen('onEcommerceOrder', (event) => {
      const status = String(eventPayload(event).status || '').toLowerCase();
      logFlow('checkout.ecommerceOrder', { status, payload: eventPayload(event) });
      captureQuoteFromWidgetEvent(event);
      resolveWidgetEvent(event);
      if (isCompletedOrderStatus(status)) {
        handleWidgetOrderComplete(event, 'onEcommerceOrder');
        return;
      }
      pushCustomerIntoWidget();
    });
    listen('onOrderSubmitted', (event) => {
      resolveWidgetEvent(event);
      handleWidgetOrderComplete(event, 'onOrderSubmitted');
    });
    listen('onLead', (event) => {
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
  }

  function widgetButtonLabel(el) {
    return String(el?.textContent || el?.value || '').replace(/\s+/g, ' ').trim();
  }

  function isElementVisible(el) {
    if (!el?.isConnected || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (!style) return true;
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }

  function isLeafButton(el, test) {
    if (!el || el.nodeType !== 1 || !test(widgetButtonLabel(el))) return false;
    return ![...el.children].some((child) => test(widgetButtonLabel(child)));
  }

  function isSelectCtaLabel(text) {
    return isOutTheDoorLabel(text) || /^(add to cart|place order)$/i.test(text);
  }

  function isCheckoutCtaLabel(text) {
    return /^(place\s+order|order|order now|checkout|pay now|continue to (order|checkout|payment))$/i.test(String(text || '').trim());
  }

  function clickClickable(el) {
    const clickable = el.closest?.('button, a, [role="button"]') || el;
    if (typeof clickable.scrollIntoView === 'function') {
      clickable.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    clickable.click();
  }

  function findVisibleWidgetButtons(test) {
    return collectWidgetElements(document.getElementById('tireconnect'))
      .filter((el) => isLeafButton(el, test) && isElementVisible(el));
  }

  function clickWidgetSelectCta() {
    const scoped = collectWidgetElements(highlightedCard || lastClickedCard || document.getElementById('tireconnect'))
      .filter((el) => isLeafButton(el, isSelectCtaLabel) && isElementVisible(el));
    const buttons = scoped.length ? scoped : findVisibleWidgetButtons(isSelectCtaLabel);
    if (!buttons.length) return false;
    clickClickable(buttons[0]);
    return true;
  }

  function findCheckoutButtons() {
    return findVisibleWidgetButtons(isCheckoutCtaLabel).filter((el) => {
      const text = widgetButtonLabel(el);
      if (isOutTheDoorLabel(text) || /^add to cart$/i.test(text)) return false;
      return true;
    }).sort((a, b) => {
      const aOrder = /^order/i.test(widgetButtonLabel(a)) ? 0 : 1;
      const bOrder = /^order/i.test(widgetButtonLabel(b)) ? 0 : 1;
      return aOrder - bOrder;
    });
  }

  function clickWidgetCheckoutCta() {
    const buttons = findCheckoutButtons();
    if (!buttons.length) return false;
    clickClickable(buttons[0]);
    return true;
  }

  function waitUntil(test, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (test()) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        window.setTimeout(tick, 150);
      };
      tick();
    });
  }

  function submitOrderRequest(event) {
    event.preventDefault();
    logFlow('panel.formSubmit');
    const gate = memberGate();
    if (!gate.ok) {
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      return;
    }
    pushCustomerIntoWidget();
  }

  function initTireConnect() {
    const config = window.EASTCORD_TIRECONNECT_CONFIG || {};
    const apiKey = String(config.apiKey || '').trim();
    const container = document.getElementById('tireconnect');

    if (!container || !apiKey) {
      logFlow('widget.init.missingConfig', { hasContainer: Boolean(container), hasApiKey: Boolean(apiKey) });
      showFallback();
      return;
    }

    if (!window.TCWidget || typeof window.TCWidget.init !== 'function') {
      console.error('[EastCord TireConnect] TireConnect widget script did not load.');
      showFallback();
      return;
    }

    try {
      logFlow('widget.init.start');
      bindWidgetEvents(window.TCWidget);
      const initialized = window.TCWidget.init({
        apikey: apiKey,
        container: 'tireconnect',
      });
      if (initialized && typeof initialized.then === 'function') {
        initialized.then((widget) => {
          logFlow('widget.init.ready');
          rememberWidget(widget);
          bindWidgetEvents(widget);
          pushCustomerIntoWidget();
          onWidgetDomChanged();
        }).catch((error) => {
          console.error('[EastCord TireConnect] Widget initialization failed.', error);
          showFallback();
        });
      }
    } catch (error) {
      console.error('[EastCord TireConnect] Widget initialization failed.', error);
      showFallback();
    }
  }

  function isTireConnectMessage(event) {
    const origin = String(event.origin || '');
    if (/tireconnect/i.test(origin)) return true;
    const data = event.data;
    if (!data || typeof data !== 'object') return false;
    const type = String(data.type || data.event || data.name || '');
    return Boolean(data.order_number || /onEcommerceOrder|onOrderSubmitted|order.?submitted/i.test(type));
  }

  function handleWidgetMessage(event) {
    if (!isTireConnectMessage(event)) return;
    logFlow('postMessage', { origin: event.origin, data: event.data });
    const data = eventPayload(event.data);
    const type = String(data.type || data.event || data.name || '');
    const status = String(data.status || data.order_status || '').toLowerCase();
    const quote = quoteFromSelectEvent(data) || quoteFromWidgetPayload(data);
    if (quote) applyCapturedQuote(quote, { scroll: false });
    if (isCompletedOrderStatus(status) || /order.?submitted/i.test(type)) {
      handleWidgetOrderComplete(data, 'postMessage');
    }
  }

  function bindPage() {
    document.querySelector('[data-new-tire-fulfillment-form]')?.addEventListener('change', (event) => {
      if (event.target.name !== 'Fulfillment Preference') return;
      logFlow('panel.fulfillmentChanged', selectedFulfillment());
      document.querySelectorAll('[data-choice-info]').forEach((button) => {
        const tip = document.getElementById(button.getAttribute('aria-controls') || '');
        if (tip) tip.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      });
      syncFulfillmentUi();
      pushCustomerIntoWidget();
    });
    document.querySelector('[data-new-tire-fulfillment-form]')?.addEventListener('submit', submitOrderRequest);
    document.querySelector('[data-new-tire-change]')?.addEventListener('click', () => {
      clearQuote();
      document.getElementById('tireconnect')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    window.addEventListener('eastcord:auth-changed', (event) => {
      currentProfile = event.detail?.signedIn ? event.detail.profile : null;
      logFlow('auth.changed', { signedIn: Boolean(currentProfile) });
      syncFulfillmentUi();
      pushCustomerIntoWidget();
    });
    window.addEventListener('hashchange', () => {
      logFlow('widget.hashchange', window.location.hash);
      if (!isWidgetResultsPage()) hideHighlightOverlay();
      applyCapturedQuote(quoteFromHash() || quoteFromWidget(), { scroll: /summary|quote|order/i.test(window.location.hash) });
    });
    const widget = document.getElementById('tireconnect');
    if (widget && typeof MutationObserver === 'function') {
      let timer = 0;
      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          onWidgetDomChanged();
          const scraped = quoteFromWidget();
          if (scraped && !hasCapturedTire()) applyCapturedQuote(scraped, { scroll: false });
        }, 50);
      });
      observer.observe(widget, { childList: true, subtree: true, characterData: true });
      widget.addEventListener('load', onWidgetDomChanged, true);
    }
    onWidgetDomChanged();
    bindWidgetHighlightClicks();
    bindLocalWidgetCheckout();
    bindChoiceInfo();
    window.addEventListener('message', handleWidgetMessage);
  }

  window.EastCordNewTiresDemo = {
    mockSubmittedOrderPayload,
    simulateSubmittedOrder,
    logFlow,
  };

  window.addEventListener('DOMContentLoaded', () => {
    logFlow('page.ready', { host: window.location.host });
    bindPage();
    initTireConnect();
    refreshProfile();
    applyCapturedQuote(selectedQuote || quoteFromHash(), { scroll: false });
  });
})();
