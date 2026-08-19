const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SYNC_COLUMNS = [
  'id',
  'tire_size',
  'rim_size',
  'type',
  'brand',
  'opening_qty',
  'add_qty',
  'remove_qty',
  'current_stock',
  'selling_price',
  'drive_link',
  'is_flotation',
];

function getConfig() {
  let serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  let serviceAccountPrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
  const credentialsPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH || '';

  if (credentialsPath) {
    try {
      const credentials = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), credentialsPath), 'utf8'),
      );
      serviceAccountEmail ||= credentials.client_email || '';
      serviceAccountPrivateKey ||= credentials.private_key || '';
    } catch (error) {
      console.warn('[EastCord sheet sync] Could not read service-account JSON.', error.message);
    }
  }

  return {
    googleSheetsId: process.env.GOOGLE_SHEETS_ID || '',
    googleSheetsRange: 'Sheet1!A:Z',
    googleServiceAccountEmail: serviceAccountEmail,
    googleServiceAccountPrivateKey: serviceAccountPrivateKey.replace(/\\n/g, '\n'),
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    syncSecret: process.env.INVENTORY_SYNC_SECRET || '',
  };
}

function missingGoogleConfig(config) {
  return [
    'googleSheetsId',
    'googleSheetsRange',
    'googleServiceAccountEmail',
    'googleServiceAccountPrivateKey',
  ].filter((key) => !config[key]);
}

