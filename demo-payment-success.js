const DEMO_SALE_KEY = 'eastcord_demo_used_tire_sale_v1';
const DEMO_RESULT_KEY = 'eastcord_demo_payment_result_v1';

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

function readResult() {
  try {
    return JSON.parse(sessionStorage.getItem(DEMO_RESULT_KEY) || 'null');
  } catch (error) {
    return null;
  }
}

function emailStatusText(result) {
  const email = result?.email || {};
  if (email.ok) {
    return `A receipt was emailed to ${result.customer?.email || 'you'}.`;
  }
  if (email.reason === 'missing_resend_api_key') {
    return 'The receipt could not be emailed: RESEND_API_KEY is missing in local environment variables. Add the same Resend key used for appointment emails, then restart npm run dev.';
  }
  if (email.reason) {
    return `The receipt could not be emailed (${email.reason}).`;
  }
  return 'The receipt email was not sent.';
}

function sheetStatusText(sheet) {
  if (!sheet) return '';
  if (sheet.ok && sheet.updated?.length) {
    return {
      className: 'tire-cart-message demo-sheet-ok',
      text: `Google Sheet updated: ${sheet.updated.map((row) => `${row.field} ${row.from} → ${row.to}`).join('; ')}.`,
    };
  }
  if (sheet.error) {
    return {
      className: 'tire-cart-message demo-sheet-fail',
      text: `Website stock changed, but the Google Sheet did not: ${sheet.error}. Share the sheet as Editor, then restore and try again.`,
    };
  }
  if (sheet.skipped?.length) {
    return {
      className: 'tire-cart-message demo-sheet-fail',
      text: `Website stock changed, but a sheet row was skipped: ${sheet.skipped.map((row) => row.reason).join(' ')}`,
    };
  }
  return { className: 'tire-cart-message', text: 'No Google Sheet rows were changed.' };
}

function renderReceipt(result) {
  const box = document.querySelector('[data-demo-receipt]');
  if (!box) return;
  const items = Array.isArray(result.items) ? result.items : [];
  const totals = result.totals || {};
  const stock = (result.websiteUpdates || []).map((row) => (
    `<li>${escapeHtml(row.brand || 'Tire')} ${escapeHtml(row.tireSize || '')}: stock ${row.from} → ${row.to}</li>`
  )).join('');
  box.innerHTML = `
    <h2>Receipt</h2>
    <ul class="demo-result-list">
      ${items.map((item) => `<li>${escapeHtml(item.qty)} x ${escapeHtml(item.brand || 'Used tire')} ${escapeHtml(item.size || '')} — ${escapeHtml(formatMoney((Number(item.unitPrice) || 0) * (Number(item.qty) || 0)))}</li>`).join('')}
    </ul>
    <p>
      Subtotal ${escapeHtml(formatMoney(totals.subtotal))}<br />
      HST 13% ${escapeHtml(formatMoney(totals.hstAmount))}<br />
      <strong>Total ${escapeHtml(formatMoney(totals.totalWithHst))}</strong>
    </p>
    ${stock ? `<p><strong>Inventory</strong></p><ul class="demo-result-list">${stock}</ul>` : ''}
  `;
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
    const status = document.querySelector('[data-demo-sheet-status]');
    if (status) status.textContent = 'Nothing to restore.';
    return;
  }
  try {
    if (button) {
      button.disabled = true;
      button.textContent = 'Restoring...';
    }
    const response = await fetch('/.netlify/functions/demo-used-tire-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: stored, restore: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Restore failed.');
    sessionStorage.removeItem(DEMO_SALE_KEY);
    const thanks = document.querySelector('[data-demo-thanks]');
    if (thanks) thanks.textContent = 'Stock was put back on the website.';
    const sheet = sheetStatusText(data.sheet);
    const sheetEl = document.querySelector('[data-demo-sheet-status]');
    if (sheetEl && sheet) {
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

function init() {
  const result = readResult();
  const thanks = document.querySelector('[data-demo-thanks]');
  const emailEl = document.querySelector('[data-demo-email-status]');
  if (!result) {
    if (thanks) thanks.textContent = 'No demo payment was found. Complete a demo sale from the tire cart first.';
    const restore = document.querySelector('[data-demo-restore]');
    if (restore) restore.hidden = true;
    return;
  }
  if (thanks && result.customer?.name) {
    thanks.textContent = `Thank you, ${result.customer.name}. Your demo payment was received. No real card was charged.`;
  }
  if (emailEl) emailEl.textContent = emailStatusText(result);
  renderReceipt(result);
  const sheet = sheetStatusText(result.sheet);
  const sheetEl = document.querySelector('[data-demo-sheet-status]');
  if (sheetEl && sheet) {
    sheetEl.className = sheet.className;
    sheetEl.textContent = sheet.text;
  }
  document.querySelector('[data-demo-restore]')?.addEventListener('click', restoreStock);
}

document.addEventListener('DOMContentLoaded', init);
