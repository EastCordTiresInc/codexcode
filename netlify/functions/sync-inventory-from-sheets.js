const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TABLE = 'usedtireinventory';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
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

exports.handler = async function syncInventoryFromSheets(event) {
  const method = event.httpMethod || 'GET';
  const isScheduled = String(event.headers?.['x-nf-event'] || '').toLowerCase() === 'schedule';
  const dryRun = method === 'GET' || event.queryStringParameters?.dryRun === '1';

  if (!['GET', 'POST'].includes(method)) {
    return jsonResponse(405, { message: 'Use GET for a dry run or POST to sync.' });
  }

  const config = getConfig();
  const requiredConfig = [
    'googleSheetsId',
    'googleSheetsRange',
    'googleServiceAccountEmail',
    'googleServiceAccountPrivateKey',
    ...(!dryRun ? ['supabaseUrl', 'supabaseServiceRoleKey'] : []),
  ];
  const missing = requiredConfig.filter((key) => !config[key]);

  if (missing.length) {
    return jsonResponse(501, {
      message: `Missing required environment variables: ${missing.join(', ')}`,
    });
  }

  if (!dryRun && !isScheduled) {
    const suppliedSecret = event.headers?.['x-sync-secret'] || '';
    if (!config.syncSecret || !safeEqual(suppliedSecret, config.syncSecret)) {
      return jsonResponse(401, {
        message: 'A valid x-sync-secret header is required to change inventory.',
      });
    }
  }

  try {
    const accessToken = await getGoogleAccessToken(config);
    const sheetValues = await getSheetValues(config, accessToken);
    const parsed = parseSheet(sheetValues);
    const previewId = Number(event.queryStringParameters?.previewId);
    const previewRow = Number.isInteger(previewId)
      ? parsed.rows.find((row) => row.id === previewId)
      : null;

    if (previewRow) {
      console.info(
        `[EastCord sheet sync] Preview ID ${previewId}: ${previewRow.brand} ${previewRow.tire_size}, price ${previewRow.selling_price}, stock ${previewRow.current_stock}.`,
      );
    }

    if (dryRun) {
      console.info(`[EastCord sheet sync] Validation passed for ${parsed.rows.length} rows.`);
      return jsonResponse(200, {
        ok: true,
        dryRun: true,
        rowsReady: parsed.rows.length,
        skippedBlankRows: parsed.skippedBlankRows,
        columns: SYNC_COLUMNS,
        preview: previewRow
          ? {
            id: previewRow.id,
            brand: previewRow.brand,
            tireSize: previewRow.tire_size,
            sellingPrice: previewRow.selling_price,
            currentStock: previewRow.current_stock,
          }
          : null,
        message: 'Validation passed. No Supabase data was changed.',
      });
    }

    await upsertRows(config, parsed.rows);

    let deactivatedRows = 0;
    if (process.env.SYNC_DEACTIVATE_MISSING === 'true') {
      deactivatedRows = await deactivateMissingRows(config, parsed.rows.map((row) => row.id));
    }

    console.info(
      `[EastCord sheet sync] Synced ${parsed.rows.length} rows; deactivated ${deactivatedRows}.`,
    );
    return jsonResponse(200, {
      ok: true,
      dryRun: false,
      syncedRows: parsed.rows.length,
      deactivatedRows,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[EastCord sheet sync]', error);
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      message: error.message || 'Inventory sync failed.',
    });
  }
};

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
    googleSheetsRange: process.env.GOOGLE_SHEETS_RANGE || 'Inventory!A:Z',
    googleServiceAccountEmail: serviceAccountEmail,
    googleServiceAccountPrivateKey: serviceAccountPrivateKey.replace(/\\n/g, '\n'),
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    syncSecret: process.env.INVENTORY_SYNC_SECRET || '',
  };
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