async function getGoogleAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: config.googleServiceAccountEmail,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${claims}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedToken)
    .sign(config.googleServiceAccountPrivateKey);
  const assertion = `${unsignedToken}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = await response.json();

  if (!response.ok || !payload.access_token) {
    throw httpError(
      502,
      payload.error_description || payload.error || 'Google service-account authentication failed.',
    );
  }

  return payload.access_token;
}

async function getSheetValues(config, accessToken, valueRenderOption = 'FORMATTED_VALUE') {
  const url = [
    'https://sheets.googleapis.com/v4/spreadsheets/',
    encodeURIComponent(config.googleSheetsId),
    '/values/',
    encodeURIComponent(config.googleSheetsRange),
    '?majorDimension=ROWS',
    `&valueRenderOption=${encodeURIComponent(valueRenderOption)}`,
  ].join('');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw httpError(502, payload.error?.message || `Google Sheets returned ${response.status}.`);
  }

  return payload.values || [];
}

function parseSheet(values, options = {}) {
  const requireId = options.requireId !== false;
  if (!Array.isArray(values) || values.length < 2) {
    throw httpError(422, 'The configured sheet range has no inventory rows.');
  }

  const requiredHeaders = requireId ? ['id', 'tiresize', 'brand'] : ['tiresize', 'brand'];
  const headerRowIndex = values.slice(0, 20).findIndex((row) => {
    const candidateHeaders = row.map(normalizeHeader);
    return requiredHeaders.every((header) => candidateHeaders.includes(header));
  });

  if (headerRowIndex === -1) {
    const firstRowHeaders = values[0].map(normalizeHeader).filter(Boolean);
    throw httpError(
      422,
      `Could not find a header row containing ${requireId ? 'id, tire_size, and brand' : 'tire_size and brand'}. First row contains: ${firstRowHeaders.join(', ') || '(blank)'}`,
    );
  }

  const headers = values[headerRowIndex].map(normalizeHeader);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length) {
    throw httpError(422, `Missing required sheet headers: ${missingHeaders.join(', ')}`);
  }

  const columns = {
    currentStock: columnIndex(headers, 'currentstock'),
    removeQty: columnIndex(headers, 'removeqty', 'remove'),
  };

  const rows = [];
  let skippedBlankRows = 0;

  values.slice(headerRowIndex + 1).forEach((valuesRow, index) => {
    const sheetRow = headerRowIndex + index + 2;
    const source = {};
    headers.forEach((header, columnIndexValue) => {
      source[header] = valuesRow[columnIndexValue];
    });

    if (valuesRow.every((value) => String(value ?? '').trim() === '')) {
      skippedBlankRows += 1;
      return;
    }
    if (isBlank(source.tiresize) || isBlank(source.brand)) {
      skippedBlankRows += 1;
      return;
    }

    let id = null;
    if (requireId) {
      if (isBlank(source.id)) {
        throw httpError(
          422,
          `Sheet row ${sheetRow}: id is required (tire size: ${optionalText(source.tiresize) || 'blank'}, brand: ${optionalText(source.brand) || 'blank'}).`,
        );
      }
      id = parseInteger(source.id, 'id', sheetRow, { min: 1 });
    } else if (!isBlank(source.id) && /^\d+$/.test(String(source.id).trim())) {
      id = Number(String(source.id).trim());
    }
    const openingQty = parseInteger(source.openingqty, 'opening_qty', sheetRow, { fallback: 0 });
    const addQty = parseInteger(source.addqty ?? source.add, 'add_qty', sheetRow, { fallback: 0 });
    const removeQty = parseInteger(
      source.removeqty ?? source.remove,
      'remove_qty',
      sheetRow,
      { fallback: 0 },
    );
    const currentStock = isBlank(source.currentstock) || isFormula(source.currentstock)
      ? Math.max(0, openingQty + addQty - removeQty)
      : parseInteger(source.currentstock, 'current_stock', sheetRow, { min: 0 });

    const parsedRow = {
      id,
      sheetRow,
      tire_size: requiredText(source.tiresize, 'tire_size', sheetRow),
      rim_size: parseInteger(source.rimsize, 'rim_size', sheetRow, { nullable: true }),
      type: optionalText(source.type),
      brand: requiredText(source.brand, 'brand', sheetRow),
      opening_qty: openingQty,
      add_qty: addQty,
      remove_qty: removeQty,
      current_stock: currentStock,
      selling_price: parseDecimal(
        source.sellingprice ?? source.sellingpricetire,
        'selling_price',
        sheetRow,
      ),
      drive_link: optionalText(source.drivelink),
    };
    if (headers.includes('isflotation')) {
      parsedRow.is_flotation = parseBoolean(source.isflotation);
    }
    rows.push(parsedRow);
  });

  if (!rows.length) {
    throw httpError(422, 'No non-empty inventory rows were found.');
  }

  if (requireId) {
    const duplicateIds = findDuplicates(rows.map((row) => row.id));
    if (duplicateIds.length) {
      throw httpError(422, `Duplicate inventory IDs in sheet: ${duplicateIds.join(', ')}`);
    }
  }

  return { rows, skippedBlankRows, headerRowIndex, headers, columns };
}

function toInventoryRecord(row) {
  const record = {};
  SYNC_COLUMNS.forEach((column) => {
    if (Object.hasOwn(row, column)) record[column] = row[column];
  });
  return record;
}

async function applyWebsiteSalesToSheet(sales, options = {}) {
  const rewriteUnchanged = Boolean(options.rewriteUnchanged);
  const updates = (Array.isArray(sales) ? sales : [])
    .map((sale) => ({
      id: String(sale?.id ?? sale?.inventoryId ?? '').replace(/^used-tire-/i, '').trim(),
      qty: Number(sale?.qty) || 0,
      brand: String(sale?.brand || '').trim(),
      tireSize: String(sale?.tireSize || sale?.tire_size || '').trim(),
    }))
    .filter((sale) => sale.id && (rewriteUnchanged || sale.qty !== 0));

  if (!updates.length) {
    return { ok: true, updated: [], skipped: [] };
  }

  const config = getConfig();
  const missing = missingGoogleConfig(config);
  if (missing.length) {
    throw httpError(501, `Missing required environment variables: ${missing.join(', ')}`);
  }

  const accessToken = await getGoogleAccessToken(config);
  const data = [];
  const updated = [];
  const skipped = [];

  await collectStockWritesForRange({
    config,
    accessToken,
    range: config.googleSheetsRange,
    requireId: true,
    updates,
    rewriteUnchanged,
    data,
    updated,
    skipped,
  });

  if (data.length) {
    await batchUpdateSheetValues(config, accessToken, data);
  }

  return { ok: true, updated, skipped };
}

async function collectStockWritesForRange({
  config,
  accessToken,
  range,
  requireId,
  matchByBrandSize,
  updates,
  rewriteUnchanged,
  data,
  updated,
  skipped,
}) {
  const rangeConfig = { ...config, googleSheetsRange: range };
  const [computedValues, formulaValues] = await Promise.all([
    getSheetValues(rangeConfig, accessToken, 'FORMATTED_VALUE'),
    getSheetValues(rangeConfig, accessToken, 'FORMULA'),
  ]);
  const parsed = parseSheet(computedValues, { requireId });
  const sheetTitle = getSheetTitle(range);

  updates.forEach((sale) => {
    const rows = matchByBrandSize
      ? parsed.rows.filter((row) => sameTire(row, sale))
      : parsed.rows.filter((row) => String(row.id) === sale.id);

    if (!rows.length) {
      if (!matchByBrandSize) {
        skipped.push({ id: sale.id, tab: sheetTitle, reason: 'Sheet row was not found for this inventory id.' });
      }
      return;
    }

    rows.forEach((row) => {
      const write = buildStockWrite({
        sale,
        row,
        parsed,
        formulaValues,
        sheetTitle,
        rewriteUnchanged,
      });
      if (write.skip) {
        skipped.push(write.skip);
        return;
      }
      data.push(write.data);
      updated.push(write.updated);
    });
  });
}

function sameTire(row, sale) {
  return normalizeBrand(row.brand) === normalizeBrand(sale.brand)
    && normalizeSize(row.tire_size) === normalizeSize(sale.tireSize || sale.id);
}

function normalizeBrand(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSize(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildStockWrite({ sale, row, parsed, formulaValues, sheetTitle, rewriteUnchanged }) {
  const formulaCell = cellAt(formulaValues, row.sheetRow, parsed.columns.currentStock);
  const qty = rewriteUnchanged ? 0 : sale.qty;

  if (isFormula(formulaCell)) {
    if (parsed.columns.removeQty < 0) {
      return {
        skip: {
          id: sale.id,
          tab: sheetTitle,
          reason: 'Current Stock is a formula, but the sheet has no Remove column to increment.',
        },
      };
    }
    const nextRemove = Math.max(0, row.remove_qty + qty);
    return {
      data: {
        range: a1Range(sheetTitle, parsed.columns.removeQty, row.sheetRow),
        values: [[nextRemove]],
      },
      updated: {
        id: sale.id,
        tab: sheetTitle,
        field: 'remove_qty',
        sheetRow: row.sheetRow,
        from: row.remove_qty,
        to: nextRemove,
      },
    };
  }

  if (parsed.columns.currentStock < 0) {
    return {
      skip: { id: sale.id, tab: sheetTitle, reason: 'The sheet has no Current Stock column to update.' },
    };
  }

  const nextStock = Math.max(0, row.current_stock - qty);
  return {
    data: {
      range: a1Range(sheetTitle, parsed.columns.currentStock, row.sheetRow),
      values: [[nextStock]],
    },
    updated: {
      id: sale.id,
      tab: sheetTitle,
      field: 'current_stock',
      sheetRow: row.sheetRow,
      from: row.current_stock,
      to: nextStock,
    },
  };
}

async function batchUpdateSheetValues(config, accessToken, data) {
  const url = [
    'https://sheets.googleapis.com/v4/spreadsheets/',
    encodeURIComponent(config.googleSheetsId),
    '/values:batchUpdate',
  ].join('');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw httpError(
      502,
      payload.error?.message || `Google Sheets write returned ${response.status}.`,
    );
  }
}

function getSheetTitle(range) {
  const bang = String(range || '').lastIndexOf('!');
  let title = bang === -1 ? 'Inventory' : String(range).slice(0, bang);
  if (title.startsWith("'") && title.endsWith("'")) {
    title = title.slice(1, -1).replace(/''/g, "'");
  }
  return title || 'Inventory';
}

function a1Range(sheetTitle, columnIndexValue, rowNumber) {
  const quotedTitle = `'${String(sheetTitle).replace(/'/g, "''")}'`;
  return `${quotedTitle}!${columnLetter(columnIndexValue)}${rowNumber}`;
}

