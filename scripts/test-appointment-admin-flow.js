#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { calculateSelections } = require('../appointment-services');
const { buildBrandedEmail, sendEmail } = require('../netlify/functions/lib/send-email');

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const SITE = 'http://localhost:8888';
const STAFF_EMAIL = 'info@eastcordtires.ca';
const CUSTOMER_EMAIL = 'burnertestin+eastcord-flow@gmail.com';
const TINY_JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const WINDOWS = [
  '8:00 AM - 9:00 AM',
  '9:00 AM - 10:00 AM',
  '10:00 AM - 11:00 AM',
  '11:00 AM - 12:00 PM',
  '12:00 PM - 1:00 PM',
  '1:00 PM - 2:00 PM',
  '2:00 PM - 3:00 PM',
  '3:00 PM - 4:00 PM',
  '4:00 PM - 5:00 PM',
  '5:00 PM - 6:00 PM',
  '6:00 PM - 7:00 PM',
  '7:00 PM - 8:00 PM',
];

function loadEnv() {
  const file = path.join(__dirname, '..', '.netlify', '.env');
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
    if (!match || process.env[match[1]]) return;
    process.env[match[1]] = match[2].trim();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok  ${message}`);
}

function isoDate(daysAhead) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text.slice(0, 300) };
  }
}

async function main() {
  loadEnv();
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const jpeg = Buffer.from(TINY_JPEG, 'base64');
  assert(jpeg[0] === 0xff && jpeg[1] === 0xd8, 'test photo is a jpeg');

  const quote = calculateSelections([{ id: 'on-rim-swap', quantity: 1 }]);
  let userId = '';
  let bookingId = '';
  let slot = null;

  try {
    const password = `EastCord-Flow-${Date.now()}!aA`;
    const created = await admin.auth.admin.createUser({
      email: CUSTOMER_EMAIL,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'EastCord Flow Test', phone: '9055550142' },
    });
    if (created.error && /already been registered/i.test(created.error.message || '')) {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = (listed.data?.users || []).find((user) => user.email === CUSTOMER_EMAIL);
      assert(existing, 'The test customer could not be created or found.');
      userId = existing.id;
      const updated = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (updated.error) throw updated.error;
    } else if (created.error) {
      throw created.error;
    } else {
      userId = created.data.user.id;
    }
    await admin.from('customer_profiles').upsert({
      id: userId,
      full_name: 'EastCord Flow Test',
      email: CUSTOMER_EMAIL,
      phone: '9055550142',
      updated_at: new Date().toISOString(),
    });

    for (let days = 45; days <= 75 && !slot; days += 1) {
      const date = isoDate(days);
      const { data: taken, error } = await admin
        .from('shop_calendar_slots')
        .select('time_window')
        .eq('slot_date', date);
      if (error) throw error;
      const used = new Set((taken || []).map((row) => row.time_window));
      const time = WINDOWS.find((windowLabel) => !used.has(windowLabel));
      if (time) slot = { date, time };
    }
    assert(slot, 'an open shop hour was found');

    const inserted = await admin.from('appointment_bookings').insert({
      customer_id: userId,
      customer_name: 'EastCord Flow Test',
      customer_email: CUSTOMER_EMAIL,
      customer_phone: '9055550142',
      service_id: quote.id,
      service_name: quote.name,
      starting_price: quote.serviceSubtotal,
      service_subtotal: quote.serviceSubtotal,
      hst_amount: quote.hstAmount,
      total_with_hst: quote.totalWithHst,
      tax_rate: quote.taxRate,
      deposit_amount: quote.depositAmount,
      remaining_balance: quote.remainingBalance,
      preferred_date: slot.date,
      preferred_time_window: slot.time,
      vehicle_year: '2022',
      vehicle_make: 'Toyota',
      vehicle_model: 'Corolla',
      vehicle_plate_number: 'FLOW42',
      vehicle_colour: 'Blue',
      tire_size: '205/55R16',
      number_of_tires: 1,
      city: 'EastCord shop',
      install_location: 'shop',
      full_service_address: '600 Harrop Drive, Milton, Ontario',
      additional_notes: 'AUTOMATED FLOW TEST - SAFE TO DELETE',
      booking_status: 'Confirmed',
      payment_status: 'paid_deposit',
      updated_at: new Date().toISOString(),
    }).select('id, booking_status, payment_status, total_with_hst, deposit_amount').single();
    if (inserted.error) throw inserted.error;
    bookingId = inserted.data.id;
    assert(inserted.data.booking_status === 'Confirmed', 'booking is confirmed after the deposit');
    assert(inserted.data.payment_status === 'paid_deposit', 'deposit is marked paid');
    assert(Number(inserted.data.total_with_hst) === quote.totalWithHst, `order total is ${quote.totalWithHst}`);

    const { data: shopSlot } = await admin
      .from('shop_calendar_slots')
      .select('appointment_id')
      .eq('slot_date', slot.date)
      .eq('time_window', slot.time)
      .maybeSingle();
    assert(shopSlot?.appointment_id === bookingId, 'shop calendar holds this hour');
    const { data: mobileSlot } = await admin
      .from('mobile_calendar_slots')
      .select('appointment_id')
      .eq('slot_date', slot.date)
      .eq('time_window', slot.time)
      .maybeSingle();
    assert(!mobileSlot, 'the same hour stays open on the mobile calendar');

    const customer = await anon.auth.signInWithPassword({ email: CUSTOMER_EMAIL, password });
    if (customer.error) throw customer.error;
    const ownBookings = await anon
      .from('appointment_bookings')
      .select('id, booking_status, payment_status, deposit_amount, total_with_hst')
      .eq('customer_id', userId);
    if (ownBookings.error) throw ownBookings.error;
    const own = (ownBookings.data || []).find((row) => row.id === bookingId);
    assert(own, 'the customer account can see this booking');
    assert(own.booking_status === 'Confirmed', 'the customer booking is confirmed');
    await anon.auth.signOut();

    const publicSlots = await readJson(await fetch(`${SITE}/.netlify/functions/get-appointment-booked-slots?date=${slot.date}`));
    assert((publicSlots.shop || []).some((key) => key.includes(slot.time) && key.endsWith('__shop')), 'public booking page blocks the shop hour');
    assert(!(publicSlots.mobile || []).some((key) => key.includes(slot.time)), 'public booking page still offers the mobile hour');

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: STAFF_EMAIL });
    if (link.error) throw link.error;
    const verified = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.data.properties.hashed_token,
    });
    if (verified.error) throw verified.error;
    const token = verified.data.session?.access_token;
    assert(token, 'staff session opened without sending a login email');

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const adminList = await readJson(await fetch(`${SITE}/.netlify/functions/admin-appointments?date=${slot.date}`, { headers }));
    const listed = (adminList.appointments || []).find((row) => row.id === bookingId);
    assert(listed, 'admin appointments shows the booking');
    assert(listed.customer_name === 'EastCord Flow Test', 'admin card has the test customer');
    assert(listed.install_location === 'shop', 'admin card is a shop job');

    const jobs = await readJson(await fetch(`${SITE}/.netlify/functions/admin-job-photos?date=${slot.date}`, { headers }));
    const job = (jobs.appointments || []).find((row) => row.id === bookingId);
    assert(job, 'job photos page lists the booking');
    assert(job.slots.some((item) => item.id === 'after-1' && item.required), 'one after photo is required');
    assert(job.slots.some((item) => item.id === 'before-1' && item.required === false), 'the before photo is optional');

    const earlyFinish = await fetch(`${SITE}/.netlify/functions/admin-job-photos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'finish', appointmentId: bookingId }),
    });
    assert(earlyFinish.status === 400, 'finish waits for the after photo');

    const saved = await readJson(await fetch(`${SITE}/.netlify/functions/admin-job-photos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ appointmentId: bookingId, slot: 'after-1', image: TINY_JPEG }),
    }));
    assert(saved.photo?.url, 'the after photo is saved');

    const finished = await readJson(await fetch(`${SITE}/.netlify/functions/admin-job-photos`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'finish', appointmentId: bookingId }),
    }));
    assert(finished.booking_status === 'Completed', 'the worker finish marks the job completed');
    assert((finished.sent || []).includes(CUSTOMER_EMAIL), 'finish emails the customer');
    assert((finished.sent || []).includes('burnertestin@gmail.com'), 'finish emails the shop copy');
    assert(!(finished.sent || []).includes(STAFF_EMAIL), 'finish does not email info@eastcordtires.ca');

    const confirmation = await sendEmail(buildBrandedEmail({
      to: CUSTOMER_EMAIL,
      subject: 'Your EastCord Tires appointment is confirmed',
      heading: 'Your appointment is confirmed',
      body: [
        'Hello EastCord Flow Test,',
        'We received your deposit and booked your EastCord Tires appointment.',
        `${quote.name} at the EastCord shop on ${slot.date}, ${slot.time}.`,
        `Deposit paid: $${quote.depositAmount.toFixed(2)}. Remaining balance: $${quote.remainingBalance.toFixed(2)}.`,
      ],
    }));
    assert(confirmation.ok, `booking confirmation email accepted (${confirmation.provider || confirmation.reason})`);
    assert(confirmation.to === CUSTOMER_EMAIL, 'booking confirmation went to the test inbox');

    const after = await readJson(await fetch(`${SITE}/.netlify/functions/admin-appointments?date=${slot.date}`, { headers }));
    const completed = (after.appointments || []).find((row) => row.id === bookingId);
    assert(completed?.booking_status === 'Completed', 'admin appointments shows the job as completed');
    const finishedJobs = await readJson(await fetch(`${SITE}/.netlify/functions/admin-job-photos?date=${slot.date}`, { headers }));
    const finishedJob = (finishedJobs.appointments || []).find((row) => row.id === bookingId);
    assert(finishedJob?.photos?.['after-1']?.url, 'the completed job still has the after photo');
    assert(!finishedJob?.photos?.['before-1'], 'the optional before photo was left empty');
  } finally {
    if (bookingId) {
      await admin.storage.from('installation-photos').remove([`${bookingId}/after-1.jpg`, `${bookingId}/before-1.jpg`]);
      await admin.from('appointment_bookings').delete().eq('id', bookingId);
    }
    if (userId) {
      await admin.from('appointment_bookings').delete().eq('customer_id', userId);
      await admin.from('customer_profiles').delete().eq('id', userId);
      await admin.auth.admin.deleteUser(userId);
    }
    if (bookingId) {
      const leftover = await admin.from('appointment_bookings').select('id').eq('id', bookingId).maybeSingle();
      if (leftover.data) throw new Error('The test booking was still in the database after cleanup.');
    }
    console.log('ok  test booking, photos, and customer were removed');
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
