const fs = require('fs');
const path = require('path');
const {
  getConfig,
  getGoogleAccessToken,
  httpError,
} = require('./google-sheets-inventory');

const DEV_TABLE = 'usedtireinventory_dev';
const DEV_SPREADSHEET_ID = '1XT8rJkLNrfAz4Ud4M3DBa116JFABN0dQk2ZhCNPTJLw';

function devSpreadsheetId() {
  return String(process.env.GOOGLE_SHEETS_DEV_ID || DEV_SPREADSHEET_ID).trim();
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function headerIndex(headers, ...names) {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const index = normalized.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function cell(row, index) {
  if (index < 0) return '';
  return String(row?.[index] ?? '').trim();
}

function parsePrice(value) {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function parseStock(value) {
  const match = String(value || '').match(/\d+/);
  if (!match) return 0;
  return Math.max(0, Number(match[0]) || 0);
}

function normalizeSeason(value) {
  const season = String(value || '').trim().toLowerCase();
  if (!season) return '';
  if (season === 'as' || season === 'a/s' || season.includes('all season') || season.includes('all-season') || season.includes('terrain') || season === 'at') {
    return 'all-season';
  }
  if (season === 'w' || season.includes('winter')) return 'winter';
  if (season === 's' || season.includes('summer')) return 'summer';
  if (season.includes('all')) return 'all-season';
  return season;
}

function parseTireSize(size) {
  const value = String(size || '').trim();
  const standard = value.match(/(\d{3})\s*[/\-]\s*(\d{2})\s*[rR]?\s*(\d{2})/);
  if (standard) {
    return {
      width: standard[1],
      profile: standard[2],
      rim: standard[3],
      label: `${standard[1]}/${standard[2]}R${standard[3]}`,
      isFlotation: false,
    };
  }
  const flotation = value.match(/(\d{2}(?:\.\d+)?)\s*[xX]\s*(\d{2}(?:\.\d+)?)\s*[rR]?\s*(\d{2})/);
  if (flotation) {
    return {
      width: flotation[1],
      profile: flotation[2],
      rim: flotation[3],
      label: `${flotation[1]}x${flotation[2]}R${flotation[3]}`,
      isFlotation: true,
    };
  }
  return null;
}

function quoteTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let current = index + 1;
  let letters = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }
  return letters;
}

async function sheetsFetch(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, payload.error?.message || `Google Sheets returned ${response.status}.`);
  }
  return payload;
}

async function listDevTabs(accessToken) {
  const payload = await sheetsFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(devSpreadsheetId())}?fields=sheets.properties`,
  );
  return (payload.sheets || [])
    .map((sheet) => sheet.properties?.title)
    .filter(Boolean);
}

async function readTab(accessToken, title) {
  const range = `${quoteTitle(title)}!A1:N1000`;
  const payload = await sheetsFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(devSpreadsheetId())}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
  );
  return payload.values || [];
}

function parseTab(title, values) {
  if (!values.length) return [];
  const headers = values[0].map((header) => String(header || '').trim());
  const sizeIndex = headerIndex(headers, 'size');
  const brandIndex = headerIndex(headers, 'brand');
  if (sizeIndex < 0 || brandIndex < 0) return [];

  const columns = {
    model: headerIndex(headers, 'model'),
    season: headerIndex(headers, 'treadpattern', 'season'),
    dot: headerIndex(headers, 'dot'),
    stock: headerIndex(headers, 'set', 'qty'),
    price: headerIndex(headers, 'price'),
    note: headerIndex(headers, 'additionalnote', 'description', 'note'),
    category: headerIndex(headers, 'category'),
    link: headerIndex(headers, 'link', 'drivelink'),
    rim: headerIndex(headers, 'rim'),
  };

  const rows = [];
  values.slice(1).forEach((row, index) => {
    const tireSize = cell(row, sizeIndex);
    const brand = cell(row, brandIndex);
    if (!tireSize || !brand) return;
    const parsedSize = parseTireSize(tireSize);
    const rimFromTab = /^\d+$/.test(String(title)) ? Number(title) : null;
    const rimFromColumn = Number(cell(row, columns.rim));
    const rimSize = Number.isFinite(rimFromColumn) && rimFromColumn > 0
      ? rimFromColumn
      : rimFromTab;
    const sheetRow = index + 2;
    const seasonSource = cell(row, columns.season);
    rows.push({
      id: `${title}-${sheetRow}`,
      sheet_tab: String(title),
      sheet_row: sheetRow,
      tire_size: parsedSize?.label || tireSize,
      rim_size: rimSize,
      brand,
      model: cell(row, columns.model),
      type: seasonSource,
      season: normalizeSeason(seasonSource),
      dot: cell(row, columns.dot),
      current_stock: parseStock(cell(row, columns.stock)),
      selling_price: parsePrice(cell(row, columns.price)),
      price_is_final: true,
      note: cell(row, columns.note),
      category: cell(row, columns.category),
      drive_link: cell(row, columns.link),
      width: parsedSize?.width || null,
      profile: parsedSize?.profile || null,
      wheel_size: parsedSize?.rim || (rimSize ? String(rimSize) : null),
      size_label: parsedSize?.label || tireSize,
      is_flotation: Boolean(parsedSize?.isFlotation),
      updated_at: new Date().toISOString(),
    });
  });
  return rows;
}

async function pullDevInventoryRows() {
  const config = getConfig();
  const accessToken = await getGoogleAccessToken(config);
  const tabs = await listDevTabs(accessToken);
  const rows = [];
  for (const title of tabs) {
    const values = await readTab(accessToken, title);
    rows.push(...parseTab(title, values));
  }
  return rows;
}

function supabaseHeaders(config, extra = {}) {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

async function upsertDevInventoryRows(rows) {
  const config = getConfig();
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw httpError(501, 'Supabase is not configured for the development inventory sync.');
  }
  const endpoint = `${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${DEV_TABLE}?on_conflict=id`;
  for (let index = 0; index < rows.length; index += 100) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: supabaseHeaders(config, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows.slice(index, index + 100)),
    });
    if (!response.ok) {
      throw httpError(502, `Development inventory upsert failed (${response.status}): ${await response.text()}`);
    }
  }
}

async function updateDevSheetStock({ sheetTab, sheetRow, nextStock }) {
  if (!sheetTab || !sheetRow) {
    return { ok: false, skipped: true, reason: 'This development row has no sheet cell.' };
  }
  const config = getConfig();
  const accessToken = await getGoogleAccessToken(config);
  const headerValues = await readTab(accessToken, sheetTab);
  const headers = headerValues[0] || [];
  const stockIndex = headerIndex(headers, 'set', 'qty');
  if (stockIndex < 0) {
    return { ok: false, skipped: true, reason: `Tab ${sheetTab} has no Set or QTY column.` };
  }
  const range = `${quoteTitle(sheetTab)}!${columnLetter(stockIndex)}${sheetRow}`;
  await sheetsFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(devSpreadsheetId())}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[Math.max(0, Number(nextStock) || 0)]] }),
    },
  );
  return { ok: true, range };
}

function loadProjectEnv() {
  const envFile = path.join(process.cwd(), '.netlify', '.env');
  if (!fs.existsSync(envFile)) return;
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
    }
  });
}

module.exports = {
  DEV_TABLE,
  pullDevInventoryRows,
  upsertDevInventoryRows,
  updateDevSheetStock,
  loadProjectEnv,
};
