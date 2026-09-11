const form = document.querySelector('[data-installer-form]');
const status = document.querySelector('[data-installer-status]');
const submitButton = document.querySelector('[data-installer-submit]');
const SUCCESS_URL = '/installer-application-success';

if (form) {
  form.addEventListener('submit', handleInstallerSubmit);
}

async function handleInstallerSubmit(event) {
  event.preventDefault();

  if (!form.checkValidity()) {
    form.reportValidity();
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
    const body = new URLSearchParams(new FormData(form)).toString();
    const response = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`Installer form ${response.status}`);
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
      status.textContent = 'The form could not be sent. Please try again or email info@eastcordtires.ca.';
    }
  }
}
