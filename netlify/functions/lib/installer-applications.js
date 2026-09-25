const SELECT_FIELDS = [
  'id',
  'full_name',
  'email',
  'phone',
  'alternate_phone',
  'years_experience',
  'licensed_technician',
  'gst_hst_number',
  'city',
  'province',
  'postal_code',
  'services',
  'vehicles',
  'equipment',
  'jobs_per_week',
  'service_area',
  'travel_radius',
  'weekday_hours',
  'saturday_hours',
  'sunday_hours',
  'after_hours',
  'liability_insurance',
  'liability_coverage',
  'wsib_coverage',
  'referral_source',
  'notes',
  'work_types',
  'status',
  'staff_note',
  'reviewed_at',
  'created_at',
  'updated_at',
].join(',');

const STATUSES = ['new', 'reviewed', 'approved', 'declined'];

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || '').toLowerCase();
  return message.includes('installer_applications')
    && (message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find'));
}

function clean(value) {
  return String(value ?? '').trim();
}

function asList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => clean(item)).filter(Boolean))];
  }
  const text = clean(value);
  if (!text) return [];
  return text.split(/\s*,\s*/).map((item) => clean(item)).filter(Boolean);
}

function firstValue(body, keys) {
  for (const key of keys) {
    if (body[key] == null) continue;
    const value = Array.isArray(body[key]) ? body[key][0] : body[key];
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

function listValue(body, keys) {
  const values = [];
  keys.forEach((key) => {
    if (body[key] == null) return;
    asList(body[key]).forEach((item) => values.push(item));
  });
  return [...new Set(values)];
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function readApplicationInput(body = {}) {
  return {
    full_name: firstValue(body, ['full_name', 'fullName', 'Full Name']),
    email: firstValue(body, ['email', 'Email']).toLowerCase(),
    phone: firstValue(body, ['phone', 'Phone']),
    alternate_phone: firstValue(body, ['alternate_phone', 'alternatePhone', 'Alternate Phone']),
    years_experience: firstValue(body, ['years_experience', 'yearsExperience', 'Years of Experience']),
    licensed_technician: firstValue(body, ['licensed_technician', 'licensedTechnician', 'Licensed Technician']),
    gst_hst_number: firstValue(body, ['gst_hst_number', 'gstHstNumber', 'GST HST Number']),
    city: firstValue(body, ['city', 'City']),
    province: firstValue(body, ['province', 'Province']) || 'Ontario',
    postal_code: firstValue(body, ['postal_code', 'postalCode', 'Postal Code']),
    services: listValue(body, ['services', 'Services']),
    vehicles: listValue(body, ['vehicles', 'Vehicles']),
    equipment: listValue(body, ['equipment', 'Equipment']),
    jobs_per_week: firstValue(body, ['jobs_per_week', 'jobsPerWeek', 'Jobs Per Week']),
    service_area: firstValue(body, ['service_area', 'serviceArea', 'Service Area']),
    travel_radius: firstValue(body, ['travel_radius', 'travelRadius', 'Travel Radius']),
    weekday_hours: firstValue(body, ['weekday_hours', 'weekdayHours', 'Weekday Hours']),
    saturday_hours: firstValue(body, ['saturday_hours', 'saturdayHours', 'Saturday Hours']),
    sunday_hours: firstValue(body, ['sunday_hours', 'sundayHours', 'Sunday Hours']),
    after_hours: firstValue(body, ['after_hours', 'afterHours', 'After Hours Availability']),
    liability_insurance: firstValue(body, ['liability_insurance', 'liabilityInsurance', 'Liability Insurance']),
    liability_coverage: firstValue(body, ['liability_coverage', 'liabilityCoverage', 'Liability Coverage Amount']),
    wsib_coverage: firstValue(body, ['wsib_coverage', 'wsibCoverage', 'WSIB Coverage']),
    referral_source: firstValue(body, ['referral_source', 'referralSource', 'Referral Source']),
    notes: firstValue(body, ['notes', 'Notes']),
    work_types: firstValue(body, ['work_types', 'workTypes', 'Work Types']) || 'Service calls',
  };
}

function validateApplication(input) {
  if (!input.full_name) return 'Full name is required.';
  if (!isValidEmail(input.email)) return 'A valid email address is required.';
  if (!input.phone) return 'Phone number is required.';
  if (!input.years_experience) return 'Years of experience is required.';
  if (!input.licensed_technician) return 'Licensed / Red Seal status is required.';
  if (!input.city) return 'City is required.';
  if (!input.postal_code) return 'Postal code is required.';
  if (!input.jobs_per_week) return 'Jobs per week is required.';
  if (!input.service_area) return 'Service area is required.';
  if (!input.weekday_hours) return 'Weekday hours are required.';
  if (!input.after_hours) return 'After-hours availability is required.';
  if (!input.liability_insurance) return 'Liability insurance status is required.';
  if (!input.wsib_coverage) return 'WSIB coverage status is required.';
  if (!input.services.length) return 'Select at least one service you can perform.';
  if (!input.vehicles.length) return 'Select at least one vehicle type you can service.';
  if (!input.equipment.length) return 'Select at least one piece of equipment you travel with.';
  return '';
}

function applicationRecord(input) {
  return {
    ...input,
    updated_at: new Date().toISOString(),
  };
}

function formatList(values) {
  return asList(values).join(', ') || 'None listed';
}

function applicationText(row) {
  return [
    'New EastCord tire technician application',
    '',
    `Name: ${row.full_name}`,
    `Email: ${row.email}`,
    `Phone: ${row.phone}`,
    row.alternate_phone ? `Alternate phone: ${row.alternate_phone}` : '',
    `Experience: ${row.years_experience}`,
    `Licensed / Red Seal: ${row.licensed_technician}`,
    row.gst_hst_number ? `GST / HST: ${row.gst_hst_number}` : '',
    `Start from: ${[row.city, row.province, row.postal_code].filter(Boolean).join(', ')}`,
    `Work types: ${row.work_types || 'Service calls'}`,
    `Services: ${formatList(row.services)}`,
    `Vehicles: ${formatList(row.vehicles)}`,
    `Equipment: ${formatList(row.equipment)}`,
    `Jobs per week: ${row.jobs_per_week}`,
    `Coverage: ${row.service_area}`,
    row.travel_radius ? `Travel radius: ${row.travel_radius}` : '',
    `Weekdays: ${row.weekday_hours}`,
    row.saturday_hours ? `Saturday: ${row.saturday_hours}` : '',
    row.sunday_hours ? `Sunday: ${row.sunday_hours}` : '',
    `After hours: ${row.after_hours}`,
    `Liability insurance: ${row.liability_insurance}${row.liability_coverage ? ` (${row.liability_coverage})` : ''}`,
    `WSIB: ${row.wsib_coverage}`,
    row.referral_source ? `Heard about EastCord: ${row.referral_source}` : '',
    row.notes ? `Notes: ${row.notes}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  SELECT_FIELDS,
  STATUSES,
  isMissingTableError,
  clean,
  asList,
  readApplicationInput,
  validateApplication,
  applicationRecord,
  applicationText,
  formatList,
};
