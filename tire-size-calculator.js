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
    rim: { min: 14, max: 24 },
  };
  const COMMON_WIDTHS = [155, 165, 175, 185, 195, 205, 215, 225, 235, 245, 255, 265, 275, 285, 295, 305, 315];
  const COMMON_ASPECT_RATIOS = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75];
  const RIM_PRIORITY_OFFSETS = [0, 1, -1, 2];
  const RESULT_LIMITS_BY_RIM_OFFSET = {
    0: 2,
    1: 3,
    '-1': 1,
    2: 1,
  };
  const MAX_DIAMETER_DIFFERENCE = 3;
  const MAX_ALTERNATIVES = 6;
  const ALTERNATIVE_GUIDANCE = 'Possible size references based on overall diameter. Always confirm vehicle fitment, rim width, load rating, speed rating, and clearance before purchase or installation.';

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
      return { error: 'Rim size should be between 14 inches and 24 inches.' };
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

  const setAlternativeInputBounds = (form) => {
    const width = form.querySelector('[data-width]');
    const aspect = form.querySelector('[data-aspect]');
    const rim = form.querySelector('[data-rim]');

    if (width) {
      width.min = VALID_RANGES.width.min;
      width.max = VALID_RANGES.width.max;
    }

    if (aspect) {
      aspect.min = VALID_RANGES.aspect.min;
      aspect.max = VALID_RANGES.aspect.max;
    }

    if (rim) {
      rim.min = VALID_RANGES.rim.min;
      rim.max = VALID_RANGES.rim.max;
    }
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
      return 'Closest diameter';
    }

    if (absoluteDifference <= 2) {
      return 'Close match';
    }

    return 'Check fitment';
  };

  const getRimPriority = (rimInches, originalRimInches) => {
    const offset = rimInches - originalRimInches;
    const index = RIM_PRIORITY_OFFSETS.indexOf(offset);
    return index === -1 ? RIM_PRIORITY_OFFSETS.length : index;
  };

  const getAllowedWidthDelta = (rimOffset) => (rimOffset === 2 ? 10 : 20);

  const createAlternativeCandidate = (original, width, aspect, rim) => {
    const rimOffset = rim - original.rimInches;
    const widthDelta = Math.abs(width - original.widthMm);

    if (width === original.widthMm && aspect === original.aspectRatio && rim === original.rimInches) {
      return null;
    }

    if (widthDelta > getAllowedWidthDelta(rimOffset)) {
      return null;
    }

    const alternative = calculateTireSize(width, aspect, rim);
    const differencePercent = ((alternative.diameterMm - original.diameterMm) / original.diameterMm) * 100;

    if (Math.abs(differencePercent) > MAX_DIAMETER_DIFFERENCE) {
      return null;
    }

    return {
      ...alternative,
      differencePercent,
      actualSpeed: 100 * (alternative.diameterMm / original.diameterMm),
      status: getAlternativeStatus(differencePercent),
      rimOffset,
      rimPriority: getRimPriority(rim, original.rimInches),
      widthDelta,
    };
  };

  const sortPracticalAlternatives = (a, b) => {
    if (a.rimPriority !== b.rimPriority) {
      return a.rimPriority - b.rimPriority;
    }

    if (a.widthDelta !== b.widthDelta) {
      return a.widthDelta - b.widthDelta;
    }

    return Math.abs(a.differencePercent) - Math.abs(b.differencePercent);
  };

  const generateAlternatives = (original) => {
    const groupedAlternatives = new Map();
    const candidateRims = RIM_PRIORITY_OFFSETS
      .map((offset) => original.rimInches + offset)
      .filter((rim, index, rims) => rim >= VALID_RANGES.rim.min && rim <= VALID_RANGES.rim.max && rims.indexOf(rim) === index);

    candidateRims.forEach((rim) => {
      COMMON_WIDTHS.forEach((width) => {
        COMMON_ASPECT_RATIOS.forEach((aspect) => {
          const alternative = createAlternativeCandidate(original, width, aspect, rim);

          if (!alternative) {
            return;
          }

          const rimGroup = groupedAlternatives.get(alternative.rimOffset) || [];
          rimGroup.push(alternative);
          groupedAlternatives.set(alternative.rimOffset, rimGroup);
        });
      });
    });

    const selected = [];

    RIM_PRIORITY_OFFSETS.forEach((offset) => {
      const rimGroup = groupedAlternatives.get(offset) || [];
      const practicalLimit = RESULT_LIMITS_BY_RIM_OFFSET[offset] || 1;
      const sortedGroup = rimGroup.sort(sortPracticalAlternatives);

      sortedGroup.slice(0, practicalLimit).forEach((alternative) => {
        if (selected.length < MAX_ALTERNATIVES) {
          selected.push(alternative);
        }
      });
    });

    return selected.slice(0, MAX_ALTERNATIVES);
  };

  const renderAlternativeCard = (alternative) => {
    const differencePrefix = alternative.differencePercent > 0 ? '+' : '';

    return `
      <article class="alternative-result-card">
        <div>
          <h3>${formatTireSizeLabel(alternative)}</h3>
          <span class="alternative-status">${alternative.status}</span>
          <span class="alternative-fitment-note">Confirm fitment</span>
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
      message.textContent = alternatives.length ? '' : 'No close common passenger tire size references were found for this size.';
    }

    if (results) {
      results.hidden = !alternatives.length;
      results.innerHTML = alternatives.length
        ? `<p class="alternative-guidance-note">${ALTERNATIVE_GUIDANCE}</p>${alternatives.map(renderAlternativeCard).join('')}`
        : '';
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
      setAlternativeInputBounds(alternativeForm);
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
