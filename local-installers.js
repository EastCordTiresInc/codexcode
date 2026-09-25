const form = document.querySelector('[data-installer-form]');
const status = document.querySelector('[data-installer-status]');
const submitButton = document.querySelector('[data-installer-submit]');
const SUCCESS_URL = '/installer-application-success';

if (form) {
  form.addEventListener('submit', handleInstallerSubmit);
  form.addEventListener('change', (event) => {
    const input = event.target;
    if (!input?.name || input.type !== 'checkbox') return;
    const group = input.closest('[data-required-group]');
    if (!group) return;
    const checked = form.querySelectorAll(`input[name="${input.name}"]:checked`).length;
    group.classList.toggle('is-invalid', checked === 0);
  });
}

function listValues(formData, name) {
  return formData.getAll(name).map((value) => String(value || '').trim()).filter(Boolean);
}

function readInstallerPayload(formData) {
  return {
    fullName: String(formData.get('Full Name') || '').trim(),
    email: String(formData.get('Email') || '').trim(),
    phone: String(formData.get('Phone') || '').trim(),
    alternatePhone: String(formData.get('Alternate Phone') || '').trim(),
    yearsExperience: String(formData.get('Years of Experience') || '').trim(),
    licensedTechnician: String(formData.get('Licensed Technician') || '').trim(),
    gstHstNumber: String(formData.get('GST HST Number') || '').trim(),
    city: String(formData.get('City') || '').trim(),
    province: String(formData.get('Province') || '').trim(),
    postalCode: String(formData.get('Postal Code') || '').trim(),
    services: listValues(formData, 'Services'),
    vehicles: listValues(formData, 'Vehicles'),
    equipment: listValues(formData, 'Equipment'),
    jobsPerWeek: String(formData.get('Jobs Per Week') || '').trim(),
    serviceArea: String(formData.get('Service Area') || '').trim(),
    travelRadius: String(formData.get('Travel Radius') || '').trim(),
    weekdayHours: String(formData.get('Weekday Hours') || '').trim(),
    saturdayHours: String(formData.get('Saturday Hours') || '').trim(),
    sundayHours: String(formData.get('Sunday Hours') || '').trim(),
    afterHours: String(formData.get('After Hours Availability') || '').trim(),
    liabilityInsurance: String(formData.get('Liability Insurance') || '').trim(),
    liabilityCoverage: String(formData.get('Liability Coverage Amount') || '').trim(),
    wsibCoverage: String(formData.get('WSIB Coverage') || '').trim(),
    referralSource: String(formData.get('Referral Source') || '').trim(),
    notes: String(formData.get('Notes') || '').trim(),
    workTypes: String(formData.get('Work Types') || 'Service calls').trim(),
    botField: String(formData.get('bot-field') || '').trim(),
  };
}

async function handleInstallerSubmit(event) {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const missingGroup = [...form.querySelectorAll('[data-required-group]')].find((group) => {
    const name = group.dataset.requiredGroup;
    const checked = form.querySelectorAll(`input[name="${name}"]:checked`).length;
    group.classList.toggle('is-invalid', checked === 0);
    return checked === 0;
  });
  if (missingGroup) {
    if (status) {
      status.hidden = false;
      status.textContent = 'Select at least one option in each required list: services, vehicles, and equipment.';
    }
    missingGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (status) {
    status.hidden = true;
    status.textContent = '';
  }
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
  }

  try {
    const payload = readInstallerPayload(new FormData(form));
    const response = await fetch('/.netlify/functions/submit-installer-application', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }

    if (!response.ok) {
      throw new Error(body.message || `Installer form ${response.status}`);
    }

    window.location.assign(SUCCESS_URL);
  } catch (error) {
    console.warn('[EastCord installers] Form submit failed.', error);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit';
    }
    if (status) {
      status.hidden = false;
      status.textContent = error.message || 'The form could not be sent. Please try again or email info@eastcordtires.ca.';
    }
  }
}
