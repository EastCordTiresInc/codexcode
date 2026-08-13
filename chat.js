const chatToggle = document.querySelector('[data-chat-toggle]');
const chatPanel = document.querySelector('#chat-panel');
const chatThread = document.querySelector('[data-chat-thread]');
const chatOptions = document.querySelector('[data-chat-options]');

const inventoryLink = '/used-tires';
const appointmentLink = 'https://hosted.miocommerce.com/io/eastcord-tires/booking/b95731f5-cadb-4849-877c-6238425fd25c';
const warrantyLink = 'https://eastcordtires.ca/public/docs/eastcord-used-tire-warranty-policy.pdf';
const inquiryFormName = 'eastcord-inquiry';

const mainOptions = [
  { label: 'Used Tires', action: 'used-tires' },
  { label: 'New Tires', action: 'new-tires' },
  { label: 'Tire Changeover / Swap', action: 'changeover' },
  { label: 'Used Tire Warranty', action: 'warranty' },
  { label: 'Tire Size Help', action: 'size-help' },
  { label: 'Contact EastCord', action: 'contact' },
  { label: 'Other Inquiry', action: 'other-inquiry' },
];

let suppressNextClick = false;

function clearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function scrollThreadToBottom() {
  if (!chatThread) return;
  chatThread.scrollTop = chatThread.scrollHeight;
}

