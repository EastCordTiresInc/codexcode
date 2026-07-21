(() => {
  const MM_PER_INCH = 25.4;

  const formatMmValue = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  };

  const formatInches = (value) => value.toFixed(2);

  const parsePositiveNumber = (input) => {
    const value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const calculateTireSize = (widthMm, aspectRatio, rimInches) => {
    const sidewallMm = (widthMm * aspectRatio) / 100;
    const rimMm = rimInches * MM_PER_INCH;
    const diameterMm = rimMm + 2 * sidewallMm;
    const diameterInches = diameterMm / MM_PER_INCH;
    const circumferenceMm = diameterMm * Math.PI;
    const circumferenceInches = circumferenceMm / MM_PER_INCH;
    const revsPerKm = 1000000 / circumferenceMm;

    return {
      widthMm,
      sidewallMm,
      diameterMm,
      diameterInches,
      circumferenceMm,
      circumferenceInches,
      revsPerKm,
    };
  };

  const readSizeFields = (scope) => {
    const width = parsePositiveNumber(scope.querySelector('[data-width]'));
    const aspect = parsePositiveNumber(scope.querySelector('[data-aspect]'));
    const rim = parsePositiveNumber(scope.querySelector('[data-rim]'));

    if (!width || !aspect || !rim) {
      return null;
    }

    return calculateTireSize(width, aspect, rim);
  };

  const setText = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (element) {
      element.textContent = value;
    }
  };

  const formatDiameter = (result) => `${formatInches(result.diameterInches)} in / ${formatMmValue(result.diameterMm)} mm`;
  const formatCircumference = (result) => `${formatInches(result.circumferenceInches)} in / ${formatMmValue(result.circumferenceMm)} mm`;

  const initCalculator = (calculator) => {
    const tabs = calculator.querySelectorAll('[data-calculator-tab]');
    const panels = calculator.querySelectorAll('[data-calculator-panel]');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.calculatorTab;

        tabs.forEach((item) => {
          item.classList.toggle('is-active', item === tab);
        });

        panels.forEach((panel) => {
          const isActive = panel.dataset.calculatorPanel === target;
          panel.classList.toggle('is-active', isActive);
          panel.hidden = !isActive;
        });
      });
    });

    const singleForm = calculator.querySelector('[data-single-form]');
    if (singleForm) {
      singleForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const message = singleForm.querySelector('[data-message]');
        const results = calculator.querySelector('[data-single-results]');
        const tireSize = readSizeFields(singleForm);

        if (!tireSize) {
          if (message) {
            message.textContent = 'Please enter a valid tire width, aspect ratio, and rim size.';
          }
          if (results) {
            results.hidden = true;
          }
          return;
        }

        if (message) {
          message.textContent = '';
        }
        if (results) {
          results.hidden = false;
          setText(results, '[data-section-width]', `${formatMmValue(tireSize.widthMm)} mm`);
          setText(results, '[data-sidewall]', `${formatMmValue(tireSize.sidewallMm)} mm`);
          setText(results, '[data-diameter]', formatDiameter(tireSize));
          setText(results, '[data-circumference]', formatCircumference(tireSize));
          setText(results, '[data-revs]', `${Math.round(tireSize.revsPerKm)}`);
        }
      });
    }

    const compareForm = calculator.querySelector('[data-compare-form]');
    if (compareForm) {
      compareForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const message = compareForm.querySelector('[data-message]');
        const originalGroup = compareForm.querySelector('[data-compare-size="original"]');
        const newGroup = compareForm.querySelector('[data-compare-size="new"]');
        const results = calculator.querySelector('[data-compare-results]');
        const original = originalGroup ? readSizeFields(originalGroup) : null;
        const next = newGroup ? readSizeFields(newGroup) : null;

        if (!original || !next) {
          if (message) {
            message.textContent = 'Please enter valid original and new tire sizes.';
          }
          if (results) {
            results.hidden = true;
          }
          return;
        }

        const differencePercent = ((next.diameterMm - original.diameterMm) / original.diameterMm) * 100;
        const actualSpeed = 100 * (next.diameterMm / original.diameterMm);
        const differencePrefix = differencePercent > 0 ? '+' : '';

        if (message) {
          message.textContent = '';
        }
        if (results) {
          results.hidden = false;
          setText(results, '[data-original-diameter]', formatDiameter(original));
          setText(results, '[data-new-diameter]', formatDiameter(next));
          setText(results, '[data-diameter-difference]', `${differencePrefix}${differencePercent.toFixed(2)}%`);
          setText(
            results,
            '[data-speed-note]',
            `When your speedometer reads 100 km/h, actual speed is approximately ${actualSpeed.toFixed(1)} km/h.`
          );
        }
      });
    }
  };

  document.querySelectorAll('[data-tire-calculator]').forEach(initCalculator);
})();
