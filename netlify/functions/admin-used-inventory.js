const { requireAdminUser } = require('./lib/admin-auth');

const INVENTORY_SELECT = [
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
  'season',
].join(',');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

function sortInventory(a, b) {
  return Number(a.id) - Number(b.id);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { message: 'Method not allowed.' });

  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  const { data, error } = await auth.supabaseAdmin
    .from('usedtireinventory')
    .select(INVENTORY_SELECT)
    .order('id', { ascending: true });

  if (error) {
    console.error('[EastCord admin] used inventory list failed.', error);
    return json(500, { message: 'Used inventory could not be loaded right now.' });
  }

  const items = (Array.isArray(data) ? data : []).slice().sort(sortInventory);
  const inStock = items.filter((item) => (Number(item.current_stock) || 0) > 0).length;

  return json(200, {
    source: 'usedtireinventory',
    count: items.length,
    inStock,
    outOfStock: items.length - inStock,
    items,
  });
};
