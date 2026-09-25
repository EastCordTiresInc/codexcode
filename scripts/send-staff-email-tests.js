#!/usr/bin/env node
/**
 * Sends one branded test of each live customer/staff email to info@eastcordtires.ca.
 */

const {
  sendEmail,
  getEmailConfig,
  buildBrandedEmail,
  buildAuthEmail,
  CONTACT_EMAIL,
  ACCOUNT_URL,
  APPOINTMENT_URL,
  RESET_PASSWORD_URL,
  WARRANTY_URL,
  htmlFromText,
} = require('../netlify/functions/lib/send-email');
const { buildUsedTireReceipt } = require('../netlify/functions/lib/used-tire-receipt');
const { applicationText } = require('../netlify/functions/lib/installer-applications');

const TO = process.env.EMAIL_TEST_TO || CONTACT_EMAIL;

function appointmentCustomerEmail() {
  return buildBrandedEmail({
    to: TO,
    subject: '[TEST] Your EastCord Tires appointment is confirmed',
    heading: 'Your appointment is confirmed',
    body: [
      'Hello EastCord staff,',
      'We received your deposit and booked your EastCord Tires appointment.',
    ],
    actionUrl: ACCOUNT_URL,
    actionLabel: 'View your account',
    extraText: [
      'Appointment Details:',
      'Service: Used tire installation',
      'Vehicle: 2018 Honda Civic',
      'Date: Saturday, October 4',
      'Time: 10:00 AM - 12:00 PM',
      'Service Location: 600 Harrop Drive, Milton',
      '',
      'Payment Details:',
      'Total Including HST: $226.00',
      'Total Deposit Paid: $45.20',
      'Total Remaining Balance Due at Service: $180.80',
      `Used Tire Warranty: ${WARRANTY_URL}`,
    ].join('\n'),
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
        <strong>Total Deposit Paid:</strong> $45.20<br />
        <strong>Total Remaining Balance Due at Service:</strong> $180.80
      </p>
      <p style="margin:0 0 16px;font-size:14px;"><a href="${WARRANTY_URL}" style="color:#ba151b;font-weight:700;">Used Tire Warranty Policy</a></p>
    `,
  });
}

async function main() {
  const config = getEmailConfig();
  if (!config.apiKey) {
    throw new Error('RESEND_API_KEY is missing. Emails cannot be sent.');
  }
  console.log(`From ${config.from}`);
  console.log(`To ${TO}`);

  const emails = [
    buildAuthEmail({
      to: TO,
      subject: '[TEST] Nikki, confirm your EastCord Tires account',
      heading: 'Welcome to EastCord, Nikki',
      body: [
        'This is your account for EastCord Tires at 600 Harrop Drive in Milton — inspected used tires, new tires, and installation at the shop.',
        'Confirm this email so we can save your orders, hold your bookings, and keep your receipts in one place.',
      ],
      actionUrl: ACCOUNT_URL,
      actionLabel: 'Confirm your EastCord account',
      footer: 'Test only. Ignore if you did not request this.',
    }),
    buildAuthEmail({
      to: TO,
      subject: '[TEST] Reset your EastCord Tires password',
      heading: 'Reset your EastCord Tires password',
      body: [
        'We received a request to reset the password on your EastCord Tires account.',
        'Choose a new password so you can keep shopping inspected used tires, new tires, and installation at 600 Harrop Drive in Milton.',
      ],
      actionUrl: RESET_PASSWORD_URL,
      actionLabel: 'Choose a new EastCord password',
      footer: 'Test only. Ignore if you did not request this.',
    }),
    appointmentCustomerEmail(),
    {
      to: TO,
      subject: '[TEST] New Confirmed Appointment - EastCord Tires',
      text: 'New confirmed appointment received.\n\nName: Test Customer\nService: Used tire installation\nDate: Saturday, October 4\nDeposit Paid: $45.20',
      html: htmlFromText('New confirmed appointment received.\n\nName: Test Customer\nService: Used tire installation\nDate: Saturday, October 4\nDeposit Paid: $45.20'),
    },
    buildUsedTireReceipt({
      customer: { name: 'Test Customer', email: TO },
      items: [{ brand: 'Michelin', size: '225/45R17', qty: 2, unitPrice: 80 }],
    }),
    buildAuthEmail({
      to: TO,
      subject: '[TEST] EastCord Tires payment received — book installation',
      heading: 'Your new tires are confirmed',
      body: [
        'Hello EastCord staff,',
        'EastCord Tires received your new tire payment. You can book installation now.',
      ],
      actionUrl: `${APPOINTMENT_URL}?source=new-tires`,
      actionLabel: 'Book installation',
    }),
    buildAuthEmail({
      to: TO,
      subject: '[TEST] Your EastCord tires are ready for pickup',
      heading: 'Your tires are ready',
      body: [
        'Hello EastCord staff,',
        'Your new tires are at EastCord Tires, 600 Harrop Drive in Milton.',
      ],
      actionUrl: ACCOUNT_URL,
      actionLabel: 'View your account',
    }),
    {
      to: TO,
      replyTo: 'sample.installer@example.com',
      subject: '[TEST] New installer application — Jordan Patel',
      text: applicationText({
        full_name: 'Jordan Patel',
        email: 'jordan.patel.sample@example.com',
        phone: '3655550101',
        years_experience: '6-10 years',
        licensed_technician: 'Yes',
        city: 'Mississauga',
        province: 'Ontario',
        postal_code: 'L5B 1M3',
        services: ['Seasonal changeover', 'Mount and balance'],
        vehicles: ['Passenger', 'CUV SUV'],
        equipment: ['Torque wrench'],
        jobs_per_week: '11-20',
        service_area: 'Mississauga, Oakville, Milton',
        weekday_hours: 'Mon-Fri, 7:30 AM - 6:00 PM',
        after_hours: 'Limited',
        liability_insurance: 'Yes',
        wsib_coverage: 'Yes',
      }),
    },
  ];

  let failed = 0;
  for (const email of emails) {
    if (!String(email.subject || '').startsWith('[TEST]')) {
      email.subject = `[TEST] ${email.subject}`;
    }
    if (!email.html && email.text) email.html = htmlFromText(email.text);
    const result = await sendEmail(email);
    if (result.ok) {
      console.log(`PASS ${email.subject}`);
    } else {
      failed += 1;
      console.error(`FAIL ${email.subject} :: ${result.reason || ''} ${result.resendMessage || ''}`);
    }
  }

  if (failed) {
    throw new Error(`${failed} email send(s) failed.`);
  }
  console.log(`\nAll ${emails.length} staff test emails sent to ${TO}.`);
}

main().catch((error) => {
  console.error('\nFAIL:', error.message);
  process.exit(1);
});
