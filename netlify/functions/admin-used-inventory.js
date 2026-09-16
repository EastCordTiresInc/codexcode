const { requireAdminUser } = require('./lib/admin-auth');
const {
  applyAdminInventoryUpdateToSheet,
  pullSheetInventoryRows,
} = require('./lib/google-sheets-inventory');

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
  'width',
  'profile',
  'wheel_size',
  'size_label',
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

function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (error) {
    return null;
  }
}

function parseNonNegInt(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    return { error: `${field} is required.` };
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    return { error: `${field} must be a whole number of 0 or more.` };
  }
  return { value: number };
}

function parsePrice(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') {
    return { error: 'selling_price is required.' };
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return { error: 'selling_price must be 0 or more.' };
  }
  return { value: Math.round(number * 100) / 100 };
}

async function listInventory(supabaseAdmin) {
  const { data, error } = await supabaseAdmin
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
}

async function syncFromSheet(supabaseAdmin) {
  let pulled;
  try {
    pulled = await pullSheetInventoryRows();
  } catch (error) {
    console.error('[EastCord admin] sheet pull failed.', error);
    return json(error.statusCode || 500, {
      message: error.message || 'Google Sheet could not be read.',
    });
  }

  const rows = pulled.rows.map((row) => ({
    ...row,
    updated_at: new Date().toISOString(),
  }));

  if (!rows.length) {
    return json(422, { message: 'The Google Sheet did not return any inventory rows.' });
  }

  const { error } = await supabaseAdmin
    .from('usedtireinventory')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('[EastCord admin] sheet → Supabase upsert failed.', error);
    return json(500, { message: 'Inventory could not be synced into Supabase.' });
  }

  const listed = await listInventory(supabaseAdmin);
  const payload = JSON.parse(listed.body);
  return json(200, {
    message: `Synced ${rows.length} rows from Google Sheets into Supabase.`,
    syncedRows: rows.length,
    skippedBlankRows: pulled.skippedBlankRows || 0,
    syncedAt: new Date().toISOString(),
    ...payload,
  });
}

async function updateInventory(supabaseAdmin, event) {
  const body = parseBody(event);
  if (body === null) return json(400, { message: 'Request body must be valid JSON.' });

  if (body.action === 'syncFromSheet') {
    return syncFromSheet(supabaseAdmin);
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json(400, { message: 'A valid inventory id is required.' });
  }

  const addQty = parseNonNegInt(body.add_qty, 'add_qty');
  if (addQty?.error) return json(400, { message: addQty.error });
  const removeQty = parseNonNegInt(body.remove_qty, 'remove_qty');
  if (removeQty?.error) return json(400, { message: removeQty.error });
  const currentStock = parseNonNegInt(body.current_stock, 'current_stock');
  if (currentStock?.error) return json(400, { message: currentStock.error });
  const sellingPrice = parsePrice(body.selling_price);
  if (sellingPrice?.error) return json(400, { message: sellingPrice.error });

  if (
    addQty === undefined
    && removeQty === undefined
    && currentStock === undefined
    && sellingPrice === undefined
  ) {
    return json(400, { message: 'Provide at least one field to update.' });
  }

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('usedtireinventory')
    .select(INVENTORY_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (loadError) {
    console.error('[EastCord admin] used inventory load failed.', loadError);
    return json(500, { message: 'Inventory row could not be loaded.' });
  }
  if (!existing) {
    return json(404, { message: 'Inventory row was not found.' });
  }

  const existingStock = Number(existing.current_stock) || 0;
  const addDelta = addQty?.value !== undefined ? addQty.value : 0;
  const removeDelta = removeQty?.value !== undefined ? removeQty.value : 0;
  const adjustingStock = addQty?.value !== undefined || removeQty?.value !== undefined;

  let nextStock = existingStock;
  if (currentStock?.value !== undefined) {
    nextStock = currentStock.value;
  } else if (adjustingStock) {
    nextStock = Math.max(0, existingStock + addDelta - removeDelta);
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (adjustingStock) {
    // Apply Add/Remove into current stock, then clear the counters for the next edit.
    payload.current_stock = nextStock;
    payload.add_qty = 0;
    payload.remove_qty = 0;
    payload.opening_qty = nextStock;
  } else if (currentStock?.value !== undefined) {
    payload.current_stock = nextStock;
  }

  if (sellingPrice?.value !== undefined) {
    payload.selling_price = sellingPrice.value;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('usedtireinventory')
    .update(payload)
    .eq('id', id)
    .select(INVENTORY_SELECT)
    .maybeSingle();

  if (updateError) {
    console.error('[EastCord admin] used inventory update failed.', updateError);
    return json(500, { message: 'Inventory could not be updated right now.' });
  }

  if (!updated) {
    return json(500, { message: 'Inventory update did not return the saved row.' });
  }

  let sheetSync = { ok: true, updated: [], skipped: [] };
  try {
    sheetSync = await applyAdminInventoryUpdateToSheet({
      id: updated.id,
      opening_qty: updated.opening_qty,
      add_qty: updated.add_qty,
      remove_qty: updated.remove_qty,
      current_stock: updated.current_stock,
      selling_price: updated.selling_price,
    });
  } catch (error) {
    console.error('[EastCord admin] sheet write-back failed.', error);
    sheetSync = {
      ok: false,
      skipped: [{ id: updated.id, reason: error.message || 'Google Sheets write failed.' }],
    };
  }

  return json(200, {
    message: sheetSync.ok
      ? 'Inventory updated in Supabase and Google Sheets.'
      : 'Inventory updated in Supabase. Google Sheets sync had a problem.',
    item: updated,
    sheetSync,
  });
}

exports.handler = async (event) => {
  const auth = await requireAdminUser(event);
  if (auth.error) return json(auth.error.statusCode, { message: auth.error.message });

  if (event.httpMethod === 'GET') {
    return listInventory(auth.supabaseAdmin);
  }

  if (event.httpMethod === 'PATCH' || event.httpMethod === 'POST') {
    return updateInventory(auth.supabaseAdmin, event);
  }

  return json(405, { message: 'Method not allowed.' });
};
