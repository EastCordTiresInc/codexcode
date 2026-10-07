const { requireAdminUser } = require('./lib/admin-auth');
const {
  sendEmail,
  buildBrandedEmail,
  escapeHtml,
} = require('./lib/send-email');

const BUCKET = 'installation-photos';
const MAX_BYTES = 2_500_000;
const SIGNED_URL_SECONDS = 60 * 60;
const MAX_EMAIL_BYTES = 9 * 1024 * 1024;
const BLOCKED_SHOP_INBOX = 'info@eastcordtires.ca';

const PHOTO_SLOTS = Object.freeze([
  { id: 'plate', label: 'Vehicle and plate', hint: 'Front of the vehicle with the plate readable.' },
  { id: 'sidewall', label: 'Tire sidewall', hint: 'Size and brand of the tire being installed.' },
  { id: 'before', label: 'Before the work', hint: 'The wheel on the vehicle before it comes off.' },
  { id: 'removed', label: 'Wheel removed', hint: 'The wheel or tire off the vehicle.' },
  { id: 'mounted', label: 'Tire mounted', hint: 'The tire seated on the rim.' },
  { id: 'lugs', label: 'Lug nuts', hint: 'Lugs seated, or the torque mark after they are tightened.' },
  { id: 'finished', label: 'Finished install', hint: 'The wheel back on the vehicle after the job.' },
]);

const SLOT_IDS = new Set(PHOTO_SLOTS.map((slot) => slot.id));

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

function torontoDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function vehicleLabel(row) {
  return [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ');
}

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return null;
  }
}

function jpegBuffer(dataUrlOrBase64) {
  const raw = String(dataUrlOrBase64 || '');
  const match = raw.match(/^data:image\/jpeg;base64,([a-z0-9+/=\s]+)$/i);
  const encoded = (match ? match[1] : raw).replace(/\s+/g, '');
  if (!encoded || !/^[a-z0-9+/=]+$/i.test(encoded)) return null;
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return null;
  return buffer;
}

async function ensureBucket(supabaseAdmin) {
  const existing = await supabaseAdmin.storage.getBucket(BUCKET);
  if (!existing.error && existing.data) return null;
  const created = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  if (created.error && !/already exists|duplicate/i.test(created.error.message || '')) {
    return created.error;
  }
  return null;
}

