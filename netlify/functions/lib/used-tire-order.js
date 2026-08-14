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
  for (const item of items) {
    const inventoryId = Number(item.inventoryId);
    const qty = Math.max(1, Number(item.qty) || 0);
    if (!inventoryId || !qty) continue;

    const { data: row, error: stockError } = await supabaseAdmin
      .from('usedtireinventory')
      .select('id, current_stock')
      .eq('id', inventoryId)
      .maybeSingle();

    if (stockError) {
      return { ok: false, statusCode: 500, message: stockError.message, error: stockError, order };
    }

    const currentStock = Math.max(0, Number(row?.current_stock) || 0);
    const nextStock = Math.max(0, currentStock - qty);
    const { error: updateStockError } = await supabaseAdmin
      .from('usedtireinventory')
      .update({ current_stock: nextStock })
      .eq('id', inventoryId);

    if (updateStockError) {
      return { ok: false, statusCode: 500, message: updateStockError.message, error: updateStockError, order };
    }
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

  return { ok: true, alreadyPaid: false, order: paidOrder };
}

module.exports = {
  TAX_RATE,
  roundMoney,
  calculateTax,
  fulfillPaidUsedTireOrder,
};
