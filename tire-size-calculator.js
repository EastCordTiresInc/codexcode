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
  const WHEEL_FILTERS = [
    { key: 'same', label: 'Same Wheel' },
    { key: '16', label: '16"', rim: 16 },
    { key: '17', label: '17"', rim: 17 },
    { key: '18', label: '18"', rim: 18 },
    { key: '19', label: '19"', rim: 19 },
  ];
  const MAX_DIAMETER_DIFFERENCE = 3;
  const MAX_TABLE_ROWS = 8;
  const ALTERNATIVE_TAB_LABEL = 'Size References';
  const ALTERNATIVE_HEADING = 'Possible Alternative Size References';
  const ALTERNATIVE_GUIDANCE = 'These are possible size references based on overall diameter. Always confirm vehicle fitment, rim width, load rating, speed rating, and clearance before purchase or installation.';
  const DIAMETER_FITMENT_NOTE = 'Closest diameter does not guarantee fitment. Rim width, load rating, speed rating, brake clearance, suspension clearance, and vehicle manufacturer recommendations must be confirmed.';
  const ALTERNATIVE_DISCLAIMER = 'These sizes are for general guidance only. Tire fitment also depends on rim width, load rating, speed rating, brake clearance, suspension clearance, and vehicle manufacturer recommendations.';

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

  const setAlternativeCopy = (calculator) => {
    setText(calculator, '[data-calculator-tab="alternative"]', ALTERNATIVE_TAB_LABEL);
    setText(calculator, '[data-alternative-form] h3', ALTERNATIVE_HEADING);
    setText(calculator, '.alternative-intro', ALTERNATIVE_GUIDANCE);
    setText(calculator, '.alternative-safety-note', ALTERNATIVE_DISCLAIMER);
  };

  const formatDiameter = (result) => `${formatInches(result.diameterInches)} in / ${formatMmValue(result.diameterMm)} mm`;
  const formatCircumference = (result) => `${formatInches(result.circumferenceInches)} in / ${formatMmValue(result.circumferenceMm)} mm`;
  const formatTableDiameter = (result) => `${formatInches(result.diameterInches)} in`;
  const formatSectionWidthInches = (result) => `${(result.widthMm / MM_PER_INCH).toFixed(1)} in`;
  const formatWheel = (result) => `${result.rimInches}"`;
  const formatWidthChange = (reference) => {
    if (reference.widthDelta === 0) {
      return 'Same width';
    }

    const direction = reference.widthChange > 0 ? 'wider' : 'narrower';
    const prefix = reference.widthChange > 0 ? '+' : '-';
    return `${prefix}${Math.abs(reference.widthChange)} mm ${direction}`;
  };

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
      return 'Closest diameter only';
    }

    if (absoluteDifference <= 2) {
      return 'Close match';
    }

    return 'Check fitment';
  };

  const getAllowedWidthDelta = (rimOffset) => {
    if (rimOffset === 0) {
      return 20;
    }

    if (rimOffset === 2 || rimOffset === -2) {
      return 10;
    }

    return 30;
  };

  const getWidthPriority = (widthDelta) => {
    if (widthDelta <= 10) {
      return 0;
    }

    if (widthDelta <= 20) {
      return 1;
    }

    return 2;
  };

  const getWheelPriority = (rimOffset) => {
    if (rimOffset === 0) {
      return 0;
    }

    if (rimOffset === 1) {
      return 1;
    }

    if (rimOffset === -1) {
      return 2;
    }

    if (rimOffset === 2) {
      return 3;
    }

    return 4;
  };

  const createAlternativeCandidate = (original, width, aspect, rim) => {
    const rimOffset = rim - original.rimInches;
    const widthChange = width - original.widthMm;
    const widthDelta = Math.abs(widthChange);
    const alternative = calculateTireSize(width, aspect, rim);
    const isOriginal = width === original.widthMm && aspect === original.aspectRatio && rim === original.rimInches;
    const differencePercent = isOriginal ? 0 : ((alternative.diameterMm - original.diameterMm) / original.diameterMm) * 100;

    if (!isOriginal && widthDelta > getAllowedWidthDelta(rimOffset)) {
      return null;
    }

    if (!isOriginal && Math.abs(differencePercent) > MAX_DIAMETER_DIFFERENCE) {
      return null;
    }

    return {
      ...alternative,
      differencePercent,
      actualSpeed: 100 * (alternative.diameterMm / original.diameterMm),
      status: isOriginal ? 'Original size' : getAlternativeStatus(differencePercent),
      isOriginal,
      widthChange,
      widthDelta,
      widthPriority: getWidthPriority(widthDelta),
      wheelPriority: getWheelPriority(rimOffset),
    };
  };

  const sortTableReferences = (a, b) => {
    if (a.isOriginal !== b.isOriginal) {
      return a.isOriginal ? -1 : 1;
    }

    const wheelCompare = a.wheelPriority - b.wheelPriority;
    if (wheelCompare !== 0) {
      return wheelCompare;
    }

    const widthPriorityCompare = a.widthPriority - b.widthPriority;
    if (widthPriorityCompare !== 0) {
      return widthPriorityCompare;
    }

    const widthDeltaCompare = a.widthDelta - b.widthDelta;
    if (widthDeltaCompare !== 0) {
      return widthDeltaCompare;
    }

    const differenceCompare = Math.abs(a.differencePercent) - Math.abs(b.differencePercent);
    if (differenceCompare !== 0) {
      return differenceCompare;
    }

    return a.widthChange - b.widthChange;
  };

  const getWheelFilterRim = (filterKey, original) => (filterKey === 'same' ? original.rimInches : Number(filterKey));

  const getDefaultWheelFilter = (results) => {
    const sameWheel = results.querySelector('[data-wheel-filter="same"]');
    const activeWheel = results.querySelector('[data-wheel-filter].is-active');

    if (activeWheel) {
      return activeWheel.dataset.wheelFilter;
    }

    return sameWheel ? 'same' : WHEEL_FILTERS[0].key;
  };

  const getTableReferences = (original, filterKey) => {
    const rim = getWheelFilterRim(filterKey, original);
    const references = [];

    COMMON_WIDTHS.forEach((width) => {
      COMMON_ASPECT_RATIOS.forEach((aspect) => {
        const candidate = createAlternativeCandidate(original, width, aspect, rim);

        if (candidate) {
          references.push(candidate);
        }
      });
    });

    return references.sort(sortTableReferences).slice(0, MAX_TABLE_ROWS);
  };

  const renderWheelTabs = (activeFilterKey) => `
    <div class="wheel-filter-tabs" aria-label="Wheel size result filters">
      ${WHEEL_FILTERS.map((filter) => `
        <button
          class="wheel-filter-tab${filter.key === activeFilterKey ? ' is-active' : ''}"
          type="button"
          data-wheel-filter="${filter.key}"
        >${filter.label}</button>
      `).join('')}
    </div>
  `;

  const renderStatusBadges = (reference) => {
    const confirmBadge = reference.isOriginal ? '' : '<span class="alternative-fitment-note">Confirm fitment</span>';

    return `
      <span class="alternative-status${reference.isOriginal ? ' original-status' : ''}">${reference.status}</span>
      ${confirmBadge}
    `;
  };

  const renderTableRows = (references) => {
    const firstPracticalReference = references.find((reference) => !reference.isOriginal) || null;

    return references.map((reference) => {
      const differencePrefix = reference.differencePercent > 0 ? '+' : '';
      const rowClasses = [
        reference.isOriginal ? 'is-original-size' : '',
        firstPracticalReference === reference ? 'is-closest-size' : '',
      ].filter(Boolean).join(' ');

      return `
        <tr class="${rowClasses}">
          <td data-label="Size">
            <strong>${formatTireSizeLabel(reference)}</strong>
            <span class="table-badge-wrap">${renderStatusBadges(reference)}</span>
          </td>
          <td data-label="Difference">${differencePrefix}${reference.differencePercent.toFixed(2)}%</td>
          <td data-label="Diameter">${formatTableDiameter(reference)}</td>
          <td data-label="Width">${formatSectionWidthInches(reference)}</td>
          <td data-label="Width Change">${formatWidthChange(reference)}</td>
          <td data-label="Wheel">${formatWheel(reference)}</td>
          <td data-label="Speedometer at 100 km/h">${reference.actualSpeed.toFixed(1)} km/h</td>
        </tr>
      `;
    }).join('');
  };

  const renderReferenceTable = (references) => {
    if (!references.length) {
      return '<p class="alternative-empty-state">No close common passenger tire size references were found for this wheel size.</p>';
    }

    return `
      <p class="alternative-fitment-warning">${DIAMETER_FITMENT_NOTE}</p>
      <div class="alternative-table-wrap">
        <table class="alternative-size-table">
          <thead>
            <tr>
              <th scope="col">Size</th>
              <th scope="col">Difference</th>
              <th scope="col">Diameter</th>
              <th scope="col">Width</th>
              <th scope="col">Width Change</th>
              <th scope="col">Wheel</th>
              <th scope="col">Speedometer at 100 km/h</th>
            </tr>
          </thead>
          <tbody>${renderTableRows(references)}</tbody>
        </table>
      </div>
    `;
  };

  const renderAlternativeResults = (calculator, form, preferredFilterKey = null) => {
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

    if (message) {
      message.textContent = '';
    }

    if (results) {
      const activeFilterKey = preferredFilterKey || getDefaultWheelFilter(results);
      const references = getTableReferences(validated.tireSize, activeFilterKey);

      results.hidden = false;
      results.innerHTML = `
        <p class="alternative-guidance-note">${ALTERNATIVE_GUIDANCE}</p>
        ${renderWheelTabs(activeFilterKey)}
        ${renderReferenceTable(references)}
      `;
    }
  };

  const initCalculator = (calculator) => {
    const tabs = calculator.querySelectorAll('[data-calculator-tab]');
    const panels = calculator.querySelectorAll('[data-calculator-panel]');

    setAlternativeCopy(calculator);

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
    const alternativeResults = calculator.querySelector('[data-alternative-results]');

    if (alternativeForm) {
      setAlternativeInputBounds(alternativeForm);
      setDefaultSingleValues(alternativeForm);
      renderAlternativeResults(calculator, alternativeForm, 'same');

      alternativeForm.addEventListener('submit', (event) => {
        event.preventDefault();
        renderAlternativeResults(calculator, alternativeForm, 'same');
      });
    }

    if (alternativeResults && alternativeForm) {
      alternativeResults.addEventListener('click', (event) => {
        const wheelFilter = event.target.closest('[data-wheel-filter]');

        if (!wheelFilter) {
          return;
        }

        renderAlternativeResults(calculator, alternativeForm, wheelFilter.dataset.wheelFilter);
      });
    }
  };

  document.querySelectorAll('[data-tire-calculator]').forEach(initCalculator);
})();
