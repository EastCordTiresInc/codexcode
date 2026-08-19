const USED_TIRE_CART_KEY = 'eastcord_used_tire_cart_v1';
const DEMO_SALE_KEY = 'eastcord_demo_used_tire_sale_v1';
const DEMO_RESULT_KEY = 'eastcord_demo_payment_result_v1';
const TAX_RATE = 0.13;

function formatMoney(value) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getTotals(items) {
  const subtotal = roundMoney(items.reduce(
    (total, item) => total + ((Number(item.unitPrice) || 0) * (Number(item.qty) || 0)),
    0,
  ));
  const hstAmount = roundMoney(subtotal * TAX_RATE);
  return { subtotal, hstAmount, totalWithHst: roundMoney(subtotal + hstAmount) };
}

function normalizeCart(items) {
  if (window.EastCordAccount?.normalizeUsedTireCartItems) {
    return window.EastCordAccount.normalizeUsedTireCartItems(items);
  }
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const inventoryId = String(item?.inventoryId || item?.inventory_id || item?.id || '')
      .replace(/^used-tire-/i, '')
      .trim();
    if (!inventoryId) return null;
    return {
      ...item,
      inventoryId,
      qty: Math.max(1, Number(item.qty) || 1),
      brand: item.brand || '',
      size: item.size || item.tire_size || '',
      unitPrice: Number(item.unitPrice || item.selling_price || 0),
    };
  }).filter(Boolean);
}

function readCart() {
  try {
    return normalizeCart(JSON.parse(localStorage.getItem(USED_TIRE_CART_KEY) || '[]'));
  } catch (error) {
    return [];
  }
}

function clearCart() {
  localStorage.removeItem(USED_TIRE_CART_KEY);
  window.EastCordAccount?.clearCustomerCart?.('used_tire').catch(() => {});
  window.EastCordAccount?.updateCartCount?.();
}

function setMessage(text) {
  const el = document.querySelector('[data-demo-message]');
  if (el) el.textContent = text || '';
}

function renderCart(items) {
  const list = document.querySelector('[data-demo-items]');
  const empty = document.querySelector('[data-demo-empty]');
  const totals = getTotals(items);
  if (list) {
    list.innerHTML = items.length
      ? items.map((item) => (
        `<article class="tire-cart-item"><div><h3>${escapeHtml(item.brand || 'Used tire')} ${escapeHtml(item.size || '')}</h3><p>Qty ${escapeHtml(item.qty)} · ID ${escapeHtml(item.inventoryId)}</p></div><strong>${escapeHtml(formatMoney((Number(item.unitPrice) || 0) * (Number(item.qty) || 0)))}</strong></article>`
      )).join('')
      : '';
  }
  if (empty) empty.hidden = items.length > 0;
  const subtotalEl = document.querySelector('[data-demo-subtotal]');
  const hstEl = document.querySelector('[data-demo-hst]');
  const totalEl = document.querySelector('[data-demo-total]');
  if (subtotalEl) subtotalEl.textContent = formatMoney(totals.subtotal);
  if (hstEl) hstEl.textContent = formatMoney(totals.hstAmount);
  if (totalEl) totalEl.textContent = formatMoney(totals.totalWithHst);
}

function sheetStatusText(sheet) {
  if (sheet?.ok && sheet.updated?.length) {
    return {
      className: 'tire-cart-message demo-sheet-ok',
      text: `Google Sheet updated: ${sheet.updated.map((row) => `${row.field} ${row.from} → ${row.to}`).join('; ')}.`,
    };
  }
  if (sheet?.error) {
    return {
      className: 'tire-cart-message demo-sheet-fail',
      text: `Website stock changed, but the Google Sheet did not: ${sheet.error}. Share the inventory sheet with the service-account email as Editor, then restore and try again.`,
    };
  }
  if (sheet?.skipped?.length) {
    return {
      className: 'tire-cart-message demo-sheet-fail',
      text: `Website stock changed, but a sheet row was skipped: ${sheet.skipped.map((row) => row.reason).join(' ')}`,
    };
  }
  return {
    className: 'tire-cart-message demo-sheet-fail',
    text: 'Google Sheet was not updated.',
  };
}

