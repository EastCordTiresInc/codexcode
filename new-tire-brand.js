/* Shared new-tire brand capture. Loaded by new-tires.html and required by tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EastCordNewTireBrand = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TIRE_BRANDS = [
    'BFGoodrich', 'BF Goodrich', 'Firestone', 'Bridgestone', 'Michelin', 'Goodyear',
    'Continental', 'Pirelli', 'Toyo', 'Hankook', 'Kumho', 'Nexen', 'Falken',
    'Yokohama', 'Cooper', 'General', 'Dunlop', 'Nitto', 'Ironman', 'GT Radial',
    'Uniroyal', 'Kelly', 'Mastercraft', 'Nokian', 'Sailun', 'Maxxis', 'Kenda',
    'Starfire', 'Achilles', 'Atturo', 'Vercelli', 'Thunderer', 'Primewell',
    'Ovation', 'Mirage', 'ROADBOSS', 'Roadboss', 'Lexani', 'Westlake', 'Triangle',
    'Rovelo', 'Linglong', 'Hercules', 'Sumitomo', 'Giti', 'Laufenn', 'Federal',
    'Landsail', 'Haida', 'Goodride', 'Antares', 'Radar', 'Accelera', 'Atlas',
    'Arroyo', 'Fullrun', 'Forceum', 'Milestar', 'Venom Power', 'Power King',
    'Dextero', 'Lionhart', 'Cosmo', 'Landspider', 'Superia', 'Zeetex', 'Rotalla',
    'Mazzini', 'Grenlander', 'Lanvigator', 'Aplus', 'Minerva', 'Tracmax',
    'Joyroad', 'Wanli', 'Blacklion', 'Roadstone', 'Marshal', 'Nankang', 'Zeta',
    'Ambfor', 'Goodtrip', 'Milever',
  ].slice().sort((a, b) => b.length - a.length);

  const CATEGORY_LINE = /^(performance|summer|winter|touring|all season|all weather|mud terrain|highway terrain|sport|passenger|ltr?|xl|category|win|per|perform)$/i;
  const SPEC_LABEL = /^(summary|price summary|quote|qty|quantity|warranty|category|size|speed rating|load index|sidewall|part|part #|sku|utqg|tread depth|per tire|set of|change tire|n\/a|kmh|km|order by|sort by)\b/i;
  const LOGO_STOPWORDS = /^(logo|brand|tire|tyre|tires|icon|image|sprite|header|filter|manufacturer|assets|cdn|static|media|img|png|jpg|jpeg|svg|webp)$/i;

  function isWidgetChrome(value) {
    const text = String(value || '')
      .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return true;
    if (/^(summary|price summary|quote|order|cart|your cart|details?|done|pickup|installation|tires for|filter results)$/i.test(text)) return true;
    if (/^order\s*by\b/i.test(text) || /^sort\s*by\b/i.test(text)) return true;
    return /^(revise search|change (tire|search|vehicle)|search by|search tires|price summary|see out|add to cart|place order|place your order|add to compare|powered by|tireconnect|qty|quantity|warranty|category|recommended|specs|features|reviews|sub-total|taxes|total price|per tire|touring|performance|winter|summer|all season|all weather|in stock|load more|show more|next|previous|filters?|filter results|sort by|best match|preferred date|how do you want|order by)$/i.test(text);
  }

  function cleanTireField(value) {
    if (value && typeof value === 'object') {
      return cleanTireField(value.name || value.title || value.label || value.brand_name || '');
    }
    const text = String(value || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\uE000-\uF8FF]/g, ' ')
      .replace(/found\s+\d+\s+tires(?:\s+for:?\s*)?/ig, ' ')
      .replace(/filter\s*results:?/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[:\-–]+\s*|\s*[:\-–]+$/g, '')
      .trim();
    if (!text) return '';
    return isWidgetChrome(text) ? '' : text;
  }

  function tireSizeHint(value) {
    const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
    return /(\d{3}\/\d{2}Z?R\d{2})/.test(compact) || /(\d{2}X\d{2}(?:\.\d{1,2})?R\d{2})/.test(compact);
  }

  function knownBrandIn(text) {
    const haystack = String(text || '');
    if (!haystack.trim()) return '';
    return TIRE_BRANDS.find((name) => (
      new RegExp(`(?:^|[^A-Za-z])${name.replace(/\s+/g, '[\\s_-]*')}(?:$|[^A-Za-z])`, 'i').test(haystack)
    )) || '';
  }

  function isKnownBrandName(value) {
    const text = cleanTireField(value);
    if (!text) return false;
    return TIRE_BRANDS.some((name) => name.toLowerCase() === text.toLowerCase()) || Boolean(knownBrandIn(text));
  }

  function isBadBrandCandidate(value) {
    const text = cleanTireField(value);
    if (!text) return true;
    if (/^category\b/i.test(text)) return true;
    if (/\bcategory\s+(perform|performance|win|winter|summer|tour)/i.test(text)) return true;
    if (/^order\s*by\b/i.test(text) || /^sort\s*by\b/i.test(text)) return true;
    if (SPEC_LABEL.test(text)) return true;
    if (CATEGORY_LINE.test(text)) return true;
    return false;
  }

  function sanitizeBrand(value) {
    const text = cleanTireField(value);
    if (!text || isBadBrandCandidate(text)) return '';
    return knownBrandIn(text) || text;
  }

  function brandTokenFromSegment(segment) {
    const token = String(segment || '').trim();
    if (!token || token.length < 3 || LOGO_STOPWORDS.test(token)) return '';
    const direct = TIRE_BRANDS.find((name) => (
      name.toLowerCase().replace(/\s+/g, '') === token.toLowerCase()
      || name.toLowerCase() === token.toLowerCase()
    ));
    if (direct) return direct;
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  }

  function brandFromLogoHint(text) {
    const known = knownBrandIn(text);
    if (known) return known;

    const altMatch = String(text || '').match(/\balt=["']([^"']+)["']/i);
    if (altMatch) {
      const fromAlt = sanitizeBrand(altMatch[1]) || knownBrandIn(altMatch[1]);
      if (fromAlt) return fromAlt;
    }

    const segments = String(text || '').toLowerCase().split(/[/?#&=._\-\s]+/);
    for (const segment of segments) {
      const brand = brandTokenFromSegment(segment);
      if (brand && isKnownBrandName(brand)) return knownBrandIn(brand) || brand;
    }

    const file = String(text || '').match(/(?:^|[\/._-])([a-z]{3,20})[-_]?(?:logo|brand)(?:[-_.]|\.|$)/i);
    if (!file) return '';
    const name = brandTokenFromSegment(file[1]);
    return isKnownBrandName(name) ? (knownBrandIn(name) || name) : '';
  }

  function looksLikeBrand(value) {
    const text = cleanTireField(value);
    if (!text || isBadBrandCandidate(text)) return false;
    if (isKnownBrandName(text)) return true;
    if (SPEC_LABEL.test(text) || tireSizeHint(text) || /\$/.test(text) || CATEGORY_LINE.test(text)) return false;
    if (/\bcategory\b/i.test(text)) return false;
    if (text.length < 2 || text.length > 28) return false;
    if (!/^[A-Za-z][A-Za-z0-9 .&'+-]*$/.test(text)) return false;
    const words = text.split(/\s+/);
    if (words.length > 3) return false;
    const specWords = words.filter((word) => CATEGORY_LINE.test(word) || /^(all|the|category)$/i.test(word));
    if (specWords.length >= Math.max(1, words.length - 1)) return false;
    return !/\d{2,}/.test(text);
  }

  function strongerBrand(incoming, current) {
    const next = sanitizeBrand(incoming);
    const prev = sanitizeBrand(current);
    if (isKnownBrandName(next) && isKnownBrandName(prev) && next.toLowerCase() !== prev.toLowerCase()) {
      return knownBrandIn(next) || next;
    }
    if (isKnownBrandName(next)) return knownBrandIn(next) || next;
    if (isKnownBrandName(prev)) return knownBrandIn(prev) || prev;
    if (next && prev && next.toLowerCase() !== prev.toLowerCase()) return next;
    return next || prev;
  }

  function headingBrandFrom(text) {
    const lines = String(text || '')
      .split(/\n+/)
      .map((line) => cleanTireField(line))
      .filter(Boolean);
    for (const line of lines) {
      if (SPEC_LABEL.test(line) || CATEGORY_LINE.test(line) || /\bcategory\b/i.test(line)) continue;
      if (tireSizeHint(line) || /\$/.test(line)) continue;
      if (!looksLikeBrand(line)) continue;
      return knownBrandIn(line) || line;
    }
    return '';
  }

  function isBadModelCandidate(value, brand = '') {
    const text = cleanTireField(value);
    if (!text || isWidgetChrome(text) || isBadBrandCandidate(text)) return true;
    if (SPEC_LABEL.test(text) || CATEGORY_LINE.test(text)) return true;
    if (/^order\s*by\b/i.test(text) || /^sort\s*by\b/i.test(text)) return true;
    if (tireSizeHint(text) || /\$/.test(text)) return true;
    const brandKey = sanitizeBrand(brand).toLowerCase();
    if (brandKey && text.toLowerCase() === brandKey) return true;
    return false;
  }

  function headingModelFrom(text, brand = '') {
    const lines = String(text || '')
      .split(/\n+/)
      .map((line) => cleanTireField(line))
      .filter(Boolean);
    for (const line of lines) {
      if (isBadModelCandidate(line, brand)) continue;
      if (line.length < 3 || line.length > 70) continue;
      if (!/[A-Za-z]/.test(line) || !/[A-Za-z0-9]/.test(line)) continue;
      return line;
    }
    return '';
  }

  function pickSummaryBrand(summaryText, logoHay = '') {
    const hay = `${logoHay || ''}\n${summaryText || ''}`;
    const fromLogo = sanitizeBrand(brandFromLogoHint(hay)) || sanitizeBrand(knownBrandIn(logoHay || ''));
    if (fromLogo) return fromLogo;
    const heading = sanitizeBrand(headingBrandFrom(summaryText));
    return heading || '';
  }

  function scrapeQty(text) {
    const raw = String(text || '');
    const labeled = raw.match(/(?:qty|quantity)[:\s]*(\d{1,2})/i);
    if (labeled) {
      const qty = Number(labeled[1]);
      if (qty >= 1 && qty <= 8) return qty;
    }
    const setOf = raw.match(/set of\s*(\d{1,2})/i);
    if (setOf) {
      const qty = Number(setOf[1]);
      if (qty >= 1 && qty <= 8) return qty;
    }
    return 0;
  }

  function scrapeQtyFromHash(raw) {
    const hash = String(raw || '');
    const patterns = [
      /quantities(?:\[|%5B)0(?:\]|%5D)=(\d+)/i,
      /t_qty=-?(\d+)/i,
      /t>qty=-?(\d+)/i,
    ];
    for (const pattern of patterns) {
      const qty = Number(hash.match(pattern)?.[1]);
      if (qty >= 1 && qty <= 8) return qty;
    }
    return 0;
  }

  function moneyAmount(value) {
    return Number(String(value || '').replace(/,/g, '')) || 0;
  }

  function scrapeUnitPrice(text) {
    const raw = String(text || '');
    const perTireAfter = raw.match(/per\s*tire[:\s]*\$?\s*([\d,]+\.\d{2})/i);
    if (perTireAfter) return moneyAmount(perTireAfter[1]);
    const perTireBefore = raw.match(/\$\s*([\d,]+\.\d{2})\s*per\s*tire/i);
    if (perTireBefore) return moneyAmount(perTireBefore[1]);
    const labeled = raw.match(/(?:price each|unit price)[:\s]*\$\s*([\d,]+\.\d{2})/i);
    if (labeled) return moneyAmount(labeled[1]);

    const qty = scrapeQty(raw);
    const amounts = [...raw.matchAll(/\$\s*([\d,]+\.\d{2})/g)]
      .map((match) => moneyAmount(match[1]))
      .filter((amount) => amount >= 20 && amount <= 1200);
    if (qty >= 2 && amounts.length) {
      const unit = amounts.find((value) => (
        amounts.some((other) => other !== value && Math.abs(other - value * qty) < 0.06)
      ));
      if (unit) return unit;
      const setTotal = raw.match(/set of\s*\d{1,2}[\s\S]{0,24}\$\s*([\d,]+\.\d{2})/i);
      if (setTotal) {
        const total = moneyAmount(setTotal[1]);
        if (total > 0) return Math.round((total / qty) * 100) / 100;
      }
    }
    return amounts.find((amount) => amount <= 900) || 0;
  }

  return {
    TIRE_BRANDS,
    isWidgetChrome,
    cleanTireField,
    knownBrandIn,
    isKnownBrandName,
    brandFromLogoHint,
    looksLikeBrand,
    strongerBrand,
    headingBrandFrom,
    headingModelFrom,
    pickSummaryBrand,
    isBadBrandCandidate,
    sanitizeBrand,
    scrapeQty,
    scrapeQtyFromHash,
    scrapeUnitPrice,
  };
});
