(function (root) {
  const MIN_LENGTH = 8;
  const NUMBER_RE = /\d/;

  function evaluatePassword(value) {
    const password = String(value || '');
    const hasMinLength = password.length >= MIN_LENGTH;
    const hasNumber = NUMBER_RE.test(password);
    const hasLetter = /[A-Za-z]/.test(password);
    const mixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
    const hasSymbol = /[^A-Za-z0-9]/.test(password);
    const requiredOk = hasMinLength && hasNumber;

    let score = 0;
    if (password.length > 0) score += 1;
    if (hasMinLength) score += 1;
    if (hasNumber) score += 1;
    if (hasLetter && (mixedCase || hasSymbol || password.length >= 12)) score += 1;
    score = Math.min(4, score);

    let label = 'Use at least 8 characters and a number.';
    if (!password) label = 'Use at least 8 characters and a number.';
    else if (!hasMinLength) label = 'Too weak — use at least 8 characters.';
    else if (!hasNumber) label = 'Add a number to continue.';
    else if (score >= 4) label = 'Strong password.';
    else if (score >= 3) label = 'Good password.';
    else label = 'Fair password.';

    const message = requiredOk
      ? ''
      : 'Password must be at least 8 characters and include a number.';

    return {
      password,
      hasMinLength,
      hasNumber,
      requiredOk,
      score,
      label,
      message,
      percent: password ? Math.max(12, score * 25) : 0,
      tone: !password ? '' : !requiredOk ? 'weak' : score >= 4 ? 'strong' : score >= 3 ? 'good' : 'fair',
    };
  }

  function bindPasswordStrength(input, root) {
    if (!input || !root) return;
    const fill = root.querySelector('[data-password-strength-fill]');
    const label = root.querySelector('[data-password-strength-label]');

    function render() {
      const result = evaluatePassword(input.value);
      root.classList.remove('is-weak', 'is-fair', 'is-good', 'is-strong');
      if (result.tone) root.classList.add(`is-${result.tone}`);
      if (fill) fill.style.width = `${result.percent}%`;
      if (label) label.textContent = result.label;
      input.setCustomValidity(result.requiredOk || !input.value ? '' : result.message);
    }

    input.addEventListener('input', render);
    input.addEventListener('blur', render);
    render();
  }

  function initializePasswordStrength() {
    document.querySelectorAll('[data-password-strength]').forEach((root) => {
      const input = document.getElementById(root.getAttribute('data-for') || '');
      bindPasswordStrength(input, root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePasswordStrength, { once: true });
  } else {
    initializePasswordStrength();
  }

  root.EastCordPassword = {
    MIN_LENGTH,
    evaluatePassword,
    bindPasswordStrength,
  };
})(window);