function showThankYou(result, items) {
  const checkout = document.querySelector('[data-demo-checkout]');
  const thanks = document.querySelector('[data-demo-thanks]');
  if (checkout) checkout.hidden = true;
  if (thanks) thanks.hidden = false;
  const copy = document.querySelector('[data-demo-thanks-copy]');
  if (copy) {
    copy.textContent = result.customer?.name
      ? `Thank you, ${result.customer.name}. Your demo sale was recorded. No real card was charged.`
      : 'Thank you. Your demo sale was recorded. No real card was charged.';
  }
  const emailEl = document.querySelector('[data-demo-email-status]');
  if (emailEl) {
    if (result.email?.ok) {
      emailEl.textContent = `A receipt was emailed to ${result.customer?.email || 'you'}.`;
    } else if (result.email?.reason === 'missing_resend_api_key') {
      emailEl.textContent = 'Receipt email was not sent because RESEND_API_KEY is missing locally.';
    } else {
      emailEl.textContent = `Receipt email was not sent${result.email?.reason ? ` (${result.email.reason})` : ''}.`;
    }
  }
  const receipt = document.querySelector('[data-demo-receipt]');
  const totals = getTotals(items);
  if (receipt) {
    receipt.innerHTML = `
      <ul class="demo-result-list">
        ${(result.websiteUpdates || []).map((row) => (
          `<li>${escapeHtml(row.brand || 'Tire')} ${escapeHtml(row.tireSize || '')}: website stock ${row.from} → ${row.to}</li>`
        )).join('')}
      </ul>
      <p><strong>Total ${escapeHtml(formatMoney(totals.totalWithHst))}</strong></p>
    `;
  }
  const sheet = sheetStatusText(result.sheet);
  const sheetEl = document.querySelector('[data-demo-sheet-status]');
  if (sheetEl) {
    sheetEl.className = sheet.className;
    sheetEl.textContent = sheet.text;
  }
}

async function postSale(body) {
  const response = await fetch('/.netlify/functions/demo-used-tire-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Demo payment failed (${response.status}).`);
  }
  return data;
}

async function loadFallbackItem() {
  const response = await fetch('/.netlify/functions/get-used-inventory');
  const rows = await response.json().catch(() => []);
  if (!Array.isArray(rows)) return [];
  const row = rows.find((item) => Number(item.current_stock) > 0) || rows[0];
  if (!row) return [];
  return [{
    inventoryId: String(row.id),
    brand: row.brand || '',
    size: row.size_label || row.tire_size || '',
    qty: 1,
    unitPrice: Number(row.selling_price) || 0,
  }];
}

async function confirmSale() {
  const form = document.querySelector('[data-demo-form]');
  const submit = document.querySelector('[data-demo-submit]');
  let items = readCart();
  if (!items.length) {
    setMessage('Cart was empty, loading one in-stock tire for the demo...');
    items = await loadFallbackItem();
    renderCart(items);
  }
  if (!items.length) {
    setMessage('No used tires are available to demo.');
    return;
  }
  const customer = {
    name: String(form?.elements?.namedItem('name')?.value || 'Test Customer').trim(),
    email: String(form?.elements?.namedItem('email')?.value || '').trim(),
    phone: String(form?.elements?.namedItem('phone')?.value || '').trim(),
  };
  if (!customer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    setMessage('Enter a valid email address, then click Confirm demo sale.');
    form?.elements?.namedItem('email')?.focus();
    return;
  }
  try {
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Recording demo sale...';
    }
    setMessage('Updating website stock and Google Sheet...');
    const result = await postSale({ items, customer, restore: false });
    sessionStorage.setItem(DEMO_SALE_KEY, JSON.stringify(items));
    sessionStorage.setItem(DEMO_RESULT_KEY, JSON.stringify({
      ...result,
      items,
      totals: getTotals(items),
    }));
    clearCart();
    renderCart([]);
    showThankYou(result, items);
    setMessage('');
  } catch (error) {
    setMessage(error.message || 'Demo payment failed.');
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Confirm demo sale';
    }
  }
}

async function restoreStock() {
  const button = document.querySelector('[data-demo-restore]');
  let stored = [];
  try {
    stored = JSON.parse(sessionStorage.getItem(DEMO_SALE_KEY) || '[]');
  } catch (error) {
    stored = [];
  }
  if (!stored.length) {
    setMessage('Nothing to restore.');
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Restoring...';
    }
    const result = await postSale({ items: stored, restore: true });
    sessionStorage.removeItem(DEMO_SALE_KEY);
    const copy = document.querySelector('[data-demo-thanks-copy]');
    if (copy) copy.textContent = 'Stock was put back on the website.';
    const sheet = sheetStatusText(result.sheet);
    const sheetEl = document.querySelector('[data-demo-sheet-status]');
    if (sheetEl) {
      sheetEl.className = sheet.className;
      sheetEl.textContent = sheet.text;
    }
    if (button) button.textContent = 'Stock restored';
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = 'Restore stock';
    }
    const sheetEl = document.querySelector('[data-demo-sheet-status]');
    if (sheetEl) {
      sheetEl.className = 'tire-cart-message demo-sheet-fail';
      sheetEl.textContent = error.message || 'Restore failed.';
    }
  }
}

async function init() {
  let items = readCart();
  if (!items.length) {
    setMessage('No cart items found. Loading one in-stock tire so you can still test.');
    items = await loadFallbackItem();
  }
  renderCart(items);
  document.querySelector('[data-demo-submit]')?.addEventListener('click', (event) => {
    event.preventDefault();
    confirmSale();
  });
  document.querySelector('[data-demo-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    confirmSale();
  });
  document.querySelector('[data-demo-restore]')?.addEventListener('click', restoreStock);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
