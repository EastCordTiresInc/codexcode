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
  applyWebsiteSalesToSheet,
} = require('../netlify/functions/lib/google-sheets-inventory');

async function main() {
  const readOnly = process.argv.includes('--read-only');
  const config = getConfig();
  const accessToken = await getGoogleAccessToken(config);
  const values = await getSheetValues(config, accessToken);
  const parsed = parseSheet(values);
  const row = parsed.rows.find((candidate) => candidate.current_stock > 0) || parsed.rows[0];
  if (!row) {
    throw new Error('No inventory rows found in the sheet.');
  }

  if (readOnly) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      rowsReady: parsed.rows.length,
      skippedBlankRows: parsed.skippedBlankRows,
      preview: {
        id: row.id,
        brand: row.brand,
        tireSize: row.tire_size,
        currentStock: row.current_stock,
      },
    }));
    return;
  }

  const result = await applyWebsiteSalesToSheet([{ id: row.id, qty: 0 }], {
    rewriteUnchanged: true,
  });

  console.log(JSON.stringify({
    ok: result.ok,
    probeId: row.id,
    brand: row.brand,
    tireSize: row.tire_size,
    updated: result.updated,
    skipped: result.skipped,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    statusCode: error.statusCode || 500,
  }));
  process.exit(1);
});
