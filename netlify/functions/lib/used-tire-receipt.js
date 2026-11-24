const { calculateTax, roundMoney } = require('./used-tire-order');
const { ACCOUNT_URL, WARRANTY_URL, escapeHtml, buildBrandedEmail } = require('./send-email');

function formatMoney(value) {
  return `$${roundMoney(value).toFixed(2)}`;
}

function getReceiptItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const unitPrice = roundMoney(item.unitPrice || item.selling_price || 0);
    const storedTotal = Number(item.lineTotal);
    return {
      inventoryId: String(item.inventoryId || item.id || ''),
      brand: String(item.brand || 'Used tire').trim() || 'Used tire',
      size: String(item.size || item.tire_size || '').trim(),
      qty,
      unitPrice,
      lineTotal: Number.isFinite(storedTotal) && storedTotal > 0 ? roundMoney(storedTotal) : roundMoney(unitPrice * qty),
    };
  });
}

function firstName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0];
  return first && first.length <= 40 ? first : '';
}

function formatPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return String(value || '').trim();
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

function receiptRowsHtml(lines) {
  return lines.map((item) => {
    const label = [item.brand, item.size].filter(Boolean).join(' ') || 'Used tire';
    return `<tr>
      <td style="padding:8px 0;font-size:15px;line-height:1.4;color:#111317;">${escapeHtml(item.qty)} × ${escapeHtml(label)}</td>
      <td style="padding:8px 0;font-size:15px;line-height:1.4;color:#111317;text-align:right;white-space:nowrap;">${escapeHtml(formatMoney(item.lineTotal))}</td>
    </tr>`;
  }).join('');
}

function getReceiptTotals(items) {
  const lines = getReceiptItems(items);
  const subtotal = roundMoney(lines.reduce((total, item) => total + item.lineTotal, 0));
  return { lines, ...calculateTax(subtotal) };
}

function nextStepCopy(customer, demo) {
  if (demo) return 'This is a demo receipt. No real card was charged.';
  const booked = customer?.installation;
  if (customer?.fulfillment === 'Installation' && booked?.date && booked?.time) {
    return `Your installation at the EastCord shop is set for ${booked.date}, ${booked.time}. We will email you when the tires arrive.`;
  }
  if (customer?.fulfillment === 'Installation') {
    return 'We will email you when the tires arrive for installation at 600 Harrop Drive in Milton.';
  }
  return 'If you chose pick up, your tires are ready to be picked up at the shop.';
}

function buildUsedTireReceipt({ customer, items, demo = false }) {
  const name = String(customer?.name || 'Customer').trim() || 'Customer';
  const hello = firstName(name);
  const totals = getReceiptTotals(items);
  const itemText = totals.lines.map((item) => (
    `${item.qty} x ${[item.brand, item.size].filter(Boolean).join(' ')} — ${formatMoney(item.lineTotal)}`
  )).join('\n');

  const branded = buildBrandedEmail({
    to: customer?.email || '',
    subject: demo
      ? 'EastCord Tires demo receipt — used tires'
      : 'EastCord Tires receipt — used tires',
    heading: 'Thank you for your payment',
    body: [
      hello ? `Hello ${hello},` : 'Hello,',
      'We received your payment for used tires.',
      nextStepCopy(customer, demo),
    ],
    actionUrl: ACCOUNT_URL,
    actionLabel: 'View your account',
    extraText: [
      'Receipt',
      itemText,
      `Total: ${formatMoney(totals.totalWithHst)}`,
    ].join('\n'),
    extraHtml: `
      <table style="width:100%;border-collapse:collapse;margin:4px 0 8px;border-top:1px solid #e5e7eb;">${receiptRowsHtml(totals.lines)}</table>
      <p style="margin:0 0 20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:16px;line-height:1.4;color:#111317;">
        <strong>Total ${escapeHtml(formatMoney(totals.totalWithHst))}</strong>
      </p>
      <p style="margin:0 0 16px;font-size:14px;"><a href="${WARRANTY_URL}" style="color:#ba151b;font-weight:700;">Used Tire Warranty Policy</a></p>
    `,
  });

  return {
    ...branded,
    totals,
  };
}

function buildUsedTireShopEmail({ to, order, items, websiteUpdates = [] }) {
  const name = String(order?.customer_name || 'Customer').trim() || 'Customer';
  const lines = getReceiptItems(items);
  const totals = getReceiptTotals(items);
  const tireText = lines.map((item) => (
    `${item.qty} x ${[item.brand, item.size].filter(Boolean).join(' ')} — ${formatMoney(item.lineTotal)}`
  )).join(', ');
  const stockLines = (websiteUpdates || []).map((row) => (
    `${[row.brand, row.tireSize].filter(Boolean).join(' ')} was ${row.from}, now ${row.to}`
  ));
  const installation = (Array.isArray(items) ? items : []).find((item) => item?.installation)?.installation;
  const rows = [
    { label: 'Name', value: name },
    { label: 'Email', value: order?.customer_email || '' },
    { label: 'Phone', value: formatPhone(order?.customer_phone) },
    { label: 'Reach by', value: order?.preferred_contact === 'phone' ? 'Phone' : 'Email' },
    { label: 'Fulfillment', value: order?.fulfillment_preference === 'Installation' ? 'Installation' : 'Pickup' },
    { label: 'Tires', value: tireText },
    { label: 'Total', value: formatMoney(totals.totalWithHst) },
    { label: 'Stock', value: stockLines.join('; ') },
    { label: 'Order', value: order?.id || '' },
    ...(installation ? [
      { label: 'License plate', value: installation.plate },
      { label: 'Appointment', value: `${installation.date} ${installation.time}` },
    ] : []),
    ];

  return buildBrandedEmail({
    to,
    subject: `Paid used tire order — ${name}`,
    heading: 'New paid used tire order',
    body: [
      `${name} paid ${formatMoney(totals.totalWithHst)} for used tires.`,
    ],
    extraText: rows.map((row) => `${row.label}: ${row.value}`).filter((line) => !line.endsWith(': ')).join('\n'),
    extraHtml: rows.filter((row) => String(row.value || '').trim()).map((row) => (
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.4;color:#111317;"><span style="display:block;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;">${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></p>`
    )).join(''),
  });
}

module.exports = {
  getReceiptItems,
  getReceiptTotals,
  buildUsedTireReceipt,
  buildUsedTireShopEmail,
};
