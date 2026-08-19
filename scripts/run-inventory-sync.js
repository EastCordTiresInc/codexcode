const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
    if (!match) return;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value.replace(/\\n/g, '\n');
  });
}

const root = path.join(__dirname, '..');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.netlify', '.env'));

const {
  getConfig,
  getGoogleAccessToken,
  getSheetValues,
  parseSheet,
  toInventoryRecord,
} = require('../netlify/functions/lib/google-sheets-inventory');

function trimSlash(value) {
  return value.replace(/\/+$/, '');
}

async function upsertRows(config, rows) {
  const endpoint = `${trimSlash(config.supabaseUrl)}/rest/v1/usedtireinventory?on_conflict=id`;
  for (let index = 0; index < rows.length; index += 100) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows.slice(index, index + 100).map(toInventoryRecord)),
    });
    if (!response.ok) {
      throw new Error(`Supabase upsert failed (${response.status}): ${await response.text()}`);
    }
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const config = getConfig();
  const accessToken = await getGoogleAccessToken(config);
  const values = await getSheetValues(config, accessToken);
  const parsed = parseSheet(values);
  const preview = parsed.rows.find((row) => row.id === 1) || parsed.rows[0];

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      rowsReady: parsed.rows.length,
      skippedBlankRows: parsed.skippedBlankRows,
      preview: preview && {
        id: preview.id,
        brand: preview.brand,
        tireSize: preview.tire_size,
        sellingPrice: preview.selling_price,
        currentStock: preview.current_stock,
      },
    }));
    return;
  }

  await upsertRows(config, parsed.rows);
  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    syncedRows: parsed.rows.length,
    preview: preview && {
      id: preview.id,
      brand: preview.brand,
      tireSize: preview.tire_size,
      sellingPrice: preview.selling_price,
      currentStock: preview.current_stock,
    },
    syncedAt: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }));
  process.exit(1);
});