function addMessage(type, text) {
  if (!chatThread) return;

  const message = document.createElement('div');
  message.className = `chat-message ${type}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = text;

  message.appendChild(bubble);
  chatThread.appendChild(message);
  scrollThreadToBottom();
}

function createActionLink({ label, href, external }) {
  const anchor = document.createElement('a');
  anchor.className = 'chat-action-link';
  anchor.href = href;
  anchor.textContent = label;

  if (external) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }

  return anchor;
}

function createActionButton({ label, action, className }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.chatAction = action;
  if (className) button.className = className;
  return button;
}

function renderActions(actions) {
  if (!chatOptions) return;

  clearElement(chatOptions);
  chatOptions.classList.remove('form-mode');

  actions.forEach((action) => {
    if (action.href) {
      chatOptions.appendChild(createActionLink(action));
      return;
    }

    chatOptions.appendChild(createActionButton(action));
  });
}

function renderMainMenu() {
  renderActions(mainOptions);
}

function resetConversation() {
  clearElement(chatThread);
  addMessage('bot', 'Hi! Welcome to EastCord Tires 👋\nHow can we help you today?');
  renderMainMenu();
}

function addBackToMain(actions = []) {
  return [...actions, { label: 'Back to main menu', action: 'main-menu' }];
}

function showUsedTires() {
  addMessage('customer', 'Used Tires');
  addMessage(
    'bot',
    'EastCord Tires offers used tires for passenger vehicles. Used tires can be a budget-friendly option when they are properly inspected and still have usable tread life.'
  );
  renderActions(addBackToMain([
    { label: 'How are used tires inspected?', action: 'used-inspection' },
    { label: 'How do I check used tire availability?', action: 'used-availability' },
  ]));
}

function showUsedInspection() {
  addMessage('customer', 'How are used tires inspected?');
  addMessage(
    'bot',
    'We check used tires for visible damage, sidewall issues, bubbles, cracks, leaks, and overall condition before sale.'
  );
  renderActions(addBackToMain([
    { label: 'Check used tire availability', href: inventoryLink },
  ]));
}

function showUsedAvailability() {
  addMessage('customer', 'How do I check used tire availability?');
  addMessage('bot', 'Use our used tire inventory/order section or contact us with your tire size and quantity.');
  renderActions(addBackToMain([
    { label: 'Check Used Tires', href: inventoryLink },
  ]));
}

function showNewTires() {
  addMessage('customer', 'New Tires');
  addMessage('bot', 'Yes, EastCord Tires also offers new tires. You can use our new tire section to search and order available options.');
  renderActions(addBackToMain([
    { label: 'Shop New Tires', href: inventoryLink },
  ]));
}

function showChangeover() {
  addMessage('customer', 'Tire Changeover / Swap');
  addMessage('bot', 'Yes, customers can book tire changeover/swap service through our appointment booking page.');
  renderActions(addBackToMain([
    { label: 'Book Appointment', href: appointmentLink, external: true },
  ]));
}

function showWarranty() {
  addMessage('customer', 'Used Tire Warranty');
  addMessage('bot', 'Used tires include a 1-month exchange warranty. Original receipt is required.');
  renderActions(addBackToMain([
    { label: 'View Warranty Policy', href: warrantyLink, external: true },
  ]));
}

function showSizeHelp() {
  addMessage('customer', 'Tire Size Help');
  addMessage('bot', 'You can find your tire size on the sidewall of your tire. Example: 205/55R16.');
  renderActions(addBackToMain([
    { label: 'Check Used Tires', href: inventoryLink },
  ]));
}

function showContact() {
  addMessage('customer', 'Contact EastCord');
  addMessage('bot', 'You can contact EastCord Tires by email or phone.\n\nEmail: info@eastcordtires.ca\nPhone: 365-822-5553');
  renderActions(addBackToMain([
    { label: 'Email EastCord', href: 'mailto:info@eastcordtires.ca' },
    { label: 'Call 365-822-5553', href: 'tel:3658225553' },
  ]));
}

function createField({ label, name, type = 'text', required = false, autocomplete, options }) {
  const field = document.createElement('label');
  field.className = 'chat-form-field';

  const labelText = document.createElement('span');
  labelText.textContent = required ? `${label} *` : label;
  field.appendChild(labelText);

  let input;
  if (options) {
    input = document.createElement('select');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select one';
    input.appendChild(placeholder);

    options.forEach((option) => {
      const optionElement = document.createElement('option');
      optionElement.value = option;
      optionElement.textContent = option;
      input.appendChild(optionElement);
    });
  } else if (type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 4;
  } else {
    input = document.createElement('input');
    input.type = type;
  }

  input.name = name;
  input.required = required;
  if (autocomplete) input.autocomplete = autocomplete;
  field.appendChild(input);

  return field;
}

function showInquiryForm() {
  if (!chatOptions) return;

  addMessage('customer', 'Other Inquiry');
  addMessage('bot', 'Please send us your question and EastCord Tires will follow up shortly.');

  clearElement(chatOptions);
  chatOptions.classList.add('form-mode');

  const form = document.createElement('form');
  form.className = 'chat-inquiry-form';
  form.name = inquiryFormName;
  form.method = 'POST';
  form.action = '/';
  form.dataset.netlify = 'true';
  form.setAttribute('netlify-honeypot', 'bot-field');
  form.noValidate = true;

  form.innerHTML = `
    <input type="hidden" name="form-name" value="${inquiryFormName}" />
    <input type="hidden" name="subject" value="New EastCord Tires chat inquiry" />
    <p class="chat-honeypot" aria-hidden="true">
      <label>Do not fill this out <input name="bot-field" tabindex="-1" autocomplete="off" /></label>
    </p>
  `;

  const title = document.createElement('h3');
  title.textContent = 'Other Inquiry';
  form.appendChild(title);

  const error = document.createElement('p');
  error.className = 'chat-form-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.appendChild(error);

  form.append(
    createField({ label: 'Full Name', name: 'Full Name', required: true, autocomplete: 'name' }),
    createField({ label: 'Email Address', name: 'Email Address', type: 'email', required: true, autocomplete: 'email' }),
    createField({ label: 'Phone Number', name: 'Phone Number', type: 'tel', autocomplete: 'tel' }),
    createField({
      label: 'Inquiry Type',
      name: 'Inquiry Type',
      required: true,
      options: ['Used tire question', 'New tire question', 'Appointment question', 'Warranty question', 'General inquiry'],
    }),
    createField({ label: 'Message', name: 'Message', type: 'textarea', required: true })
  );

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'chat-submit-button';
  submit.textContent = 'Send Inquiry';

  const back = createActionButton({ label: 'Back to questions', action: 'main-menu', className: 'chat-secondary-button' });

  form.append(submit, back);
  chatOptions.appendChild(form);

  form.addEventListener('submit', handleInquirySubmit);
  window.setTimeout(() => form.querySelector('[name="Full Name"]')?.focus(), 120);
}

function showInquiryConfirmation() {
  clearElement(chatOptions);
  chatOptions.classList.remove('form-mode');
  addMessage('bot', 'Thank you for contacting EastCord Tires. We received your inquiry and will get back to you shortly.');
  renderActions([{ label: 'Back to questions', action: 'main-menu' }]);
}

async function handleInquirySubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const error = form.querySelector('.chat-form-error');
  const submit = form.querySelector('.chat-submit-button');

  if (!form.checkValidity()) {
    error.textContent = 'Please fill out Full Name, Email Address, Inquiry Type, and Message before sending.';
    error.hidden = false;
    form.querySelector(':invalid')?.focus();
    return;
  }

  error.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Sending...';

  try {
    const body = new URLSearchParams(new FormData(form)).toString();
    const response = await fetch(form.action || '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!response.ok) {
      throw new Error(`Netlify rejected the inquiry with status ${response.status}`);
    }

    showInquiryConfirmation();
  } catch (submissionError) {
    error.textContent = 'Sorry, the inquiry could not be sent. Please try again or email info@eastcordtires.ca.';
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Send Inquiry';
    console.error('EastCord inquiry form submission failed:', submissionError);
  }
}

function handleAction(action) {
  const actions = {
    'main-menu': resetConversation,
    'used-tires': showUsedTires,
    'used-inspection': showUsedInspection,
    'used-availability': showUsedAvailability,
    'new-tires': showNewTires,
    changeover: showChangeover,
    warranty: showWarranty,
    'size-help': showSizeHelp,
    contact: showContact,
    'other-inquiry': showInquiryForm,
  };

  actions[action]?.();
}

function setChatOpen(isOpen) {
  if (!chatPanel || !chatToggle) return;

  chatPanel.classList.toggle('open', isOpen);
  chatPanel.setAttribute('aria-hidden', String(!isOpen));
  chatToggle.setAttribute('aria-expanded', String(isOpen));

  if (isOpen) {
    resetConversation();
    window.setTimeout(() => chatOptions?.querySelector('button, a')?.focus(), 120);
  }
}

function toggleChat() {
  setChatOpen(!chatPanel?.classList.contains('open'));
}

function handleChatControlEvent(event) {
  const closeButton = event.target.closest('[data-chat-close]');
  if (closeButton) {
    event.preventDefault();
    event.stopPropagation();
    setChatOpen(false);
    return;
  }

  const toggleButton = event.target.closest('[data-chat-toggle]');
  if (!toggleButton) return;

  if (event.type === 'click' && suppressNextClick) {
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.type === 'touchend') suppressNextClick = true;

  event.preventDefault();
  event.stopPropagation();
  toggleChat();
}

function ensureFooterLegalStyles() {
  if (document.querySelector('[data-footer-legal-styles]')) return;

  const style = document.createElement('style');
  style.dataset.footerLegalStyles = 'true';
  style.textContent = `
    .footer-legal {
      width: 100%;
      margin: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      line-height: 1.6;
    }

    .footer-legal a {
      color: #a3a7ae;
      font-weight: 760;
      text-decoration: none;
      transition: color 180ms ease;
    }

    .footer-legal a:hover,
    .footer-legal a:focus-visible {
      color: #ffffff;
    }

    .footer-legal-separator {
      color: #4d5056;
    }
  `;
  document.head.appendChild(style);
}

function renderFooterLegalLinks() {
  const footerBottom = document.querySelector('.site-footer .footer-bottom');
  if (!footerBottom) return;

  ensureFooterLegalStyles();
  footerBottom.innerHTML = `
    <p class="footer-legal">
      <span>© 2026 EastCord Tires</span>
      <span class="footer-legal-separator">|</span>
      <a href="/terms-and-conditions">Terms &amp; Conditions</a>
      <span class="footer-legal-separator">|</span>
      <a href="/privacy-policy">Privacy Policy</a>
      <span class="footer-legal-separator">|</span>
      <a href="/cookie-policy">Cookie Policy</a>
      <span class="footer-legal-separator">|</span>
      <a href="/public/docs/eastcord-used-tire-warranty-policy.pdf" target="_blank" rel="noopener noreferrer">Warranty Policy</a>
    </p>
  `;
}

function ensureHomepageAccountLinks() {
  const nav = document.querySelector('.main-nav');
  if (!nav || nav.querySelector('[data-homepage-account-links]')) return;

  const links = document.createElement('span');
  links.className = 'auth-nav-group';
  links.dataset.homepageAccountLinks = 'true';
  links.innerHTML = `
    <a href="/signup.html">Sign Up</a>
    <a href="/login.html">Log In</a>
    <a href="/cart.html">Cart</a>
  `;

  nav.appendChild(links);
}

chatOptions?.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-chat-action]');
  if (!actionButton) return;
  handleAction(actionButton.dataset.chatAction);
});

chatToggle?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleChat();
  }
});

document.addEventListener('click', handleChatControlEvent, true);
document.addEventListener('touchend', handleChatControlEvent, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setChatOpen(false);
});

ensureHomepageAccountLinks();
renderFooterLegalLinks();