const chatToggle = document.querySelector('[data-chat-toggle]');
const chatPanel = document.querySelector('#chat-panel');
const chatClose = document.querySelector('[data-chat-close]');
const chatForm = document.querySelector('[data-chat-form]');
const chatInput = document.querySelector('#chat-message');
const chatNote = document.querySelector('[data-chat-note]');
const quickOptions = document.querySelectorAll('.chat-options button');

// Add a live chatbot provider script here later, such as Tawk.to, Tidio, Crisp, or Chatbase.
// When a backend/provider is connected, replace the front-end-only submit handling below.

function setChatOpen(isOpen) {
  if (!chatPanel || !chatToggle) return;

  chatPanel.classList.toggle('open', isOpen);
  chatPanel.setAttribute('aria-hidden', String(!isOpen));
  chatToggle.setAttribute('aria-expanded', String(isOpen));

  if (isOpen) {
    window.setTimeout(() => chatInput?.focus(), 120);
  }
}

chatToggle?.addEventListener('click', () => {
  setChatOpen(!chatPanel?.classList.contains('open'));
});

chatClose?.addEventListener('click', () => setChatOpen(false));

quickOptions.forEach((button) => {
  button.addEventListener('click', () => {
    if (!chatInput) return;
    chatInput.value = button.textContent.trim();
    chatInput.focus();
  });
});

chatForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!chatInput?.value.trim()) return;

  if (chatNote) {
    chatNote.textContent = 'Thanks. Live chat is not connected yet, but this message box is ready for a chatbot provider.';
    chatNote.classList.add('active');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setChatOpen(false);
});
