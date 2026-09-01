const { sendEmail, getEmailConfig, CONTACT_EMAIL } = require('./lib/send-email');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function clean(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return `$${amount.toFixed(2)}`;
}

function formatItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
    brand: clean(item.brand),
    model: clean(item.model),
    size: clean(item.size),
    qty: Math.max(1, Number(item.qty) || 1),
    price: Number(item.price) || 0,
    partNumber: clean(item.partNumber),
  }));
}

function formatServices(services) {
  return (Array.isArray(services) ? services : [])
    .map((service) => {
      const name = clean(service?.name || service?.key);
      if (!name) return '';
      const price = money(service.price);
      return price ? `${name} (${price})` : name;
    })
    .filter(Boolean);
}

function formatTotals(totals) {
  if (!totals || typeof totals !== 'object') return [];
  const lines = [
    money(totals.subtotal) && `Subtotal: ${money(totals.subtotal)}`,
    money(totals.tax) && `Tax: ${money(totals.tax)}`,
    money(totals.total) && `Total: ${money(totals.total)}`,
    money(totals.deposit) && `Deposit paid: ${money(totals.deposit)}`,
  ];
  if (totals.outstanding !== undefined && totals.outstanding !== null && totals.outstanding !== '') {
    const outstanding = Number(totals.outstanding);
    if (Number.isFinite(outstanding)) lines.push(`Outstanding: ${money(outstanding)}`);
  }
  return lines.filter(Boolean);
}

exports.handler = async function requestNewTireOrder(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid order request.' });
  }

  const customer = {
    name: clean(payload.customer?.name),
    email: clean(payload.customer?.email).toLowerCase(),
    phone: clean(payload.customer?.phone),
  };
  const fulfillment = clean(payload.fulfillment) === 'Installation' ? 'Installation' : 'Pickup';
  const vehicle = payload.vehicle || {};
  const notes = clean(payload.notes);
  const pageUrl = clean(payload.pageUrl);
  const source = clean(payload.source) || 'EastCord new tires page';
  const orderNumber = clean(payload.orderNumber);
  const items = formatItems(payload.items);
  const services = formatServices(payload.services);
  const totals = formatTotals(payload.totals);

  if (!customer.name || !customer.email || !customer.phone) {
    return json(400, { message: 'Name, email, and phone are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    return json(400, { message: 'Please enter a valid email address.' });
  }
  if (!items.length && !notes) {
    return json(400, { message: 'Enter the tire brand, size, and quantity before sending this order.' });
  }

  const vehicleLine = [clean(vehicle.year), clean(vehicle.make), clean(vehicle.model), clean(vehicle.submodel)]
    .filter(Boolean)
    .join(' ');
  const itemLines = items.map((item) => {
    const name = [item.brand, item.model, item.size].filter(Boolean).join(' ');
    const part = item.partNumber ? ` (${item.partNumber})` : '';
    const price = item.price ? ` @ ${money(item.price)} each` : '';
    return `${item.qty} x ${name}${part}${price}`;
  });
  const nextStep = fulfillment === 'Installation'
    ? 'When the tires are in, email the customer this booking link: https://eastcordtires.ca/appointment'
    : 'When the tires are in, email or text the customer that the order is ready for pickup. No appointment.';

  const text = [
    'New tire order',
    '',
    `Source: ${source}`,
    orderNumber ? `TireConnect order #: ${orderNumber}` : '',
    `Name: ${customer.name}`,
    `Email: ${customer.email}`,
    `Phone: ${customer.phone}`,
    `Fulfillment: ${fulfillment}`,
    vehicleLine ? `Vehicle: ${vehicleLine}` : '',
    notes ? `Notes: ${notes}` : '',
    pageUrl ? `Page: ${pageUrl}` : '',
    '',
    'Tires:',
    ...(itemLines.length ? itemLines : ['(see notes)']),
    '',
    services.length ? 'Services:' : '',
    ...services,
    '',
    ...totals,
    '',
    nextStep,
  ].filter((line) => line !== undefined).join('\n');

  const customerText = fulfillment === 'Installation'
    ? [
      `Hello ${customer.name},`,
      '',
      'EastCord Tires received your new tire order with installation.',
      'You can book installation after this order is saved. You cannot book on the purchase date or the following 4 days. Hours are 8:00 AM to 8:00 PM.',
      'https://eastcordtires.ca/appointment',
      '',
      ...itemLines,
      orderNumber ? `TireConnect order #: ${orderNumber}` : '',
      '',
      'info@eastcordtires.ca · 365-822-5553',
    ].filter(Boolean).join('\n')
    : [
      `Hello ${customer.name},`,
      '',
      'EastCord Tires received your new tire order for store pickup.',
      'We will email you when the tires are ready to pick up. No appointment is needed.',
      '',
      ...itemLines,
      orderNumber ? `TireConnect order #: ${orderNumber}` : '',
      '',
      'info@eastcordtires.ca · 365-822-5553',
    ].filter(Boolean).join('\n');

  const config = getEmailConfig();
  const subjectBits = ['New tire order', fulfillment, customer.name, orderNumber].filter(Boolean);
  const staffEmail = await sendEmail({
    to: config.eastcordTo || CONTACT_EMAIL,
    replyTo: customer.email,
    subject: subjectBits.join(' — '),
    text,
    html: `<pre style="font: 15px/1.5 sans-serif; white-space: pre-wrap;">${escapeHtml(text)}</pre>`,
  });

  if (staffEmail.ok) {
    await sendEmail({
      to: customer.email,
      replyTo: CONTACT_EMAIL,
      subject: fulfillment === 'Installation'
        ? 'EastCord Tires received your order — installation booking comes later'
        : 'EastCord Tires received your order — we will confirm pickup',
      text: customerText,
      html: `<pre style="font: 15px/1.5 sans-serif; white-space: pre-wrap;">${escapeHtml(customerText)}</pre>`,
    });
    return json(200, { ok: true, emailed: true });
  }

  return json(200, {
    ok: true,
    emailed: false,
    reason: staffEmail.reason || 'email_not_sent',
    message: 'The website could not send the email from the server. Use the email app if it opens.',
  });
};
