const chatToggle = document.querySelector('[data-chat-toggle]');
const chatPanel = document.querySelector('#chat-panel');
const chatClose = document.querySelector('[data-chat-close]');
const chatOptions = document.querySelector('[data-chat-options]');
const chatAnswer = document.querySelector('[data-chat-answer]');

const faqItems = [
  {
    question: 'What does EastCord Tires sell?',
    answer: 'EastCord Tires offers used tires, new tires, and tire changeover/swap services for passenger vehicles.',
  },
  {
    question: 'Why choose used tires?',
    answer: 'Used tires can be a budget-friendly option when they are properly inspected and still have usable tread life.',
  },
  {
    question: 'How are used tires inspected?',
    answer: 'We check used tires for visible damage, sidewall issues, bubbles, cracks, leaks, and overall condition before sale.',
  },
  {
    question: 'What is the used tire warranty?',
    answer: 'Used tires include a 1-month exchange warranty. Original receipt is required.',
    links: [
      {
        label: 'View Warranty Policy',
        href: 'https://eastcordtires.ca/public/docs/eastcord-used-tire-warranty-policy.pdf',
        external: true,
      },
    ],
  },
  {
    question: 'How do I know my tire size?',
    answer: 'You can find your tire size on the sidewall of your tire. Example: 205/55R16.',
  },
  {
    question: 'Should I buy 1, 2, or 4 tires?',
    answer: 'It depends on your current tire condition. If one tire is damaged, one may work. If tread is uneven, a pair or full set may be better.',
  },
  {
    question: 'What is the difference between all-season, winter, and summer tires?',
    answer: 'All-season tires are for general use, winter tires are for cold/snow, and summer tires are for warmer weather.',
  },
  {
    question: 'How do I check used tire availability?',
    answer: 'Use our used tire inventory/order section or contact us with your tire size and quantity.',
    links: [
      {
        label: 'Check Used Tires',
        href: '#inventory',
      },
    ],
  },
  {
    question: 'Do you offer installation or changeover?',
    answer: 'Yes, customers can book tire changeover/swap service through our appointment booking page.',
    links: [
      {
        label: 'Book Appointment',
        href: 'https://hosted.miocommerce.com/io/eastcord-tires/booking/b95731f5-cadb-4849-877c-6238425fd25c',
        external: true,
      },
    ],
  },
  {
    question: 'How can I contact EastCord Tires?',
    answer: 'Email: info@eastcordtires.ca\nPhone: 365-822-5553',
    links: [
      {
        label: 'Email EastCord Tires',
        href: 'mailto:info@eastcordtires.ca',
      },
      {
        label: 'Call 365-822-5553',
        href: 'tel:3658225553',
      },
    ],
  },
];

function clearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createLink(link) {
  const anchor = document.createElement('a');
  anchor.className = 'chat-answer-link';
  anchor.href = link.href;
  anchor.textContent = link.label;

  if (link.external) {
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }

  return anchor;
}

function showQuestions() {
  if (!chatOptions || !chatAnswer) return;

  chatAnswer.hidden = true;
  clearElement(chatAnswer);
  chatOptions.hidden = false;
  clearElement(chatOptions);

  faqItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.question;
    button.addEventListener('click', () => showAnswer(index));
    chatOptions.appendChild(button);
  });
}

function showAnswer(index) {
  if (!chatOptions || !chatAnswer) return;

  const item = faqItems[index];
  if (!item) return;

  chatOptions.hidden = true;
  chatAnswer.hidden = false;
  clearElement(chatAnswer);

  const question = document.createElement('h3');
  question.textContent = item.question;

  const answer = document.createElement('p');
  answer.textContent = item.answer;

  const actions = document.createElement('div');
  actions.className = 'chat-answer-actions';

  (item.links || []).forEach((link) => {
    actions.appendChild(createLink(link));
  });

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'chat-back-button';
  backButton.textContent = 'Back to questions';
  backButton.addEventListener('click', showQuestions);

  chatAnswer.append(question, answer);
  if (actions.childElementCount) chatAnswer.appendChild(actions);
  chatAnswer.appendChild(backButton);
  backButton.focus();
}

function setChatOpen(isOpen) {
  if (!chatPanel || !chatToggle) return;

  chatPanel.classList.toggle('open', isOpen);
  chatPanel.setAttribute('aria-hidden', String(!isOpen));
  chatToggle.setAttribute('aria-expanded', String(isOpen));

  if (isOpen) {
    showQuestions();
    window.setTimeout(() => chatOptions?.querySelector('button')?.focus(), 120);
  }
}

function toggleChat() {
  setChatOpen(!chatPanel?.classList.contains('open'));
}

function handleChatToggleEvent(event) {
  if (!event.target.closest('[data-chat-toggle]')) return;
  event.preventDefault();
  toggleChat();
}

showQuestions();

chatToggle?.addEventListener('click', toggleChat);
chatToggle?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleChat();
  }
});

document.addEventListener('click', handleChatToggleEvent);
document.addEventListener('touchend', handleChatToggleEvent);

chatClose?.addEventListener('click', () => setChatOpen(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setChatOpen(false);
});
