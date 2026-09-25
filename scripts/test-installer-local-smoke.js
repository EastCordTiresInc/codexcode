#!/usr/bin/env node
/**
 * Local smoke checks for the public installer form and Admin Installers.
 */

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  const text = await response.text();
  return { response, text, contentType: response.headers.get('content-type') || '' };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  return { response, payload };
}

function runUnitTests() {
  const {
    readApplicationInput,
    validateApplication,
  } = require('../netlify/functions/lib/installer-applications');

  const installer = readApplicationInput({
    fullName: 'Alex Rivera',
    email: 'alex@example.com',
    phone: '3655550100',
    yearsExperience: '3-5 years',
    licensedTechnician: 'Yes',
    city: 'Milton',
    postalCode: 'L9T 0A1',
    jobsPerWeek: '6-10',
    serviceArea: 'Milton, Oakville',
    weekdayHours: 'Mon-Fri, 8:00 AM - 6:00 PM',
    afterHours: 'Limited',
    liabilityInsurance: 'Yes',
    wsibCoverage: 'Yes',
    services: ['Seasonal changeover', 'Mount and balance'],
    vehicles: ['Passenger'],
    equipment: ['Torque wrench'],
  });

  assert(installer.full_name === 'Alex Rivera', 'installer parser should map full name');
  assert(installer.services.includes('Mount and balance'), 'installer parser should keep service checkboxes');
  assert(!validateApplication(installer), 'complete installer application should validate');
  assert(validateApplication({ ...installer, email: 'nope' }), 'invalid installer email should fail');
  assert(validateApplication({ ...installer, services: [] }), 'installer with no services should fail');
  assert(validateApplication({ ...installer, vehicles: [] }), 'installer with no vehicles should fail');
  assert(validateApplication({ ...installer, equipment: [] }), 'installer with no equipment should fail');
  console.log('PASS installer unit helpers');
}

async function runHttpTests(base) {
  const publicPage = await fetchText(`${base}/installer-application`);
  assert(publicPage.response.status === 200, `installer form expected 200, got ${publicPage.response.status}`);
  assert(publicPage.text.includes('data-installer-form'), 'installer form missing data-installer-form');
  assert(publicPage.text.includes('local-installers.js?v=7'), 'installer form missing current script');
  assert(publicPage.text.includes('data-required-group="Services"'), 'installer form missing required services group');
  assert(publicPage.text.includes('data-required-group="Vehicles"'), 'installer form missing required vehicles group');
  assert(publicPage.text.includes('data-required-group="Equipment"'), 'installer form missing required equipment group');
  console.log(`PASS ${base} public installer form`);

  const adminPage = await fetchText(`${base}/admin/installers`);
  assert(adminPage.response.status === 200, `admin installers expected 200, got ${adminPage.response.status}`);
  assert(adminPage.text.includes('data-admin-installers-form'), 'admin installers missing review form');
  assert(adminPage.text.includes('admin-installers.js?v=1'), 'admin installers missing script');
  assert(adminPage.text.includes('Public form'), 'admin installers missing public form link');
  console.log(`PASS ${base} admin installers page`);

  const formJs = await fetchText(`${base}/local-installers.js?v=7`);
  assert(formJs.response.status === 200, `installer JS expected 200, got ${formJs.response.status}`);
  assert(formJs.text.includes('submit-installer-application'), 'public installer form should post to the admin-linked function');
  assert(formJs.text.includes('data-required-group'), 'public installer JS should validate required groups');
  console.log(`PASS ${base} installer form script`);

  const incomplete = await fetchJson(`${base}/.netlify/functions/submit-installer-application`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  assert(incomplete.response.status === 400, `incomplete submit expected 400, got ${incomplete.response.status}`);
  console.log(`PASS ${base} installer submit rejects incomplete`);

  const missingGroups = await fetchJson(`${base}/.netlify/functions/submit-installer-application`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Alex Rivera',
      email: 'alex@example.com',
      phone: '3655550100',
      yearsExperience: '3-5 years',
      licensedTechnician: 'Yes',
      city: 'Milton',
      postalCode: 'L9T 0A1',
      jobsPerWeek: '6-10',
      serviceArea: 'Milton, Oakville',
      weekdayHours: 'Mon-Fri, 8:00 AM - 6:00 PM',
      afterHours: 'Limited',
      liabilityInsurance: 'Yes',
      wsibCoverage: 'Yes',
      services: [],
      vehicles: ['Passenger'],
      equipment: ['Torque wrench'],
    }),
  });
  assert(missingGroups.response.status === 400, `missing services expected 400, got ${missingGroups.response.status}`);
  assert(
    String(missingGroups.payload?.message || '').toLowerCase().includes('service'),
    `missing services should mention services, got ${missingGroups.payload?.message}`,
  );
  console.log(`PASS ${base} installer submit requires services`);

  const adminApi = await fetchJson(`${base}/.netlify/functions/admin-installer-applications`);
  assert(
    adminApi.response.status === 401 || adminApi.response.status === 403,
    `admin installer API should require auth, got ${adminApi.response.status}`,
  );
  console.log(`PASS ${base} admin installer auth gate`);
}

async function main() {
  runUnitTests();
  const bases = [
    process.env.ADMIN_BASE_URL || 'http://localhost:8888',
    process.env.USER_BASE_URL || 'http://localhost:8889',
  ];
  const unique = [...new Set(bases)];
  for (const base of unique) {
    await runHttpTests(base);
  }
  console.log('\nAll installer local smoke tests passed.');
}

main().catch((error) => {
  console.error('\nFAIL:', error.message);
  process.exit(1);
});
