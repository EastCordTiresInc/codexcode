const { calculateTax, roundMoney } = require('./used-tire-order');
const { ACCOUNT_URL, WARRANTY_URL, escapeHtml, buildBrandedEmail } = require('./send-email');

function formatMoney(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

function getReceiptItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const unitPrice = roundMoney(item.unitPrice || item.selling_price || 0);
    return {
      inventoryId: String(item.inventoryId || item.id || ''),
      brand: String(item.brand || 'Used tire').trim() || 'Used tire',
      size: String(item.size || item.tire_size || '').trim(),
      qty,
      unitPrice,
      lineTotal: roundMoney(unitPrice * qty),
    };
  });
}

function getReceiptTotals(items) {
  const lines = getReceiptItems(items);
  const subtotal = roundMoney(lines.reduce((total, item) => total + item.lineTotal, 0));
  return { lines, ...calculateTax(subtotal) };
}

function buildUsedTireReceipt({ customer, items, demo = false, websiteUpdates = [] }) {
  const name = String(customer?.name || 'Customer').trim() || 'Customer';
  const totals = getReceiptTotals(items);
  const stockLines = (websiteUpdates || []).map((row) => (
    `${row.brand || 'Tire'} ${row.tireSize || ''}: stock ${row.from} → ${row.to}`
  ));
  const itemText = totals.lines.map((item) => (
    `${item.qty} x ${item.brand} ${item.size} @ ${formatMoney(item.unitPrice)} = ${formatMoney(item.lineTotal)}`
  )).join('\n');
  const itemHtml = totals.lines.map((item) => (
    `<tr><td style="padding:6px 0;">${escapeHtml(item.qty)} x ${escapeHtml(item.brand)} ${escapeHtml(item.size)}</td><td style="padding:6px 0;text-align:right;">${escapeHtml(formatMoney(item.lineTotal))}</td></tr>`
  )).join('');

  const demoNote = demo
    ? '\nThis was a local demo payment. No real card was charged.\n'
    : '';

  const branded = buildBrandedEmail({
    to: customer?.email || '',
    subject: demo
      ? 'EastCord Tires demo receipt — used tires'
      : 'EastCord Tires receipt — used tires',
    heading: 'Thank you for your payment',
    body: [
      `Hello ${name},`,
      demo
        ? 'This is a demo receipt from EastCord Tires. No real card was charged.'
        : 'Your used tire payment was received at EastCord Tires in Milton.',
      'If you chose pickup, we will confirm when your order is ready. If you chose installation, wait until the tires arrive. We will send a booking link then.',
    ],
    actionUrl: ACCOUNT_URL,
    actionLabel: 'View your account',
    extraText: [
      demoNote,
      'Receipt',
      itemText,
      `Subtotal: ${formatMoney(totals.subtotal)}`,
      `Total: ${formatMoney(totals.totalWithHst)}`,
      stockLines.length ? `Inventory update:\n${stockLines.join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    extraHtml: `
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">${itemHtml}</table>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111317;">
        <strong>Subtotal:</strong> ${escapeHtml(formatMoney(totals.subtotal))}<br />
        <strong>Total:</strong> ${escapeHtml(formatMoney(totals.totalWithHst))}
      </p>
      ${stockLines.length ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4b5563;"><strong>Inventory update</strong><br />${stockLines.map(escapeHtml).join('<br />')}</p>` : ''}
      <p style="margin:0 0 16px;font-size:14px;"><a href="${WARRANTY_URL}" style="color:#ba151b;font-weight:700;">Used Tire Warranty Policy</a></p>
    `,
  });

  return {
    ...branded,
    totals,
  };
}

module.exports = {
  getReceiptItems,
  getReceiptTotals,
  buildUsedTireReceipt,
};
