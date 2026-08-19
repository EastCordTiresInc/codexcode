const { calculateTax, roundMoney } = require('./used-tire-order');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

  return {
    subject: demo
      ? 'EastCord Tires demo receipt — used tires'
      : 'EastCord Tires receipt — used tires',
    text: [
      `Hello ${name},`,
      '',
      demo
        ? 'Thank you for completing the EastCord Tires demo payment.'
        : 'Thank you for your used tire payment.',
      demoNote,
      'Receipt',
      itemText,
      `Subtotal: ${formatMoney(totals.subtotal)}`,
      `HST 13%: ${formatMoney(totals.hstAmount)}`,
      `Total: ${formatMoney(totals.totalWithHst)}`,
      stockLines.length ? `\nInventory update:\n${stockLines.join('\n')}` : '',
      '',
      'EastCord Tires will confirm pickup or installation.',
      'info@eastcordtires.ca · 365-822-5553',
    ].filter((line) => line !== undefined).join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;">
        <h2>Thank you for your payment</h2>
        <p>Hello ${escapeHtml(name)},</p>
        <p>${demo
    ? 'This is a <strong>demo receipt</strong> from EastCord Tires. No real card was charged.'
    : 'Your used tire payment was received.'}</p>
        <table style="width:100%;border-collapse:collapse;">${itemHtml}</table>
        <p>
          <strong>Subtotal:</strong> ${escapeHtml(formatMoney(totals.subtotal))}<br />
          <strong>HST 13%:</strong> ${escapeHtml(formatMoney(totals.hstAmount))}<br />
          <strong>Total:</strong> ${escapeHtml(formatMoney(totals.totalWithHst))}
        </p>
        ${stockLines.length ? `<p><strong>Inventory update</strong><br />${stockLines.map(escapeHtml).join('<br />')}</p>` : ''}
        <p>EastCord Tires will confirm pickup or installation.<br />info@eastcordtires.ca · 365-822-5553</p>
      </div>
    `,
    totals,
  };
}

module.exports = {
  getReceiptItems,
  getReceiptTotals,
  buildUsedTireReceipt,
};
