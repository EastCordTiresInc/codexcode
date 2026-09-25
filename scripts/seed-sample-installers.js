#!/usr/bin/env node
/**
 * Posts sample installer applications to the local submit function
 * so Admin Installers has rows to review.
 */

const BASE = process.env.USER_BASE_URL || 'http://localhost:8889';

const installers = [
  {
    fullName: 'Jordan Patel',
    email: 'jordan.patel.sample@example.com',
    phone: '3655550101',
    alternatePhone: '3655550111',
    yearsExperience: '6-10 years',
    licensedTechnician: 'Yes',
    gstHstNumber: '123456789RT0001',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L5B 1M3',
    services: ['Seasonal changeover', 'Mount and balance', 'TPMS', 'New tire install', 'Used tire install'],
    vehicles: ['Passenger', 'CUV SUV', 'Light truck'],
    equipment: ['Service vehicle', 'Jack and stands', 'Torque wrench', 'Impact gun', 'TPMS tool'],
    jobsPerWeek: '11-20',
    serviceArea: 'Mississauga, Oakville, Milton',
    travelRadius: '30-50 km',
    weekdayHours: 'Mon-Fri, 7:30 AM - 6:00 PM',
    saturdayHours: '9:00 AM - 2:00 PM',
    sundayHours: 'Closed',
    afterHours: 'Limited',
    liabilityInsurance: 'Yes',
    liabilityCoverage: '$2 million+',
    wsibCoverage: 'Yes',
    referralSource: 'EastCord website',
    notes: 'Sample application for Admin Installers. Mobile van based in Mississauga.',
  },
  {
    fullName: 'Samira Khan',
    email: 'samira.khan.sample@example.com',
    phone: '4165550144',
    yearsExperience: '3-5 years',
    licensedTechnician: 'Yes',
    city: 'Brampton',
    province: 'Ontario',
    postalCode: 'L6T 3R5',
    services: ['Seasonal changeover', 'Used tire install', 'Tire repair'],
    vehicles: ['Passenger', 'CUV SUV'],
    equipment: ['Jack and stands', 'Torque wrench', 'Impact gun'],
    jobsPerWeek: '6-10',
    serviceArea: 'Brampton, Mississauga',
    travelRadius: '15-30 km',
    weekdayHours: 'Mon-Fri, 8:00 AM - 5:00 PM',
    saturdayHours: 'Closed',
    sundayHours: 'Closed',
    afterHours: 'No',
    liabilityInsurance: 'Yes',
    liabilityCoverage: '$1 million',
    wsibCoverage: 'Yes',
    referralSource: 'Referral',
    notes: 'Sample application for Admin Installers. Weekday changeovers and used-tire installs.',
  },
  {
    fullName: 'Chris Nguyen',
    email: 'chris.nguyen.sample@example.com',
    phone: '9055550188',
    alternatePhone: '9055550189',
    yearsExperience: '10+ years',
    licensedTechnician: 'Yes',
    gstHstNumber: '987654321RT0001',
    city: 'Oakville',
    province: 'Ontario',
    postalCode: 'L6H 1M4',
    services: ['Seasonal changeover', 'Mount and balance', 'TPMS', 'Tire repair', 'New tire install'],
    vehicles: ['Passenger', 'CUV SUV', 'Light truck'],
    equipment: ['Service vehicle', 'Jack and stands', 'Torque wrench', 'Impact gun', 'TPMS tool', 'Portable balancer'],
    jobsPerWeek: '20+',
    serviceArea: 'Oakville, Milton, Mississauga',
    travelRadius: '50+ km',
    weekdayHours: 'Mon-Fri, 7:00 AM - 7:00 PM',
    saturdayHours: '8:00 AM - 4:00 PM',
    sundayHours: 'By request',
    afterHours: 'Yes',
    liabilityInsurance: 'Yes',
    liabilityCoverage: '$2 million+',
    wsibCoverage: 'Yes',
    referralSource: 'EastCord website',
    notes: 'Sample application for Admin Installers. Full mobile setup with portable balancer.',
  },
  {
    fullName: 'Riley Thompson',
    email: 'riley.thompson.sample@example.com',
    phone: '2895550166',
    yearsExperience: '1-2 years',
    licensedTechnician: 'No',
    city: 'Milton',
    province: 'Ontario',
    postalCode: 'L9T 5K6',
    services: ['Seasonal changeover', 'Used tire install'],
    vehicles: ['Passenger'],
    equipment: ['Jack and stands', 'Torque wrench'],
    jobsPerWeek: '1-5',
    serviceArea: 'Milton',
    travelRadius: 'Up to 15 km',
    weekdayHours: 'Tue-Fri, 10:00 AM - 4:00 PM',
    saturdayHours: '10:00 AM - 2:00 PM',
    sundayHours: 'Closed',
    afterHours: 'No',
    liabilityInsurance: 'No',
    liabilityCoverage: 'Not sure',
    wsibCoverage: 'Not applicable',
    referralSource: 'Social media',
    notes: 'Sample application for Admin Installers. Newer tech, Milton-only, no commercial insurance yet.',
  },
  {
    fullName: 'Priya Desai',
    email: 'priya.desai.sample@example.com',
    phone: '6475550122',
    yearsExperience: '6-10 years',
    licensedTechnician: 'Yes',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L4W 2H2',
    services: ['Seasonal changeover', 'Mount and balance', 'New tire install', 'Used tire install', 'TPMS'],
    vehicles: ['Passenger', 'CUV SUV'],
    equipment: ['Service vehicle', 'Jack and stands', 'Torque wrench', 'TPMS tool'],
    jobsPerWeek: '11-20',
    serviceArea: 'Mississauga, Brampton, Oakville',
    travelRadius: '30-50 km',
    weekdayHours: 'Mon-Fri, 8:00 AM - 6:00 PM',
    saturdayHours: '9:00 AM - 1:00 PM',
    sundayHours: 'Closed',
    afterHours: 'Limited',
    liabilityInsurance: 'Yes',
    liabilityCoverage: '$1 million',
    wsibCoverage: 'Yes',
    referralSource: 'EastCord website',
    notes: 'Sample application for Admin Installers. Strong on passenger and CUV seasonal work.',
  },
];

async function main() {
  const url = `${BASE.replace(/\/$/, '')}/.netlify/functions/submit-installer-application`;
  let saved = 0;
  for (const installer of installers) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(installer),
    });
    const payload = await response.json().catch(() => ({}));
    const ok = response.ok && payload.saved;
    if (ok) saved += 1;
    console.log(
      ok ? 'saved' : 'FAIL',
      response.status,
      installer.fullName,
      payload.id || payload.message || '',
      payload.emailed ? 'emailed' : 'no-email',
    );
    if (!response.ok) {
      throw new Error(payload.message || `Submit failed for ${installer.fullName}`);
    }
  }
  console.log(`\n${saved}/${installers.length} installer applications saved for Admin Installers.`);
}

main().catch((error) => {
  console.error('\nFAIL:', error.message);
  process.exit(1);
});