function columnLetter(index) {
  let n = Number(index) + 1;
  let letter = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function columnIndex(headers, ...names) {
  return names
    .map((name) => headers.indexOf(name))
    .find((index) => index >= 0) ?? -1;
}

function cellAt(values, sheetRow, columnIndexValue) {
  if (columnIndexValue < 0 || !Array.isArray(values)) return '';
  return values[sheetRow - 1]?.[columnIndexValue];
}

function isFormula(value) {
  return String(value ?? '').trim().startsWith('=');
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function requiredText(value, field, row) {
  const text = optionalText(value);
  if (!text) throw httpError(422, `Sheet row ${row}: ${field} is required.`);
  return text;
}

function optionalText(value) {
  return String(value ?? '').trim();
}

function parseInteger(value, field, row, options = {}) {
  if (isBlank(value) || isFormula(value)) {
    if (options.nullable) return null;
    if (Object.hasOwn(options, 'fallback')) return options.fallback;
    throw httpError(422, `Sheet row ${row}: ${field} is required.`);
  }

  const number = Number(String(value).replace(/,/g, ''));
  if (!Number.isInteger(number) || (options.min !== undefined && number < options.min)) {
    throw httpError(422, `Sheet row ${row}: ${field} must be a valid whole number.`);
  }
  return number;
}

function parseDecimal(value, field, row) {
  if (isBlank(value) || isFormula(value)) return null;
  const number = Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(number) || number < 0) {
    throw httpError(422, `Sheet row ${row}: ${field} must be a valid non-negative price.`);
  }
  return number;
}

function parseBoolean(value) {
  return ['true', 'yes', 'y', '1'].includes(String(value ?? '').trim().toLowerCase());
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  values.forEach((value) => {
    const key = String(value);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  });
  return [...duplicates];
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

module.exports = {
  SYNC_COLUMNS,
  getConfig,
  missingGoogleConfig,
  getGoogleAccessToken,
  getSheetValues,
  parseSheet,
  toInventoryRecord,
  applyWebsiteSalesToSheet,
  httpError,
};
