const fs = require('fs');
const path = require('path');

if (process.platform === 'win32') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const {
  loadProjectEnv,
  pullDevInventoryRows,
  clearDevInventoryRows,
  upsertDevInventoryRows,
} = require('../netlify/functions/lib/dev-inventory-sheet');
const { getConfig } = require('../netlify/functions/lib/google-sheets-inventory');

loadProjectEnv();

async function ensureDevTable() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'usedtireinventory-dev.sql'), 'utf8');
  const config = getConfig();
  const response = await fetch(`${config.supabaseUrl.replace(/\/+$/, '')}/pg/query`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Could not create usedtireinventory_dev (${response.status}): ${detail.slice(0, 300)}`);
  }
}

(async () => {
  const rows = await pullDevInventoryRows();
  const inStock = rows.filter((row) => row.current_stock > 0).length;
  console.log(JSON.stringify({ pulled: rows.length, inStock }));
  try {
    await ensureDevTable();
    console.log('usedtireinventory_dev is ready');
  } catch (error) {
    console.warn(error.message);
  }
  await clearDevInventoryRows();
  await upsertDevInventoryRows(rows);
  console.log(JSON.stringify({ synced: rows.length }));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