async function getSheetValues(config, accessToken) {
  const url = [
    'https://sheets.googleapis.com/v4/spreadsheets/',
    encodeURIComponent(config.googleSheetsId),
    '/values/',
    encodeURIComponent(config.googleSheetsRange),
    '?majorDimension=ROWS',
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

function parseSheet(values) {
  if (!Array.isArray(values) || values.length < 2) {
    throw httpError(422, 'The configured sheet range has no inventory rows.');
  }

  const requiredHeaders = ['id', 'tiresize', 'brand'];
  const headerRowIndex = values.slice(0, 20).findIndex((row) => {
    const candidateHeaders = row.map(normalizeHeader);
    return requiredHeaders.every((header) => candidateHeaders.includes(header));
  });

  if (headerRowIndex === -1) {
    const firstRowHeaders = values[0].map(normalizeHeader).filter(Boolean);
    throw httpError(
      422,
      `Could not find a header row containing id, tire_size, and brand. First row contains: ${firstRowHeaders.join(', ') || '(blank)'}`,
    );
  }

  const headers = values[headerRowIndex].map(normalizeHeader);
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));

  if (missingHeaders.length) {
    throw httpError(422, `Missing required sheet headers: ${missingHeaders.join(', ')}`);
  }

  const rows = [];
  let skippedBlankRows = 0;

  values.slice(headerRowIndex + 1).forEach((valuesRow, index) => {
    const sheetRow = headerRowIndex + index + 2;
    const source = {};
    headers.forEach((header, columnIndex) => {
      source[header] = valuesRow[columnIndex];
    });

    if (valuesRow.every((value) => String(value ?? '').trim() === '')) {
      skippedBlankRows += 1;
      return;
    }
    if (isBlank(source.tiresize) && isBlank(source.brand)) {
      skippedBlankRows += 1;
      return;
    }

    if (isBlank(source.id)) {
      throw httpError(
        422,
        `Sheet row ${sheetRow}: id is required (tire size: ${optionalText(source.tiresize) || 'blank'}, brand: ${optionalText(source.brand) || 'blank'}).`,
      );
    }
    const id = parseInteger(source.id, 'id', sheetRow, { min: 1 });
    const openingQty = parseInteger(source.openingqty, 'opening_qty', sheetRow, { fallback: 0 });
    const addQty = parseInteger(source.addqty ?? source.add, 'add_qty', sheetRow, { fallback: 0 });
    const removeQty = parseInteger(
      source.removeqty ?? source.remove,
      'remove_qty',
      sheetRow,
      { fallback: 0 },
    );
    const currentStock = isBlank(source.currentstock)
      ? Math.max(0, openingQty + addQty - removeQty)
      : parseInteger(source.currentstock, 'current_stock', sheetRow, { min: 0 });

    const parsedRow = {
      id,
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

  const duplicateIds = findDuplicates(rows.map((row) => row.id));
  if (duplicateIds.length) {
    throw httpError(422, `Duplicate inventory IDs in sheet: ${duplicateIds.join(', ')}`);
  }

  return { rows, skippedBlankRows };
}

async function upsertRows(config, rows) {
  const endpoint = `${trimSlash(config.supabaseUrl)}/rest/v1/${TABLE}?on_conflict=id`;

  for (let index = 0; index < rows.length; index += 100) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: supabaseHeaders(config, {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(rows.slice(index, index + 100)),
    });

    if (!response.ok) {
      throw httpError(
        502,
        `Supabase upsert failed (${response.status}): ${await response.text()}`,
      );
    }
  }
}

async function deactivateMissingRows(config, activeIds) {
  const listUrl = `${trimSlash(config.supabaseUrl)}/rest/v1/${TABLE}?select=id&current_stock=gt.0`;
  const listResponse = await fetch(listUrl, { headers: supabaseHeaders(config) });

  if (!listResponse.ok) {
    throw httpError(502, `Could not check missing Supabase rows (${listResponse.status}).`);
  }

  const active = new Set(activeIds.map(String));
  const missingIds = (await listResponse.json())
    .map((row) => row.id)
    .filter((id) => !active.has(String(id)));

  if (!missingIds.length) return 0;

  const filter = missingIds.map(encodeURIComponent).join(',');
  const updateUrl = `${trimSlash(config.supabaseUrl)}/rest/v1/${TABLE}?id=in.(${filter})`;
  const updateResponse = await fetch(updateUrl, {
    method: 'PATCH',
    headers: supabaseHeaders(config, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ current_stock: 0 }),
  });

  if (!updateResponse.ok) {
    throw httpError(502, `Could not deactivate missing rows (${updateResponse.status}).`);
  }

  return missingIds.length;
}

function supabaseHeaders(config, extra = {}) {
  const headers = {
    apikey: config.supabaseServiceRoleKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
  if (config.supabaseServiceRoleKey.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${config.supabaseServiceRoleKey}`;
  }
  return headers;
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
  if (isBlank(value)) {
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
  if (isBlank(value)) return null;
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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function trimSlash(value) {
  return value.replace(/\/+$/, '');
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}
