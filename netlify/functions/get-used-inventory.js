const { inventoryTableName, isDevInventoryTable } = require('./lib/inventory-table');

const LIVE_INVENTORY_SELECT = 'id,tire_size,rim_size,type,brand,current_stock,selling_price,drive_link,is_flotation,width,profile,wheel_size,size_label,season';
const DEV_INVENTORY_SELECT = `${LIVE_INVENTORY_SELECT},model,dot,note,price_is_final,sheet_tab,sheet_row`;

exports.handler = async function getUsedInventory(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(501, { message: 'Supabase is not configured on the server.' });
  }

  const params = new URLSearchParams();
  params.set('select', isDevInventoryTable() ? DEV_INVENTORY_SELECT : LIVE_INVENTORY_SELECT);
  params.append('order', 'brand.asc');
  params.append('order', 'tire_size.asc');

  const url = `${supabaseUrl}/rest/v1/${inventoryTableName()}?${params.toString()}`;
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    Accept: 'application/json',
  };

  try {
    const rows = await fetchAllInventoryRows(url, headers);
    return jsonResponse(200, rows);
  } catch (error) {
    return jsonResponse(502, {
      message: error.message || 'Could not reach Supabase from the server.',
    });
  }
};

async function fetchAllInventoryRows(url, headers) {
  const pageSize = 1000;
  const rows = [];

  for (let offset = 0; offset < 20000; offset += pageSize) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        Range: `${offset}-${offset + pageSize - 1}`,
      },
    });

    if (response.status === 416) break;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Inventory request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error('Unexpected inventory response format.');
    }
    if (page.length && rows.some((row) => row.id === page[0].id)) break;
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}
