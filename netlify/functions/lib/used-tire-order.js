const { applyWebsiteSalesToSheet } = require('./google-sheets-inventory');

const TAX_RATE = 0.13;

function roundMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function calculateTax(subtotal) {
  const serviceSubtotal = roundMoney(subtotal);
  const hstAmount = roundMoney(serviceSubtotal * TAX_RATE);
  const totalWithHst = roundMoney(serviceSubtotal + hstAmount);
  return {
    subtotal: serviceSubtotal,
    hstAmount,
    totalWithHst,
    taxRate: TAX_RATE,
  };
}

function getOrderItems(order) {
  return Array.isArray(order?.items) ? order.items : [];
}

function normalizeSaleItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      inventoryId: String(item.inventoryId || item.id || '').replace(/^used-tire-/i, '').trim(),
      qty: Math.max(1, Math.min(4, Number(item.qty) || 1)),
    }))
    .filter((item) => item.inventoryId);
}

async function applyUsedTireInventorySale({ supabaseAdmin, items, restore = false }) {
  const websiteUpdates = [];
  const sheetSales = [];

  for (const item of normalizeSaleItems(items)) {
    const { data: row, error: stockError } = await supabaseAdmin
      .from('usedtireinventory')
      .select('id, brand, tire_size, current_stock')
      .eq('id', item.inventoryId)
      .maybeSingle();

    if (stockError) {
      return { ok: false, statusCode: 500, message: stockError.message, error: stockError };
    }
    if (!row) {
      return { ok: false, statusCode: 404, message: `Inventory id ${item.inventoryId} was not found.` };
    }

    const currentStock = Math.max(0, Number(row.current_stock) || 0);
    const signedQty = restore ? -item.qty : item.qty;
    if (!restore && currentStock < item.qty) {
      return {
        ok: false,
        statusCode: 409,
        message: `Not enough stock for ${row.brand || 'this tire'} ${row.tire_size || ''} (have ${currentStock}, need ${item.qty}).`,
      };
    }

    const nextStock = Math.max(0, currentStock - signedQty);
    const { error: updateStockError } = await supabaseAdmin
      .from('usedtireinventory')
      .update({ current_stock: nextStock })
      .eq('id', item.inventoryId);

    if (updateStockError) {
      return { ok: false, statusCode: 500, message: updateStockError.message, error: updateStockError };
    }

    websiteUpdates.push({
      id: String(row.id),
      brand: row.brand,
      tireSize: row.tire_size,
      qty: item.qty,
      from: currentStock,
      to: nextStock,
      restore,
    });
    sheetSales.push({
      id: String(row.id),
      qty: signedQty,
      brand: row.brand,
      tireSize: row.tire_size,
    });
  }

  let sheet = { ok: true, updated: [], skipped: [], error: null };
  if (sheetSales.length) {
    try {
      const sheetResult = await applyWebsiteSalesToSheet(sheetSales);
      sheet = {
        ok: !sheetResult.skipped?.length,
        updated: sheetResult.updated || [],
        skipped: sheetResult.skipped || [],
        error: null,
      };
    } catch (error) {
      console.error('[EastCord sheet write-back] Website stock changed, but Google Sheets was not updated.', error);
      sheet = {
        ok: false,
        updated: [],
        skipped: [],
        error: error.message || 'Google Sheets stock was not updated.',
      };
    }
  }

  return { ok: true, websiteUpdates, sheet };
}

async function fulfillPaidUsedTireOrder({ supabaseAdmin, session }) {
  const sessionId = session?.id || '';
  const orderId = String(session?.metadata?.order_id || '').trim();

  let query = supabaseAdmin.from('used_tire_orders').select('*');
  if (orderId) query = query.eq('id', orderId);
  else query = query.eq('stripe_session_id', sessionId);

  const { data: order, error: loadError } = await query.maybeSingle();
  if (loadError) {
    return { ok: false, statusCode: 500, message: loadError.message, error: loadError };
  }
  if (!order) {
    return { ok: false, statusCode: 404, message: 'Used tire order was not found.' };
  }

  if (order.payment_status === 'paid') {
    return { ok: true, alreadyPaid: true, order };
  }

  const items = getOrderItems(order);
  const saleResult = await applyUsedTireInventorySale({ supabaseAdmin, items });
  if (!saleResult.ok) {
    return {
      ok: false,
      statusCode: saleResult.statusCode || 500,
      message: saleResult.message,
      error: saleResult.error,
      order,
    };
  }

  const { data: paidOrder, error: payError } = await supabaseAdmin
    .from('used_tire_orders')
    .update({
      payment_status: 'paid',
      fulfillment_status: 'paid_ready',
      stripe_session_id: sessionId || order.stripe_session_id,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .select('*')
    .single();

  if (payError) {
    return { ok: false, statusCode: 500, message: payError.message, error: payError, order };
  }

  if (order.customer_id) {
    await supabaseAdmin
      .from('customer_carts')
      .update({ items: [], updated_at: new Date().toISOString() })
      .eq('customer_id', order.customer_id)
      .eq('cart_type', 'used_tire');
  }

  if (saleResult.sheet?.skipped?.length || saleResult.sheet?.error) {
    console.warn('[EastCord sheet write-back] Sheet update was incomplete after order.', {
      orderId: paidOrder.id,
      skipped: saleResult.sheet.skipped,
      error: saleResult.sheet.error,
    });
  } else if (saleResult.websiteUpdates?.length) {
    console.info(
      `[EastCord sheet write-back] Updated ${saleResult.sheet?.updated?.length || 0} sheet row(s) after order ${paidOrder.id}.`,
    );
  }

  return { ok: true, alreadyPaid: false, order: paidOrder, sale: saleResult };
}

module.exports = {
  TAX_RATE,
  roundMoney,
  calculateTax,
  applyUsedTireInventorySale,
  fulfillPaidUsedTireOrder,
};
