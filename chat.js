const chatToggle = document.querySelector('[data-chat-toggle]');
const chatPanel = document.querySelector('#chat-panel');
const chatThread = document.querySelector('[data-chat-thread]');
const chatOptions = document.querySelector('[data-chat-options]');

const inventoryLink = '#inventory';
const appointmentLink = 'https://hosted.miocommerce.com/io/eastcord-tires/booking/b95731f5-cadb-4849-877c-6238425fd25c';
const warrantyLink = 'https://eastcordtires.ca/public/docs/eastcord-used-tire-warranty-policy.pdf';

const mainOptions = [
  { label: 'Used Tires', action: 'used-tires' },
  { label: 'New Tires', action: 'new-tires' },
  { label: 'Tire Changeover / Swap', action: 'changeover' },
  { label: 'Used Tire Warranty', action: 'warranty' },
  { label: 'Tire Size Help', action: 'size-help' },
  { label: 'Contact EastCord', action: 'contact' },
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

function createActionButton({ label, action }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.chatAction = action;
  return button;
}

function renderActions(actions) {
  if (!chatOptions) return;

  clearElement(chatOptions);

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