async function photosForAppointment(supabaseAdmin, appointmentId) {
  const listed = await supabaseAdmin.storage.from(BUCKET).list(appointmentId, {
    limit: 20,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (listed.error) {
    if (/not found|does not exist/i.test(listed.error.message || '')) return {};
    throw listed.error;
  }

  const photos = {};
  const files = (listed.data || []).filter((file) => SLOT_IDS.has(String(file.name || '').replace(/\.jpe?g$/i, '')));
  await Promise.all(files.map(async (file) => {
    const slot = String(file.name).replace(/\.jpe?g$/i, '');
    const path = `${appointmentId}/${file.name}`;
    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return;
    photos[slot] = {
      url: signed.data.signedUrl,
      updatedAt: file.updated_at || file.created_at || '',
    };
  }));
  return photos;
}

function publicAppointment(row, photos) {
  return {
    id: row.id,
    customer_name: row.customer_name || '',
    customer_email: row.customer_email || '',
    customer_phone: row.customer_phone || '',
    service_name: row.service_name || '',
    preferred_time_window: row.preferred_time_window || '',
    booking_status: row.booking_status || '',
    payment_status: row.payment_status || '',
    vehicle: vehicleLabel(row),
    vehicle_plate_number: row.vehicle_plate_number || '',
    tire_size: row.tire_size || '',
    number_of_tires: row.number_of_tires || null,
    install_location: row.install_location || '',
    city: row.city || '',
    photos,
  };
}

async function listJobs(supabaseAdmin, event) {
  const params = event.queryStringParameters || {};
  const date = isValidDate(params.date) ? params.date : torontoDateString();
  const bucketError = await ensureBucket(supabaseAdmin);
  if (bucketError) {
    console.error('[EastCord job photos] Bucket setup failed.', bucketError.message);
    return json(500, { message: 'Photo storage is not available yet.' });
  }

  const { data, error } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id, customer_name, customer_email, customer_phone, service_name, preferred_time_window, booking_status, payment_status, vehicle_year, vehicle_make, vehicle_model, vehicle_plate_number, tire_size, number_of_tires, install_location, city, preferred_date')
    .eq('preferred_date', date);

  if (error) {
    console.error('[EastCord job photos] Appointment list failed.', error.message);
    return json(500, { message: 'Installation jobs could not be loaded right now.' });
  }

  const rows = Array.isArray(data) ? data : [];
  rows.sort((a, b) => String(a.preferred_time_window || '').localeCompare(String(b.preferred_time_window || '')));

  const appointments = await Promise.all(rows.map(async (row) => {
    const photos = await photosForAppointment(supabaseAdmin, row.id);
    return publicAppointment(row, photos);
  }));

  return json(200, {
    date,
    slots: PHOTO_SLOTS,
    count: appointments.length,
    appointments,
  });
}

function isEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function appointmentDetails(appointment) {
  const vehicle = vehicleLabel(appointment);
  const plate = appointment.vehicle_plate_number ? `Plate ${appointment.vehicle_plate_number}` : '';
  return [
    appointment.customer_name || 'Customer',
    [appointment.preferred_date, appointment.preferred_time_window].filter(Boolean).join(' · '),
    appointment.service_name || 'Tire installation',
    [vehicle, plate].filter(Boolean).join(' · '),
  ].filter(Boolean);
}

function photoMarkup(photos) {
  return photos.map((photo, index) => (
    `<p style="margin:18px 0 8px;font-size:15px;font-weight:700;color:#111317;">${index + 1}. ${escapeHtml(photo.label)}</p>`
    + `<img src="cid:${escapeHtml(photo.contentId)}" alt="${escapeHtml(photo.label)}" width="456" style="display:block;width:100%;max-width:456px;height:auto;border-radius:8px;border:1px solid #e5e7eb;" />`
  )).join('');
}

function photoAttachments(photos) {
  return photos.map((photo) => ({
    filename: photo.filename,
    content: photo.buffer.toString('base64'),
    contentType: photo.contentType || 'image/jpeg',
    contentId: photo.contentId,
  }));
}

function isBlockedShopInbox(value) {
  return String(value || '').trim().toLowerCase() === BLOCKED_SHOP_INBOX;
}

function buildInstallationPhotoEmails(appointment, photos, options = {}) {
  const customerTo = String(appointment.customer_email || '').trim();
  const details = appointmentDetails(appointment);
  const attachments = photoAttachments(photos);
  const photoList = photos.map((photo, index) => `${index + 1}. ${photo.label}`).join('\n');
  const testLine = options.test ? 'This is a test of the installation photo email.' : '';
  const emails = [];

  if (isEmailAddress(customerTo) && !isBlockedShopInbox(customerTo)) {
    const customerEmail = buildBrandedEmail({
      to: customerTo,
      subject: 'Your EastCord installation photos',
      heading: 'Your installation photos',
      body: [
        testLine,
        `${appointment.customer_name || 'Hello'}, these are the photos from your EastCord Tires installation.`,
        ...details.slice(1),
      ].filter(Boolean),
      extraText: photoList,
      extraHtml: photoMarkup(photos),
      footer: 'Reply to this email if a photo does not look right.',
    });
    customerEmail.attachments = attachments;
    emails.push(customerEmail);
  }

  return { customerTo, emails };
}

async function loadSavedPhotos(supabaseAdmin, appointmentId) {
  const photos = [];
  for (const slot of PHOTO_SLOTS) {
    const downloaded = await supabaseAdmin.storage.from(BUCKET).download(`${appointmentId}/${slot.id}.jpg`);
    if (downloaded.error || !downloaded.data) return { missing: slot.label };
    const buffer = Buffer.from(await downloaded.data.arrayBuffer());
    if (!buffer.length) return { missing: slot.label };
    photos.push({
      id: slot.id,
      label: slot.label,
      filename: `${slot.id}.jpg`,
      contentType: 'image/jpeg',
      contentId: slot.id,
      buffer,
    });
  }
  const total = photos.reduce((sum, photo) => sum + photo.buffer.length, 0);
  if (total > MAX_EMAIL_BYTES) {
    return { tooLarge: true };
  }
  return { photos };
}

async function sendJobPhotos(supabaseAdmin, body) {
  const appointmentId = String(body.appointmentId || '').trim();
  if (!isUuid(appointmentId)) return json(400, { message: 'Choose an installation job before emailing the photos.' });

  const { data: appointment, error } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id, customer_name, customer_email, customer_phone, service_name, preferred_date, preferred_time_window, vehicle_year, vehicle_make, vehicle_model, vehicle_plate_number')
    .eq('id', appointmentId)
    .maybeSingle();

  if (error) {
    console.error('[EastCord job photos] Appointment lookup failed.', error.message);
    return json(500, { message: 'That installation job could not be checked.' });
  }
  if (!appointment) return json(404, { message: 'That installation job was not found.' });

  const loaded = await loadSavedPhotos(supabaseAdmin, appointmentId);
  if (loaded.missing) {
    return json(400, { message: `Add the ${loaded.missing} photo before emailing this job.` });
  }
  if (loaded.tooLarge) {
    return json(400, { message: 'Those photos are too large to email. Replace the largest ones and try again.' });
  }

  const built = buildInstallationPhotoEmails(appointment, loaded.photos);
  if (!built.emails.length) {
    return json(400, {
      message: 'This booking has no customer email. Photos stay on this page and are not sent to info@eastcordtires.ca.',
    });
  }

  const sent = [];
  for (const email of built.emails) {
    if (isBlockedShopInbox(email.to)) {
      return json(400, { message: 'Photos are not emailed to info@eastcordtires.ca.' });
    }
    const result = await sendEmail(email);
    if (!result.ok) {
      console.error('[EastCord job photos] Email failed.', email.to, result.providerMessage || result.reason);
      return json(500, { message: 'The installation photos could not be emailed.' });
    }
    sent.push(email.to);
  }

  return json(200, { message: `Photos emailed to ${sent.join(', ')}.`, sent });
}

async function savePhoto(supabaseAdmin, body, email) {

  const appointmentId = String(body.appointmentId || '').trim();
  const slot = String(body.slot || '').trim();
  if (!isUuid(appointmentId) || !SLOT_IDS.has(slot)) {
    return json(400, { message: 'Choose a job and a photo slot before uploading.' });
  }

  const buffer = jpegBuffer(body.image);
  if (!buffer) {
    return json(400, { message: 'Use a photo under 2.5 MB. The page prepares a JPEG before upload.' });
  }

  const { data: appointment, error: appointmentError } = await supabaseAdmin
    .from('appointment_bookings')
    .select('id')
    .eq('id', appointmentId)
    .maybeSingle();

  if (appointmentError) {
    console.error('[EastCord job photos] Appointment lookup failed.', appointmentError.message);
    return json(500, { message: 'That installation job could not be checked.' });
  }
  if (!appointment) return json(404, { message: 'That installation job was not found.' });

  const bucketError = await ensureBucket(supabaseAdmin);
  if (bucketError) {
    console.error('[EastCord job photos] Bucket setup failed.', bucketError.message);
    return json(500, { message: 'Photo storage is not available yet.' });
  }

  const path = `${appointmentId}/${slot}.jpg`;
  const uploaded = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (uploaded.error) {
    console.error('[EastCord job photos] Upload failed.', uploaded.error.message);
    return json(500, { message: 'That photo could not be saved.' });
  }

  const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    return json(500, { message: 'The photo was saved, but it could not be shown back yet.' });
  }

  console.log(`[EastCord job photos] ${email} saved ${slot} for ${appointmentId}.`);
  return json(200, {
    message: 'Photo saved.',
    appointmentId,
    slot,
    photo: {
      url: signed.data.signedUrl,
      updatedAt: new Date().toISOString(),
    },
  });
}

async function handler(event) {
  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  try {
    if (event.httpMethod === 'GET') return await listJobs(auth.supabaseAdmin, event);
    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      if (!body) return json(400, { message: 'The photo upload could not be read.' });
      if (body.action === 'send') return await sendJobPhotos(auth.supabaseAdmin, body);
      return await savePhoto(auth.supabaseAdmin, body, auth.email);
    }
    return json(405, { message: 'Method not allowed.' });
  } catch (error) {
    console.error('[EastCord job photos] Request failed.', error.message);
    return json(500, { message: 'Installation photos could not be updated right now.' });
  }
}

module.exports = {
  handler,
  PHOTO_SLOTS,
  buildInstallationPhotoEmails,
};
