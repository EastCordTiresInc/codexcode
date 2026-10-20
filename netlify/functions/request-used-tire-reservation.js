const { sendEmail, CONTACT_EMAIL, APPOINTMENT_URL, buildBrandedEmail, detailRowsHtml } = require('./lib/send-email');

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

exports.handler = async function requestUsedTireReservation(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Method not allowed.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid reservation request.' });
  }

  const customer = {
    name: clean(payload.customer?.name),
    email: clean(payload.customer?.email).toLowerCase(),
    phone: clean(payload.customer?.phone),
  };
  const fulfillment = clean(payload.fulfillment) || 'Pickup';
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 8) : [];
  const totals = payload.totals || {};

  if (!customer.name || !customer.email || !customer.phone) {
    return json(400, { message: 'Name, email, and phone are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
    return json(400, { message: 'Please enter a valid email address.' });
  }
  if (!items.length) {
    return json(400, { message: 'Add at least one tire before sending this request.' });
  }

  const itemLines = items.map((item) => (
    `${Math.max(1, Number(item.qty) || 1)} x ${clean(item.brand)} ${clean(item.size)} (ID ${clean(item.inventoryId)})`
  ));
  const text = [
    'Used tire reservation request',
    '',
    `Name: ${customer.name}`,
    `Email: ${customer.email}`,
    `Phone: ${customer.phone}`,
    `Fulfillment: ${fulfillment}`,
    fulfillment === 'Installation'
      ? `When the tires are in, send the customer this booking link: ${APPOINTMENT_URL}`
      : 'Confirm with the customer when the order is ready for pickup. No appointment is required.',
    '',
    'Tires:',
    ...itemLines,
    '',
    `Subtotal: ${clean(totals.subtotal) || ''}`,
    `Total: ${clean(totals.total) || ''}`,
  ].join('\n');

  const email = await sendEmail({
    ...buildBrandedEmail({
      to: CONTACT_EMAIL,
      subject: `Used tire reservation request — ${customer.name}`,
      heading: 'Used tire reservation request',
      body: [
        `${customer.name} asked to reserve used tires for ${fulfillment.toLowerCase()}.`,
        fulfillment === 'Installation'
          ? 'When the tires are in, send the customer the booking link.'
          : 'Confirm with the customer when the order is ready for pickup. No appointment is required.',
      ],
      extraText: text,
      extraHtml: detailRowsHtml([
        { label: 'Name', value: customer.name },
        { label: 'Email', value: customer.email },
        { label: 'Phone', value: customer.phone },
        { label: 'Fulfillment', value: fulfillment },
        { label: 'Tires', value: itemLines.join(', ') },
        { label: 'Subtotal', value: clean(totals.subtotal) },
        { label: 'Total', value: clean(totals.total) },
      ]),
    }),
    replyTo: customer.email,
  });

  if (email.ok) {
    return json(200, { ok: true, emailed: true });
  }

  return json(200, {
    ok: true,
    emailed: false,
    reason: email.reason || 'email_not_sent',
    message: 'The website could not send the email from the server. Use the email app or copy the message.',
  });
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
