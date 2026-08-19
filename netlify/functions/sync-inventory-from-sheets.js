const crypto = require('crypto');
const {
  SYNC_COLUMNS,
  getConfig,
  getGoogleAccessToken,
  getSheetValues,
  parseSheet,
  toInventoryRecord,
  httpError,
} = require('./lib/google-sheets-inventory');

const TABLE = 'usedtireinventory';

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

async function upsertRows(config, rows) {
  const endpoint = `${trimSlash(config.supabaseUrl)}/rest/v1/${TABLE}?on_conflict=id`;

  for (let index = 0; index < rows.length; index += 100) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: supabaseHeaders(config, {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify(rows.slice(index, index + 100).map(toInventoryRecord)),
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

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function trimSlash(value) {
  return value.replace(/\/+$/, '');
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
