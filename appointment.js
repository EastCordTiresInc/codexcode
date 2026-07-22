const serviceSelect = document.querySelector('[data-service-select]');
const startingPrice = document.querySelector('[data-starting-price]');
const depositPrice = document.querySelector('[data-deposit-price]');
const balancePrice = document.querySelector('[data-balance-price]');
const startingPriceField = document.querySelector('[data-starting-price-field]');
const depositField = document.querySelector('[data-deposit-field]');
const balanceField = document.querySelector('[data-balance-field]');
const menuToggle = document.querySelector('.menu-toggle');
const primaryNavigation = document.querySelector('#primary-navigation');

const money = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  maximumFractionDigits: 0,
});

function updateDepositSummary() {
  if (!serviceSelect) return;

  const selectedOption = serviceSelect.selectedOptions[0];
  const price = Number(selectedOption?.dataset.price || 0);
  const deposit = price * 0.2;
  const balance = price - deposit;

  if (startingPrice) startingPrice.textContent = money.format(price);
  if (depositPrice) depositPrice.textContent = money.format(deposit);
  if (balancePrice) balancePrice.textContent = money.format(balance);

  if (startingPriceField) startingPriceField.value = price.toFixed(2);
  if (depositField) depositField.value = deposit.toFixed(2);
  if (balanceField) balanceField.value = balance.toFixed(2);
}

function closeMobileMenu() {
  if (!menuToggle || !primaryNavigation) return;

  menuToggle.setAttribute('aria-expanded', 'false');
  primaryNavigation.classList.remove('is-open');
}

menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isOpen));
  primaryNavigation?.classList.toggle('is-open', !isOpen);
});

primaryNavigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', closeMobileMenu);
});

serviceSelect?.addEventListener('change', updateDepositSummary);
updateDepositSummary();
