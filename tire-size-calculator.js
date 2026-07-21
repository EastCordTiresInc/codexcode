(() => {
  const MM_PER_INCH = 25.4;
  const DEFAULT_TIRE_SIZE = {
    width: 225,
    aspect: 60,
    rim: 17,
  };
  const VALID_RANGES = {
    width: { min: 125, max: 355 },
    aspect: { min: 25, max: 85 },
    rim: { min: 12, max: 24 },
  };
  const MAX_DIAMETER_DIFFERENCE = 3;
  const MAX_ALTERNATIVES = 6;

  const formatMmValue = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  };

  const formatInches = (value) => value.toFixed(2);

  const parsePositiveNumber = (input) => {
    const value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const isWithinRange = (value, range) => value >= range.min && value <= range.max;

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
      aspectRatio,
      rimInches,
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

  const readValidatedSizeFields = (scope) => {
    const width = parsePositiveNumber(scope.querySelector('[data-width]'));
    const aspect = parsePositiveNumber(scope.querySelector('[data-aspect]'));
    const rim = parsePositiveNumber(scope.querySelector('[data-rim]'));

    if (!width || !aspect || !rim) {
      return { error: 'Please enter a valid tire width, aspect ratio, and rim size.' };
    }

    if (!isWithinRange(width, VALID_RANGES.width)) {
      return { error: 'Tire width should be between 125 mm and 355 mm.' };
    }

    if (!isWithinRange(aspect, VALID_RANGES.aspect)) {
      return { error: 'Aspect ratio should be between 25 and 85.' };
    }

    if (!isWithinRange(rim, VALID_RANGES.rim)) {
      return { error: 'Rim size should be between 12 inches and 24 inches.' };
    }

    return { tireSize: calculateTireSize(width, aspect, rim) };
  };

  const setText = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (element) {
      element.textContent = value;
    }
  };

  const setInputValue = (scope, selector, value) => {
    const input = scope.querySelector(selector);
    if (input && !input.value) {
      input.value = value;
    }
  };

  const setDefaultSingleValues = (form) => {
    setInputValue(form, '[data-width]', DEFAULT_TIRE_SIZE.width);
    setInputValue(form, '[data-aspect]', DEFAULT_TIRE_SIZE.aspect);
    setInputValue(form, '[data-rim]', DEFAULT_TIRE_SIZE.rim);
  };

  const formatDiameter = (result) => `${formatInches(result.diameterInches)} in / ${formatMmValue(result.diameterMm)} mm`;
  const formatCircumference = (result) => `${formatInches(result.circumferenceInches)} in / ${formatMmValue(result.circumferenceMm)} mm`;

  const renderSingleResults = (calculator, form) => {
    const message = form.querySelector('[data-message]');
    const results = calculator.querySelector('[data-single-results]');
    const tireSize = readSizeFields(form);

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
  };

  const formatTireSizeLabel = (result) => `${result.widthMm}/${result.aspectRatio}R${result.rimInches}`;

  const getAlternativeStatus = (differencePercent) => {
    const absoluteDifference = Math.abs(differencePercent);

    if (absoluteDifference <= 1) {
      return 'Best match';
    }

    if (absoluteDifference <= 2) {
      return 'Close match';
    }

    return 'Check fitment';
  };

  const getRoundedStepStart = (value) => Math.ceil(value / 10) * 10;

  const generateAlternatives = (original) => {
    const alternatives = [];
    const widthStart = Math.max(VALID_RANGES.width.min, getRoundedStepStart(original.widthMm - 30));
    const widthEnd = Math.min(VALID_RANGES.width.max, Math.floor((original.widthMm + 30) / 10) * 10);
    const rimStart = Math.max(VALID_RANGES.rim.min, Math.floor(original.rimInches - 1));
    const rimEnd = Math.min(VALID_RANGES.rim.max, Math.ceil(original.rimInches + 2));

    for (let width = widthStart; width <= widthEnd; width += 10) {
      for (let aspect = 30; aspect <= 75; aspect += 5) {
        for (let rim = rimStart; rim <= rimEnd; rim += 1) {
          if (width === original.widthMm && aspect === original.aspectRatio && rim === original.rimInches) {
            continue;
          }

          const alternative = calculateTireSize(width, aspect, rim);
          const differencePercent = ((alternative.diameterMm - original.diameterMm) / original.diameterMm) * 100;

          if (Math.abs(differencePercent) <= MAX_DIAMETER_DIFFERENCE) {
            alternatives.push({
              ...alternative,
              differencePercent,
              actualSpeed: 100 * (alternative.diameterMm / original.diameterMm),
              status: getAlternativeStatus(differencePercent),
            });
          }
        }
      }
    }

    return alternatives
      .sort((a, b) => Math.abs(a.differencePercent) - Math.abs(b.differencePercent))
      .slice(0, MAX_ALTERNATIVES);
  };

  const renderAlternativeCard = (alternative) => {
    const differencePrefix = alternative.differencePercent > 0 ? '+' : '';

    return `
      <article class="alternative-result-card">
        <div>
          <h3>${formatTireSizeLabel(alternative)}</h3>
          <span class="alternative-status">${alternative.status}</span>
        </div>
        <dl>
          <div>
            <dt>Diameter</dt>
            <dd>${formatDiameter(alternative)}</dd>
          </div>
          <div>
            <dt>Difference</dt>
            <dd>${differencePrefix}${alternative.differencePercent.toFixed(2)}%</dd>
          </div>
          <div>
            <dt>Speedometer at 100 km/h</dt>
            <dd>${alternative.actualSpeed.toFixed(1)} km/h</dd>
          </div>
        </dl>
      </article>
    `;
  };

  const renderAlternativeResults = (calculator, form) => {
    const message = form.querySelector('[data-message]');
    const results = calculator.querySelector('[data-alternative-results]');
    const validated = readValidatedSizeFields(form);

    if (validated.error) {
      if (message) {
        message.textContent = validated.error;
      }
      if (results) {
        results.hidden = true;
        results.innerHTML = '';
      }
      return;
    }

    const alternatives = generateAlternatives(validated.tireSize);

    if (message) {
      message.textContent = alternatives.length ? '' : 'No close alternative sizes were found for this tire size.';
    }

    if (results) {
      results.hidden = !alternatives.length;
      results.innerHTML = alternatives.map(renderAlternativeCard).join('');
    }
  };

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
      setDefaultSingleValues(singleForm);
      renderSingleResults(calculator, singleForm);

      singleForm.addEventListener('submit', (event) => {
        event.preventDefault();
        renderSingleResults(calculator, singleForm);
      });
    }

    const alternativeForm = calculator.querySelector('[data-alternative-form]');
    if (alternativeForm) {
      setDefaultSingleValues(alternativeForm);
      renderAlternativeResults(calculator, alternativeForm);

      alternativeForm.addEventListener('submit', (event) => {
        event.preventDefault();
        renderAlternativeResults(calculator, alternativeForm);
      });
    }
  };

  document.querySelectorAll('[data-tire-calculator]').forEach(initCalculator);
})();
