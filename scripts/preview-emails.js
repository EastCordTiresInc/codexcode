const fs = require('fs');
const path = require('path');
const { buildAuthEmail, ACCOUNT_URL, APPOINTMENT_URL, WARRANTY_URL } = require('../netlify/functions/lib/send-email');
const { buildUsedTireReceipt } = require('../netlify/functions/lib/used-tire-receipt');

const confirmUrl = 'https://eastcordtires.ca/account.html';
const resetUrl = 'https://eastcordtires.ca/reset-password.html';
const bookingUrl = `${APPOINTMENT_URL}?source=new-tires&newTireOrder=preview#appointment-booking`;

const emails = [
  {
    audience: 'Customer',
    live: true,
    title: 'Signup confirmation',
    email: buildAuthEmail({
      to: 'nikki@example.com',
      subject: 'Nikki, confirm your EastCord Tires account',
      heading: 'Welcome to EastCord, Nikki',
      body: [
        'This is your account for EastCord Tires at 600 Harrop Drive in Milton — inspected used tires, new tires, and installation at the shop.',
        'Confirm this email so we can save your orders, hold your bookings, and keep your receipts in one place.',
      ],
      actionUrl: confirmUrl,
      actionLabel: 'Confirm your EastCord account',
      footer: 'If you did not create an EastCord Tires account, you can ignore this email.',
    }),
  },
  {
    audience: 'Customer',
    live: true,
    title: 'Password reset',
    email: buildAuthEmail({
      to: 'nikki@example.com',
      subject: 'Reset your EastCord Tires password',
      heading: 'Reset your EastCord Tires password',
      body: [
        'We received a request to reset the password on your EastCord Tires account.',
        'Choose a new password so you can keep shopping inspected used tires, new tires, and installation at 600 Harrop Drive in Milton.',
      ],
      actionUrl: resetUrl,
      actionLabel: 'Choose a new EastCord password',
      footer: 'If you did not ask to reset your EastCord Tires password, you can ignore this email.',
    }),
  },
  {
    audience: 'Customer',
    live: false,
    title: 'Appointment confirmed',
    email: buildAuthEmail({
      to: 'nikki@example.com',
      subject: 'Your EastCord Tires appointment is confirmed',
      heading: 'Your appointment is confirmed',
      body: [
        'Hello Nikki,',
        'We received your deposit and booked your EastCord Tires appointment.',
      ],
      actionUrl: ACCOUNT_URL,
      actionLabel: 'View your account',
      extraHtml: `
        <h3 style="font-size:16px;margin:20px 0 8px;">Appointment 1</h3>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">
          <strong>Service:</strong> Used tire installation<br />
          <strong>Vehicle:</strong> 2018 Honda Civic<br />
          <strong>Date:</strong> Saturday, October 4<br />
          <strong>Time:</strong> 10:00 AM – 12:00 PM<br />
          <strong>Service Location:</strong> 600 Harrop Drive, Milton
        </p>
        <h3 style="font-size:16px;margin:20px 0 8px;">Payment Details</h3>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          <strong>Total Including HST:</strong> $226.00<br />
          <strong>Total Deposit Paid:</strong> $50.00<br />
          <strong>Total Remaining Balance Due at Service:</strong> $176.00
        </p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4b5563;">Wheel nuts/bolts must be re-torqued after approximately 100 km of driving following tire service.</p>
        <p style="margin:0 0 16px;font-size:14px;"><a href="${WARRANTY_URL}" style="color:#ba151b;font-weight:700;">Used Tire Warranty Policy</a></p>
      `,
    }),
  },
  {
    audience: 'Customer',
    live: false,
    title: 'Used tire receipt',
    email: buildUsedTireReceipt({
      customer: { name: 'Nikki', email: 'nikki@example.com' },
      items: [{ brand: 'Michelin', size: '225/45R17', qty: 2, unitPrice: 80 }],
    }),
  },
  {
    audience: 'Customer',
    live: false,
    title: 'New tires — book installation',
    email: buildAuthEmail({
      to: 'nikki@example.com',
      subject: 'EastCord Tires payment received — book installation',
      heading: 'Your new tires are confirmed',
      body: [
        'Hello Nikki,',
        'EastCord Tires received your new tire payment. You can book installation now. Booking is not available on the purchase date or the following 4 days. Hours are 8:00 AM to 8:00 PM.',
        'Total paid: $812.47',
      ],
      actionUrl: bookingUrl,
      actionLabel: 'Book installation',
      extraHtml: '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">4 x Continental ExtremeContact 225/45R17</p>',
    }),
  },
  {
    audience: 'Customer',
    live: false,
    title: 'New tires — ready for pickup',
    email: buildAuthEmail({
      to: 'nikki@example.com',
      subject: 'Nikki, your EastCord tires are ready for pickup',
      heading: 'Your tires are ready',
      body: [
        'Hello Nikki,',
        'Your new tires are at EastCord Tires, 600 Harrop Drive in Milton.',
        'Come by during shop hours, 8:00 AM to 8:00 PM. No appointment is needed.',
      ],
      actionUrl: ACCOUNT_URL,
      actionLabel: 'View your account',
      extraHtml: '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">4 x Continental ExtremeContact 225/45R17</p>',
      footer: 'If you have questions, call EastCord Tires at 365-822-5553.',
    }),
  },
  {
    audience: 'Customer',
    live: false,
    title: 'New tires — pickup',
    email: buildAuthEmail({
      to: 'nikki@example.com',
      subject: 'EastCord Tires payment received — we will confirm pickup',
      heading: 'Your pickup order is confirmed',
      body: [
        'Hello Nikki,',
        'EastCord Tires received your new tire payment for store pickup at 600 Harrop Drive, Milton. We will email you when the tires are ready. No appointment is needed.',
        'Total paid: $812.47',
      ],
      actionUrl: ACCOUNT_URL,
      actionLabel: 'View your account',
      extraHtml: '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">4 x Continental ExtremeContact 225/45R17</p>',
    }),
  },
];

const cards = emails.map((item) => `
  <section style="margin:0 0 48px;">
    <p style="margin:0 0 8px;font:700 13px/1.4 Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">
      ${item.title} · ${item.audience} · ${item.live ? 'On the live site' : 'Local branded version'}
    </p>
    <p style="margin:0 0 12px;font:13px/1.4 Arial,sans-serif;color:#6b7280;">Subject: ${item.email.subject}</p>
    ${item.email.html}
  </section>
`).join('');

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EastCord email preview</title>
  </head>
  <body style="margin:0;background:#e5e7eb;">
    <main style="max-width:720px;margin:0 auto;padding:32px 16px 64px;">
      <h1 style="font:700 24px/1.3 Arial,sans-serif;color:#111317;">EastCord customer emails</h1>
      <p style="font:15px/1.5 Arial,sans-serif;color:#4b5563;margin:0 0 32px;">These are the emails customers get. Staff alerts stay as plain shop notes.</p>
      ${cards}
    </main>
  </body>
</html>`;

const out = path.join(__dirname, '..', 'email-preview.html');
fs.writeFileSync(out, html);
console.log(out);
