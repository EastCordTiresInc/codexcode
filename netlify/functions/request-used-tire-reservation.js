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
    '',
    'Tires:',
    ...itemLines,
    '',
    `Subtotal: ${clean(totals.subtotal) || ''}`,
    `HST: ${clean(totals.hst) || ''}`,
    `Estimated total: ${clean(totals.total) || ''}`,
  ].join('\n');

  const config = getEmailConfig();
  const email = await sendEmail({
    to: config.eastcordTo || CONTACT_EMAIL,
    replyTo: customer.email,
    subject: `Used tire reservation request — ${customer.name}`,
    text,
    html: `<pre style="font: 15px/1.5 sans-serif; white-space: pre-wrap;">${escapeHtml(text)}</pre>`,
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
