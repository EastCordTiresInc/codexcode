(() => {
  const fallbackMessage = 'New tire shopping is temporarily unavailable. Please contact EastCord Tires for assistance.';
  const QUOTE_STORAGE_KEY = 'eastcord_new_tire_quote_v1';

  let currentProfile = null;
  let selectedQuote = readStoredQuote();
  let didAutoScroll = false;
  let lastClickedCard = null;
  let highlightedCard = null;
  let widgetApi = null;
  let lastNotifiedOrderKey = '';
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
    if (event && typeof event.resolve === 'function') event.resolve();
  }

  function readStoredQuote() {
    try {
      return JSON.parse(sessionStorage.getItem(QUOTE_STORAGE_KEY) || 'null');
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
    return /^(revise search|change (tire|search|vehicle)|search by|search tires|price summary|see out|add to cart|place order|add to compare|powered by|tireconnect|qty|quantity|warranty|category|recommended|specs|features|reviews|sub-total|taxes|total price|per tire|touring|performance|winter|summer|all season|all weather|in stock|load more|show more|next|previous|filters?|sort by|best match)$/i.test(text)
      || /revise search|powered by|add to compare/i.test(text);
  }

  function cleanTireField(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return isWidgetChrome(text) ? '' : text;
  }

  function mergeTire(current = {}, incoming = {}) {
    return {
      brand: cleanTireField(incoming.brand) || cleanTireField(current.brand) || '',
      model: cleanTireField(incoming.model) || cleanTireField(current.model) || '',
      size: cleanTireField(incoming.size) || cleanTireField(current.size) || '',
      qty: incoming.qty || current.qty || 1,
      price: incoming.price || current.price || 0,
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
    if (payload.tire && typeof payload.tire === 'object') return [payload.tire];
    if (payload.brand_name || payload.model_name || payload.size) return [payload];
    return [];
  }

  function quoteFromSelectEvent(payload) {
    const tires = extractTires(payload);
    const vehicle = payload.vehicle || {};
    if (!tires.length) return null;
    return {
      tires: tires.map((tire) => ({
        brand: cleanTireField(tire.brand_name || tire.brand || tire.manufacturer || tire.tire_brand),
        model: cleanTireField(tire.model_name || tire.model || tire.product_name || tire.tire_model),
        size: String(tire.size || tire.sizeShort || tire.tire_size || '').trim(),
        qty: Math.max(1, Number(tire.selectedQuantity ?? tire.selected_quantity ?? tire.quantity ?? tire.qty) || 4),
        price: Number(tire.price) || 0,
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

  const PLACE_ORDER_LABEL = 'Place Order';
  const OUT_THE_DOOR_LABEL = /see\s+out[-\s]?the[-\s]?door[-\s]?price/i;

  function isOutTheDoorLabel(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return Boolean(text) && text.length <= 64 && OUT_THE_DOOR_LABEL.test(text);
  }

  function replaceOutTheDoorText(element) {
    const texts = [];
    const walker = (element.ownerDocument || document).createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (String(walker.currentNode.nodeValue || '').replace(/\s+/g, ' ').trim()) {
        texts.push(walker.currentNode);
      }
    }
    if (!texts.length) return false;
    texts[0].nodeValue = PLACE_ORDER_LABEL;
    texts.slice(1).forEach((node) => {
      node.nodeValue = '';
    });
    return true;
  }

  function isWidgetSummaryPage() {
    const hash = window.location.hash || '';
    if (/(summary|quote)/i.test(hash) && !/results/i.test(hash)) return true;
    const text = widgetPlainText();
    if (/BACK TO SUMMARY|CREDIT CARD NUMBER|PAY WITH CREDIT CARD/i.test(text)) return false;
    return /CHANGE TIRE/i.test(text) && /PRICE SUMMARY|SUB-TOTAL/i.test(text);
  }

  function isWidgetCheckoutPage() {
    const text = widgetPlainText();
    return /PLACE YOUR ORDER|BACK TO SUMMARY|PAY WITH CREDIT CARD|CREDIT CARD NUMBER/i.test(text);
  }

  function syncSummaryLayout() {
    document.querySelector('.new-tires-workspace')?.classList.remove('is-widget-summary');
  }

  function relabelWidgetRoot(root) {
    if (!root || !root.querySelectorAll) return;

    const elements = [root, ...root.querySelectorAll('*')];
    elements.forEach((el) => {
      if (!el || el.nodeType !== 1) return;
      if (el.shadowRoot) relabelWidgetRoot(el.shadowRoot);
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument?.body) relabelWidgetRoot(el.contentDocument.body);
        } catch (error) {
          /* cross-origin iframe cannot be rewritten */
        }
      }

      ['aria-label', 'title', 'placeholder'].forEach((attr) => {
        if (isOutTheDoorLabel(el.getAttribute(attr))) el.setAttribute(attr, PLACE_ORDER_LABEL);
      });
      if (isOutTheDoorLabel(el.value)) el.value = PLACE_ORDER_LABEL;
      if (!isOutTheDoorLabel(el.textContent)) return;
      if ([...el.children].some((child) => isOutTheDoorLabel(child.textContent))) return;
      replaceOutTheDoorText(el);
    });
  }

  function relabelWidgetButtons() {
    syncSummaryLayout();
    if (!isWidgetSummaryPage() && !isWidgetCheckoutPage()) {
      relabelWidgetRoot(document.getElementById('tireconnect'));
    }
    hideWidgetLeadFields();
    revealWidgetOrderButtons();
    injectEastCordOrderButton();
    highlightSelectedWidgetTires();
  }

  function isSummaryActionText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 48) return false;
    return /^(order|order now|continue|save your quote|request an appointment|request appointment)$/i.test(text);
  }

  function revealWidgetOrderButtons() {
    if (!isWidgetSummaryPage() || isWidgetCheckoutPage()) return;
    const buttons = collectWidgetElements(document.getElementById('tireconnect')).filter((el) => {
      if (el.nodeType !== 1) return false;
      if (!isSummaryActionText(el.textContent) && !isSummaryActionText(el.value)) return false;
      return ![...el.children].some((child) => isSummaryActionText(child.textContent) || isSummaryActionText(child.value));
    });
    buttons.forEach((el) => {
      let node = el;
      for (let i = 0; i < 6 && node; i += 1) {
        node.removeAttribute?.('data-eastcord-hide-field');
        node.removeAttribute?.('hidden');
        if (node.style?.removeProperty) {
          node.style.removeProperty('display');
          node.style.removeProperty('visibility');
          node.style.removeProperty('opacity');
        }
        node = node.parentElement;
      }
    });
  }

  function isLocalHost() {
    return /localhost|127\.0\.0\.1/i.test(window.location.hostname);
  }

  function hasNativeOrderButton() {
    return collectWidgetElements(document.getElementById('tireconnect')).some((el) => {
      if (el.nodeType !== 1 || el.id === 'eastcord-widget-order') return false;
      const text = widgetButtonLabel(el);
      if (!/^(order|order now)$/i.test(text)) return false;
      return ![...el.children].some((child) => /^(order|order now)$/i.test(widgetButtonLabel(child)));
    });
  }

  function widgetSelectedQty() {
    const select = collectWidgetElements(document.getElementById('tireconnect')).find((el) => (
      el.tagName === 'SELECT' && isElementVisible(el)
    ));
    const qty = Number(select?.value);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
  }

  function widgetUnitPrice() {
    const text = widgetPlainText();
    return Number(String(text.match(/per tire[:\s]*\$([\d,.]+)/i)?.[1] || '').replace(/,/g, '')) || 0;
  }

  function widgetPartNumber() {
    const text = widgetPlainText();
    return String(text.match(/part\s*#\s*[:\s]*([A-Za-z0-9-]+)/i)?.[1] || '').trim();
  }

  function refreshQuoteFromSummary() {
    const scraped = quoteFromWidget();
    const current = selectedQuote?.tires?.[0] || {};
    const scrapedTire = scraped?.tires?.[0] || {};
    const qty = widgetSelectedQty() || Number(current.qty) || Number(scrapedTire.qty) || 4;
    const totals = totalsFromWidget();
    const unit = widgetUnitPrice()
      || (totals.subtotal && qty ? Math.round((totals.subtotal / qty) * 100) / 100 : 0)
      || Number(current.price)
      || 0;
    const tire = {
      brand: cleanTireField(scrapedTire.brand || current.brand),
      model: cleanTireField(scrapedTire.model || current.model),
      size: String(scrapedTire.size || current.size || '').trim(),
      qty,
      price: unit,
      partNumber: widgetPartNumber() || scrapedTire.partNumber || current.partNumber || '',
    };
    if (!tire.brand && !tire.size) return null;
    applyCapturedQuote({ tires: [tire], vehicle: selectedQuote?.vehicle || scraped?.vehicle || {} }, {
      replace: true,
      scroll: false,
    });
    return selectedQuote;
  }

  function summaryActionRow() {
    const quoteBtn = collectWidgetElements(document.getElementById('tireconnect')).find((el) => (
      el.nodeType === 1 && /^save your quote$/i.test(widgetButtonLabel(el))
    ));
    if (!quoteBtn) return null;
    let node = quoteBtn.parentElement;
    for (let i = 0; i < 8 && node && node.id !== 'tireconnect'; i += 1) {
      const labels = collectWidgetElements(node).map((el) => widgetButtonLabel(el));
      if (labels.some((label) => /save your quote/i.test(label))
        && labels.some((label) => /appointment/i.test(label))) {
        return node;
      }
      node = node.parentElement;
    }
    return quoteBtn.parentElement;
  }

  function shouldShowLocalOrder() {
    return isLocalHost()
      && !isWidgetCheckoutPage()
      && !hasNativeOrderButton()
      && (isWidgetSummaryPage() || hasCapturedTire());
  }

  function localOrderButtons() {
    return [
      document.getElementById('eastcord-widget-order'),
      document.querySelector('[data-new-tire-local-order]'),
    ].filter(Boolean);
  }

  function setLocalOrderBusy(busy, label) {
    localOrderButtons().forEach((button) => {
      button.disabled = Boolean(busy);
      button.textContent = label || 'ORDER';
    });
  }

  function injectEastCordOrderButton() {
    const show = shouldShowLocalOrder();
    const bar = document.getElementById('eastcord-widget-order-bar');
    const panel = document.querySelector('[data-new-tire-local-order]');
    if (bar) bar.hidden = !show;
    document.querySelector('[data-tireconnect-shell]')?.classList.toggle('is-local-order', show);
    if (panel) panel.hidden = !show;
    localOrderButtons().forEach((button) => {
      if (button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      button.addEventListener('click', submitEastCordWidgetOrder);
    });
  }

  async function submitEastCordWidgetOrder() {
    const gate = memberGate();
    if (!gate.ok) {
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      scrollToFulfillment();
      return;
    }
    const quote = refreshQuoteFromSummary();
    const items = quote?.tires || selectedQuote?.tires || [];
    if (!items.length || !(items[0].brand || items[0].size)) {
      setFulfillmentMessage('Choose a tire in the search first, then tap ORDER.', true);
      return;
    }
    setLocalOrderBusy(true, 'SAVING...');
    const totals = totalsFromWidget();
    const qty = Math.max(1, Number(items[0].qty) || 1);
    const unit = Number(items[0].price) || 0;
    try {
      const result = await saveWidgetOrderToAccount({
        customer: {
          name: currentProfile.name || '',
          email: currentProfile.email || '',
          phone: phoneValue(),
        },
        fulfillment: selectedFulfillment(),
        items,
        notes: [
          formatQuoteSummary(quote || selectedQuote),
          fulfillmentNote(),
          'Placed with EastCord ORDER on Price Summary. TireConnect card checkout was not available.',
        ].filter(Boolean).join('\n'),
        vehicle: selectedQuote?.vehicle || {},
        orderNumber: `local-${Date.now()}`,
        recordedLocally: true,
        totals: {
          subtotal: totals.subtotal || unit * qty,
          tax: totals.tax,
          total: totals.total || (totals.subtotal || unit * qty) + (totals.tax || 0),
        },
      });
      if (result?.saved) {
        setLocalOrderBusy(true, 'PLACED');
        return;
      }
      setLocalOrderBusy(false, 'ORDER');
    } catch (error) {
      setLocalOrderBusy(false, 'ORDER');
      setFulfillmentMessage('The order could not be saved. Log in and try ORDER again.', true);
    }
  }

  function normalizeLeadLabel(text) {
    return String(text || '')
      .replace(/\*/g, ' ')
      .replace(/\brequired\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isHiddenLeadLabel(text) {
    const value = normalizeLeadLabel(text);
    if (!value || value.length > 80) return false;
    return /^(first name|last name|email|email address|phone|phone number|preferred method of contact)$/i.test(value)
      || /preferred date and time/i.test(value);
  }

  function isCheckoutSectionHeading(text) {
    const value = normalizeLeadLabel(text);
    return value === 'personal information' || value === 'service details';
  }

  function valueForLeadLabel(text) {
    const value = normalizeLeadLabel(text);
    if (/preferred date and time/.test(value)) {
      return 'Not applicable. EastCord emails the booking link after arrival.';
    }
    if (value === 'preferred method of contact') return 'Email';
    if (!currentProfile) return '';
    const names = splitName(currentProfile.name);
    if (value === 'first name') return names.first_name;
    if (value === 'last name') return names.last_name;
    if (value === 'email' || value === 'email address') return currentProfile.email || '';
    if (value === 'phone' || value === 'phone number') return phoneValue();
    return '';
  }

  function setNativeValue(control, value) {
    if (!control) return;
    if (control.tagName === 'SELECT') {
      const want = String(value).toLowerCase();
      const option = [...control.options].find((item) => (
        String(item.value).toLowerCase() === want
        || String(item.text).toLowerCase().includes(want)
      ));
      if (option) value = option.value;
    }
    const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value');
    if (proto?.set) proto.set.call(control, value);
    else control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillControl(control, labelText) {
    if (!control) return false;
    control.required = false;
    control.removeAttribute('required');
    control.setAttribute('aria-required', 'false');
    const value = valueForLeadLabel(labelText);
    if (!value) return false;
    setNativeValue(control, value);
    return true;
  }

  function hideWidgetNode(node) {
    if (!node || node.id === 'tireconnect') return;
    node.setAttribute('data-eastcord-hide-field', 'true');
    node.setAttribute('hidden', '');
    if (node.style?.setProperty) node.style.setProperty('display', 'none', 'important');
  }

  function controlForLabel(labelEl) {
    const doc = labelEl.ownerDocument || document;
    const htmlFor = labelEl.getAttribute?.('for') || labelEl.htmlFor;
    if (htmlFor) {
      const byId = doc.getElementById(htmlFor);
      if (byId) return byId;
    }
    return labelEl.querySelector?.('input, select, textarea');
  }

  function hideLeadFieldGroup(labelEl) {
    const labelText = String(labelEl.textContent || '').replace(/\s+/g, ' ').trim();
    const alwaysHide = /preferred date and time|preferred method of contact/i.test(normalizeLeadLabel(labelText));
    const labeledControl = controlForLabel(labelEl);
    const filled = fillControl(labeledControl, labelText);
    let node = labeledControl?.parentElement || labelEl;
    for (let i = 0; i < 8 && node && node.id !== 'tireconnect'; i += 1) {
      if (/credit card|cardholder|security code|google pay|g pay/i.test(node.textContent || '')) break;
      const controls = [...(node.querySelectorAll?.('input, select, textarea') || [])];
      if (controls.length === 1) {
        fillControl(controls[0], labelText);
        if (filled || alwaysHide || valueForLeadLabel(labelText)) {
          hideWidgetNode(node);
          if (node !== labelEl) hideWidgetNode(labelEl);
        }
        return;
      }
      node = node.parentElement;
    }
    if ((filled || alwaysHide) && labeledControl) {
      hideWidgetNode(labeledControl);
      hideWidgetNode(labelEl);
    }
  }

  function ensureHideFieldCss(root) {
    const doc = root?.nodeType === 9 ? root : root?.ownerDocument;
    if (!doc?.head || doc.getElementById('eastcord-hide-widget-fields')) return;
    const style = doc.createElement('style');
    style.id = 'eastcord-hide-widget-fields';
    style.textContent = '[data-eastcord-hide-field="true"]{display:none!important}';
    doc.head.appendChild(style);
  }

  function hideWidgetLeadFields(root = document.getElementById('tireconnect')) {
    if (!root || !isWidgetCheckoutPage()) return;
    ensureHideFieldCss(root);
    collectWidgetElements(root).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (el.tagName === 'IFRAME') {
        try {
          if (el.contentDocument) ensureHideFieldCss(el.contentDocument);
        } catch (error) {
          /* cross-origin */
        }
      }
      const isLeaf = ![...el.children].some((child) => (
        isHiddenLeadLabel(child.textContent) || isCheckoutSectionHeading(child.textContent)
      ));
      if (isCheckoutSectionHeading(el.textContent) && isLeaf) {
        hideWidgetNode(el);
        return;
      }
      if (!isHiddenLeadLabel(el.textContent) || !isLeaf) return;
      hideLeadFieldGroup(el);
    });
  }

  function isSelectCtaText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return isOutTheDoorLabel(text) || /^(add to cart|place order)$/i.test(text);
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
    const compact = text.replace(/\s+/g, '').toLowerCase();
    const sizeKey = String(tire.size || '').match(/(\d{3}\s*\/\s*\d{2}\s*R\s*\d{2})/i)?.[1]?.replace(/\s+/g, '').toLowerCase();
    const brand = String(tire.brand || '').replace(/tires?$/i, '').replace(/\s+/g, ' ').trim();
    if (!sizeKey || !brand || brand.length < 3) return false;
    if (!compact.includes(sizeKey)) return false;
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?:^|[^A-Za-z])${escaped}(?:$|[^A-Za-z])`, 'i').test(text);
  }

  function isFullTireCard(el) {
    if (!el || el.nodeType !== 1) return false;
    const text = String(el.innerText || '').replace(/\s+/g, ' ').toLowerCase();
    const ctaCount = (text.match(/add to cart|place order|see out/g) || []).length;
    if (ctaCount !== 1) return false;
    if (!/per tire/.test(text)) return false;
    return /\d{3}\s*\/\s*\d{2}\s*r\s*\d{2}/.test(text);
  }

  function quoteFromCard(card) {
    if (!card) return null;
    const text = String(card.innerText || '');
    const sizeRaw = text.match(/(\d{3}\s*\/\s*\d{2}\s*R\s*\d{2})/i)?.[1] || '';
    const size = sizeRaw.replace(/\s+/g, '');
    const known = TIRE_BRANDS.find((name) => new RegExp(name.replace(/\s+/g, '\\s*'), 'i').test(text));
    const skip = /add to compare|size:|warranty|qty|per tire|add to cart|place order|specs|features|performance|all season|all weather|summer|winter|n\/a|km|see out/i;
    const brand = known || String(text).split(/\n/).map((line) => line.trim()).find((line) => (
      line
      && !skip.test(line)
      && !/\d{3}\/\d{2}/.test(line)
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
        if (rect.width >= 200 && rect.height >= 360 && rect.height <= 1600 && rect.width <= 640) {
          fallback = el;
        }
      }
      if (el === root) break;
      el = el.parentElement || el.getRootNode?.()?.host;
    }
    return fallback;
  }

  function applyCardHighlightStyles(card) {
    if (!card || !isFullTireCard(card)) return;
    card.setAttribute('data-eastcord-tire-card', 'true');
    card.classList?.add('eastcord-tire-card-selected');
    card.style.setProperty('border', '4px solid #df1f2d', 'important');
    card.style.setProperty('box-shadow', '0 0 0 6px rgba(223, 31, 45, 0.22)', 'important');
    card.style.setProperty('background-color', '#fff5f5', 'important');
    card.style.setProperty('outline', '4px solid #df1f2d', 'important');
    card.style.setProperty('outline-offset', '2px', 'important');
    card.style.setProperty('border-radius', '12px', 'important');
  }

  function clearCardHighlightStyles(card) {
    if (!card) return;
    card.removeAttribute('data-eastcord-tire-card');
    card.classList?.remove('eastcord-tire-card-selected');
    ['border', 'box-shadow', 'background-color', 'outline', 'outline-offset', 'border-radius'].forEach((prop) => {
      card.style.removeProperty(prop);
    });
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
    const overlay = document.getElementById('eastcord-tire-highlight');
    if (overlay) overlay.hidden = true;
    highlightedCard = null;
    const root = document.getElementById('tireconnect');
    collectWidgetElements(root).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (el.getAttribute?.('data-eastcord-tire-card') === 'true') clearCardHighlightStyles(el);
    });
  }

  function placeHighlightOverlay(card) {
    const overlay = ensureHighlightOverlay();
    if (!card?.isConnected || !card.getBoundingClientRect) {
      overlay.hidden = true;
      return;
    }
    const rect = card.getBoundingClientRect();
    applyCardHighlightStyles(card);
    if (rect.width < 160 || rect.height < 200) {
      overlay.hidden = true;
      return;
    }
    highlightedCard = card;
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
    const buttons = findSelectButtons(root);
    buttons.forEach((button) => {
      const card = visualCardFrom(button);
      if (!card || seen.has(card) || !isFullTireCard(card)) return;
      if (!selectedQuote.tires.some((tire) => cardMatchesTire(card, tire))) return;
      seen.add(card);
      matches.push(card);
    });
    if (matches.length > 1 && matches.length >= Math.max(2, buttons.length - 1)) return [];
    const clicked = lastClickedCard?.isConnected ? visualCardFrom(lastClickedCard) : null;
    if (clicked && matches.includes(clicked)) return [clicked];
    if (matches.length > 1) return [matches[0]];
    return matches;
  }

  function highlightSelectedWidgetTires() {
    syncSummaryLayout();
    const onResults = findSelectButtons(document.getElementById('tireconnect')).length > 0;
    if (!onResults && (isWidgetSummaryPage() || isWidgetCheckoutPage())) {
      hideHighlightOverlay();
      return;
    }
    const matches = findMatchingCards();
    const root = document.getElementById('tireconnect');
    collectWidgetElements(root).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (el.getAttribute?.('data-eastcord-tire-card') === 'true' && !matches.includes(el)) {
        clearCardHighlightStyles(el);
      }
    });
    if (!matches.length) {
      const overlay = document.getElementById('eastcord-tire-highlight');
      if (overlay) overlay.hidden = true;
      highlightedCard = null;
      return;
    }
    matches.forEach(applyCardHighlightStyles);
    const visible = matches.find((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > 90 && rect.top < window.innerHeight - 20;
    }) || matches[0];
    placeHighlightOverlay(visible);
  }

  function bindWidgetHighlightClicks() {
    if (document.body.dataset.eastcordHighlightBound === 'true') return;
    document.body.dataset.eastcordHighlightBound = 'true';
    document.addEventListener('click', (event) => {
      const root = document.getElementById('tireconnect');
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
      if (root && !path.includes(root) && !root.contains(event.target)) return;
      const cta = path.find((node) => node && node.nodeType === 1 && isSelectCtaText(node.textContent || node.value));
      if (!cta) return;
      const card = visualCardFrom(cta);
      lastClickedCard = card;
      const quote = quoteFromCard(card);
      if (quote) applyCapturedQuote(quote, { replace: true, scroll: false });
      placeHighlightOverlay(card);
      window.setTimeout(highlightSelectedWidgetTires, 30);
      window.setTimeout(highlightSelectedWidgetTires, 200);
      window.setTimeout(highlightSelectedWidgetTires, 600);
    }, true);
    window.addEventListener('scroll', () => {
      if (highlightedCard) placeHighlightOverlay(highlightedCard);
    }, true);
    window.addEventListener('resize', () => {
      if (highlightedCard) placeHighlightOverlay(highlightedCard);
    });
  }

  function quoteFromWidget() {
    const text = widgetPlainText();
    if (!text.trim()) return null;
    const onQuotePage = /PRICE SUMMARY|CHANGE TIRE|PER TIRE/i.test(text)
      || /summary|quote/i.test(window.location.hash || '');
    if (!onQuotePage) return null;
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const size = text.match(/(\d{3}\/\d{2}R\d{2}[A-Za-z0-9]*)/)?.[1] || '';
    const brand = TIRE_BRANDS.find((name) => new RegExp(name.replace(/\s+/g, '\\s*'), 'i').test(text)) || '';
    const skip = /price summary|change tire|revise search|per tire|see out|add to cart|place order|qty|warranty|category|add to compare|recommended|specs|features|reviews|sub-total|taxes|total price|touring|performance|winter|summer|all season|powered by|tireconnect|search by|in stock|load more|sort by|best match/i;
    const model = lines.find((line) => {
      if (skip.test(line) || isWidgetChrome(line)) return false;
      if (brand && line.toLowerCase() === brand.toLowerCase()) return false;
      if (size && line.replace(/\s+/g, '').includes(size.replace(/\s+/g, ''))) return false;
      if (line.length < 4 || line.length > 70) return false;
      return /[A-Za-z]/.test(line);
    }) || '';
    if (!brand && !model && !size) return null;
    return {
      tires: [{ brand: cleanTireField(brand), model: cleanTireField(model), size, qty: 4, price: 0, partNumber: '' }],
      vehicle: {},
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
    const size = raw.match(/(\d{3}\/\d{2}R\d{2}[A-Za-z0-9]*)/i)?.[1] || sizeFromParts;
    const encodedId = raw.match(/tire_ids(?:\[|%5B)0(?:\]|%5D)=([^&]+)/i)?.[1] || '';
    const decoded = decodeTireId(encodedId);
    const isSummary = /summary|quote/i.test(raw);
    if (!size && !decoded.brand && !isSummary) return null;
    return {
      tires: [{
        brand: cleanTireField(decoded.brand),
        model: cleanTireField(decoded.model),
        size,
        qty: qty || 4,
        price: 0,
        partNumber: decoded.partNumber || '',
      }],
      vehicle: {},
      hash: window.location.hash || '',
    };
  }

  function hasCapturedTire(quote = selectedQuote) {
    const tire = quote?.tires?.[0];
    if (!tire) return false;
    return Boolean(tire.brand || tire.model || tire.size);
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
      return 'Tap Place Order on the tires you want. We copy the brand and size for you.';
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
        ['Brand', tire.brand],
        ['Model', tire.model],
        ['Size', tire.size],
        ['Quantity', tire.qty ? String(tire.qty) : ''],
        ['Price each', money(tire.price)],
      ].filter(([, value]) => value);
      return rows.map(([label, value]) => (
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
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
    const installNote = document.querySelector('[data-new-tire-install-note]');
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
    if (installNote) installNote.hidden = selectedFulfillment() !== 'Installation';
    const needsPhone = signedIn && !String(currentProfile?.phone || '').trim();
    if (phoneField) phoneField.hidden = !needsPhone;
    if (phoneInput) {
      phoneInput.required = needsPhone;
      if (!needsPhone) phoneInput.value = currentProfile?.phone || '';
    }
    updateAuthLinks();
    highlightSelectedWidgetTires();
    injectEastCordOrderButton();
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
    return selectedFulfillment() === 'Installation'
      ? 'EastCord fulfillment: Installation after tires arrive. Do not book now. Booking link: https://eastcordtires.ca/appointment'
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
    } catch (error) {
      /* widget may not be ready yet */
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
      ? 'Order placed. When your tires arrive, we will email you a link to book installation. You do not need to book now.'
      : 'Order placed. We will email you when your tires are ready for pickup. No appointment is needed.';
  }

  function memberGate() {
    if (!currentProfile) {
      return {
        ok: false,
        message: 'Please log in or create an account first. Then tap ORDER.',
      };
    }
    if (!phoneValue()) {
      return { ok: false, message: 'Please enter a phone number, then tap ORDER.' };
    }
    return { ok: true };
  }

  function captureQuoteFromWidgetEvent(event, { replace = true, allowScrape = false } = {}) {
    const quote = quoteFromWidgetPayload(event);
    if (quote) applyCapturedQuote(quote, { replace, allowScrape, scroll: false });
    return quote;
  }

  async function notifyCompanyFromWidgetOrder(event) {
    const data = eventPayload(event);
    const status = String(data.status || data.order_status || '').toLowerCase();
    resolveWidgetEvent(event);
    if (status && status !== 'submitted') return;
    captureQuoteFromWidgetEvent(event);
    const customer = customerFromWidgetPayload(event);
    const items = selectedQuote?.tires?.length
      ? selectedQuote.tires
      : quoteFromWidgetPayload(event)?.tires || [];
    if (!customer.email || !customer.phone || !customer.name) {
      setFulfillmentMessage('Payment went through in the tire search. Log in so EastCord can save this order to your account.', true);
      return;
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
    await saveWidgetOrderToAccount({
      customer,
      fulfillment: selectedFulfillment(),
      items,
      notes: [
        formatQuoteSummary(selectedQuote) || fulfillmentNote(),
        addressLine ? `Address: ${addressLine}` : '',
        widgetCustomer.notes ? `Widget notes: ${widgetCustomer.notes}` : '',
        'Do not book installation yet. Email https://eastcordtires.ca/appointment after the tires arrive.',
      ].filter(Boolean).join('\n'),
      vehicle: selectedQuote?.vehicle || nested.vehicle || {},
      orderNumber: String(data.order_number || nested.order_number || ''),
      totals: {
        subtotal: nested.subtotal ?? data.subtotal ?? scrapedTotals.subtotal,
        tax: nested.total_tax ?? data.total_tax ?? scrapedTotals.tax,
        total: nested.total_price ?? data.total_price ?? scrapedTotals.total,
        deposit: data.deposit_payment,
        outstanding: data.outstanding_balance,
      },
    });
  }

  async function saveWidgetOrderToAccount(payload) {
    const key = orderNotifyKey(payload);
    if (key && key === lastNotifiedOrderKey) return { saved: true, duplicate: true };

    try {
      const token = await window.EastCordAccount?.getAccessToken?.();
      const response = await fetch('/.netlify/functions/save-new-tire-widget-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFulfillmentMessage(
          data.message
            || (payload.recordedLocally
              ? 'The order could not be saved to your account. Log in and try ORDER again.'
              : 'Payment went through in the tire search. EastCord still needs to save this order to your account.'),
          true,
        );
        return { saved: false };
      }
      lastNotifiedOrderKey = key;
      setFulfillmentMessage(successMessage(payload.fulfillment), false);
      try {
        sessionStorage.removeItem(QUOTE_STORAGE_KEY);
      } catch (error) {
        /* ignore */
      }
      return { saved: true };
    } catch (error) {
      setFulfillmentMessage(
        payload.recordedLocally
          ? 'The order could not be saved. Log in and try ORDER again.'
          : 'Payment went through in the tire search. If it does not appear on My Account, contact info@eastcordtires.ca.',
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

    target.on('onTireSelect', (event) => {
      applyCapturedQuote(quoteFromSelectEvent(eventPayload(event)), { replace: true });
      window.setTimeout(highlightSelectedWidgetTires, 50);
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
    target.on('onSummaryInitiated', (event) => {
      applyCapturedQuote(quoteFromWidgetPayload(event) || quoteFromSelectEvent(eventPayload(event)), { allowScrape: true });
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
    target.on('onPageChanged', (event) => {
      const page = String(eventPayload(event).page || event?.page || '');
      if (/summary|quote|order/i.test(page)) {
        applyCapturedQuote(quoteFromHash() || selectedQuote, { allowScrape: true });
        pushCustomerIntoWidget();
      }
      syncSummaryLayout();
      window.setTimeout(hideWidgetLeadFields, 80);
      resolveWidgetEvent(event);
    });
    target.on('onResultsReviseClick', (event) => {
      didAutoScroll = false;
      resolveWidgetEvent(event);
    });
    target.on('onResultsReviseClicked', (event) => {
      didAutoScroll = false;
      resolveWidgetEvent(event);
    });
    target.on('onAppointmentClick', (event) => {
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      window.setTimeout(hideWidgetLeadFields, 80);
      resolveWidgetEvent(event);
    });
    const handleOrderClick = (event) => {
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    };
    target.on('onEcommerceOrderClick', handleOrderClick);
    target.on('onOrderClick', handleOrderClick);
    target.on('onOrderInitiated', (event) => {
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      window.setTimeout(hideWidgetLeadFields, 80);
      resolveWidgetEvent(event);
    });
    target.on('onEcommerceOrder', (event) => {
      const status = String(eventPayload(event).status || '').toLowerCase();
      captureQuoteFromWidgetEvent(event);
      if (status === 'submitted') {
        notifyCompanyFromWidgetOrder(event);
        return;
      }
      pushCustomerIntoWidget();
      resolveWidgetEvent(event);
    });
    target.on('onOrderSubmitted', notifyCompanyFromWidgetOrder);
    target.on('onLead', (event) => {
      captureQuoteFromWidgetEvent(event);
      pushCustomerIntoWidget();
      window.setTimeout(hideWidgetLeadFields, 80);
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
      if (isWidgetSummaryPage() && /^place order$/i.test(text)) return false;
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
    const gate = memberGate();
    if (!gate.ok) {
      setFulfillmentMessage(gate.message, true);
      syncFulfillmentUi();
      return;
    }
    pushCustomerIntoWidget();
    hideWidgetLeadFields();
  }

  function initTireConnect() {
    const config = window.EASTCORD_TIRECONNECT_CONFIG || {};
    const apiKey = String(config.apiKey || '').trim();
    const container = document.getElementById('tireconnect');

    if (!container || !apiKey) {
      showFallback();
      return;
    }

    if (!window.TCWidget || typeof window.TCWidget.init !== 'function') {
      console.error('[EastCord TireConnect] TireConnect widget script did not load.');
      showFallback();
      return;
    }

    try {
      bindWidgetEvents(window.TCWidget);
      const initialized = window.TCWidget.init({
        apikey: apiKey,
        container: 'tireconnect',
      });
      if (initialized && typeof initialized.then === 'function') {
        initialized.then((widget) => {
          rememberWidget(widget);
          bindWidgetEvents(widget);
          pushCustomerIntoWidget();
          relabelWidgetButtons();
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

  function bindPage() {
    document.querySelector('[data-new-tire-fulfillment-form]')?.addEventListener('change', (event) => {
      if (event.target.name !== 'Fulfillment Preference') return;
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
      syncFulfillmentUi();
      pushCustomerIntoWidget();
    });
    window.addEventListener('hashchange', () => {
      applyCapturedQuote(quoteFromHash() || quoteFromWidget(), { scroll: /summary|quote/i.test(window.location.hash) });
    });
    const widget = document.getElementById('tireconnect');
    if (widget && typeof MutationObserver === 'function') {
      let timer = 0;
      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          relabelWidgetButtons();
          const scraped = quoteFromWidget();
          if (scraped && !hasCapturedTire()) applyCapturedQuote(scraped, { scroll: false });
        }, 50);
      });
      observer.observe(widget, { childList: true, subtree: true, characterData: true });
      widget.addEventListener('load', relabelWidgetButtons, true);
      let pulses = 0;
      const pulse = window.setInterval(() => {
        relabelWidgetButtons();
        pulses += 1;
        if (pulses >= 40) window.clearInterval(pulse);
      }, 400);
    }
    relabelWidgetButtons();
    bindWidgetHighlightClicks();
    window.addEventListener('message', (event) => {
      if (!/tireconnect/i.test(String(event.origin || ''))) return;
      const quote = quoteFromSelectEvent(eventPayload(event.data));
      if (quote) applyCapturedQuote(quote);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    bindPage();
    initTireConnect();
    refreshProfile();
    applyCapturedQuote(selectedQuote || quoteFromHash(), { scroll: false });
  });
})();
