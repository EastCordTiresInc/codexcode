const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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
  missingGoogleConfig,
} = require('../netlify/functions/lib/google-sheets-inventory');
const { fulfillPaidUsedTireOrder, applyUsedTireInventorySale } = require('../netlify/functions/lib/used-tire-order');

function getSheetRow(parsed, id) {
  return parsed.rows.find((row) => String(row.id) === String(id)) || null;
}

async function readSheet(config) {
  const accessToken = await getGoogleAccessToken(config);
  const values = await getSheetValues(config, accessToken);
  return parseSheet(values);
}

async function main() {
  const config = getConfig();
  const missingGoogle = missingGoogleConfig(config);
  const result = {
    ok: false,
    stripeTestMode: String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_'),
    googleConfig: missingGoogle.length ? `missing: ${missingGoogle.join(', ')}` : 'ready',
    steps: [],
  };

  if (missingGoogle.length) {
    throw Object.assign(new Error(`Google Sheets is not configured: ${missingGoogle.join(', ')}`), { result });
  }
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Supabase admin env vars are missing.');
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is missing.');
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const beforeSheet = await readSheet(config);
  const sheetCandidate = beforeSheet.rows.find((row) => Number(row.current_stock) > 0) || beforeSheet.rows[0];
  if (!sheetCandidate) throw new Error('Sheet1 has no inventory rows.');

  const { data: dbRow, error: dbError } = await supabaseAdmin
    .from('usedtireinventory')
    .select('id, brand, tire_size, current_stock, selling_price')
    .eq('id', sheetCandidate.id)
    .maybeSingle();
  if (dbError) throw new Error(`Supabase inventory read failed: ${dbError.message}`);
  if (!dbRow) throw new Error(`Supabase has no usedtireinventory row for Sheet1 id ${sheetCandidate.id}.`);
  if (Number(dbRow.current_stock) < 1) {
    throw new Error(`Not enough website stock on id ${dbRow.id} to run a sale test.`);
  }

  result.tire = {
    id: String(dbRow.id),
    brand: dbRow.brand,
    size: dbRow.tire_size,
    sheetStockBefore: Number(sheetCandidate.current_stock),
    sheetRemoveBefore: Number(sheetCandidate.remove_qty || 0),
    websiteStockBefore: Number(dbRow.current_stock),
  };

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('customer_profiles')
    .select('id, email, full_name, phone')
    .limit(1)
    .maybeSingle();
  if (profileError) throw new Error(`Could not load a customer profile for the test order: ${profileError.message}`);
  if (!profile?.id) throw new Error('No customer_profiles row exists, so a used_tire_orders test row cannot be created.');

  const items = [{
    id: `used-tire-${dbRow.id}`,
    inventoryId: dbRow.id,
    brand: dbRow.brand,
    size: dbRow.tire_size,
    qty: 1,
    unitPrice: Number(dbRow.selling_price) || 1,
  }];

  let orderId = null;
  let restored = false;

  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from('used_tire_orders')
      .insert({
        customer_id: profile.id,
        customer_name: profile.full_name || 'Sheet1 checkout test',
        customer_email: profile.email || 'test@eastcordtires.ca',
        customer_phone: profile.phone || '',
        items,
        subtotal: items[0].unitPrice,
        hst_amount: 0,
        total_with_hst: items[0].unitPrice,
        tax_rate: 0,
        payment_status: 'pending_checkout',
        fulfillment_status: 'unfulfilled',
      })
      .select('id')
      .single();

    if (orderError || !order) {
      throw new Error(orderError?.message || 'Could not create a test used_tire_orders row. customer_id may be required.');
    }
    orderId = order.id;
    result.steps.push({ step: 'create-order', ok: true, orderId });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: profile?.email || 'test@eastcordtires.ca',
      line_items: [{
        price_data: {
          currency: 'cad',
          product_data: { name: `TEST Sheet1 write-back ${dbRow.brand} ${dbRow.tire_size}` },
          unit_amount: Math.max(50, Math.round(items[0].unitPrice * 100)),
        },
        quantity: 1,
      }],
      success_url: 'https://eastcordtires.ca/tire-reservation-success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://eastcordtires.ca/tire-cart.html',
      metadata: {
        order_type: 'used_tire',
        order_id: orderId,
        checkout_test: 'sheet1-writeback',
      },
    });
    result.steps.push({
      step: 'create-stripe-checkout-session',
      ok: Boolean(session.id),
      sessionId: session.id,
      paymentStatus: session.payment_status,
      livemode: session.livemode,
    });

    const paidSession = {
      id: session.id,
      payment_status: 'paid',
      metadata: session.metadata,
    };

    const fulfill = await fulfillPaidUsedTireOrder({ supabaseAdmin, session: paidSession });
    result.steps.push({
      step: 'fulfill-paid-order',
      ok: Boolean(fulfill.ok),
      alreadyPaid: Boolean(fulfill.alreadyPaid),
      message: fulfill.message || '',
      sheetUpdated: fulfill.sale?.sheet?.updated || [],
      sheetSkipped: fulfill.sale?.sheet?.skipped || [],
      sheetError: fulfill.sale?.sheet?.error || null,
      websiteUpdates: fulfill.sale?.websiteUpdates || [],
    });
    if (!fulfill.ok) {
      throw new Error(fulfill.message || 'Fulfillment failed.');
    }

    const afterSheet = await readSheet(config);
    const afterRow = getSheetRow(afterSheet, dbRow.id);
    const { data: afterDb } = await supabaseAdmin
      .from('usedtireinventory')
      .select('current_stock')
      .eq('id', dbRow.id)
      .maybeSingle();

    const sheetStockAfter = Number(afterRow?.current_stock);
    const sheetRemoveAfter = Number(afterRow?.remove_qty || 0);
    const websiteStockAfter = Number(afterDb?.current_stock);
    const sheetChanged = sheetStockAfter === result.tire.sheetStockBefore - 1
      || sheetRemoveAfter === result.tire.sheetRemoveBefore + 1;
    const websiteChanged = websiteStockAfter === result.tire.websiteStockBefore - 1;

    result.tire.sheetStockAfter = sheetStockAfter;
    result.tire.sheetRemoveAfter = sheetRemoveAfter;
    result.tire.websiteStockAfter = websiteStockAfter;
    result.sheetWriteWorked = sheetChanged;
    result.websiteWriteWorked = websiteChanged;

    const restore = await applyUsedTireInventorySale({
      supabaseAdmin,
      items,
      restore: true,
    });
    restored = Boolean(restore.ok);
    result.steps.push({
      step: 'restore-stock',
      ok: restored,
      sheetUpdated: restore.sheet?.updated || [],
      sheetSkipped: restore.sheet?.skipped || [],
      sheetError: restore.sheet?.error || null,
    });

    const restoredSheet = await readSheet(config);
    const restoredRow = getSheetRow(restoredSheet, dbRow.id);
    result.tire.sheetStockRestored = Number(restoredRow?.current_stock);
    result.tire.sheetRemoveRestored = Number(restoredRow?.remove_qty || 0);

    result.ok = Boolean(sheetChanged && websiteChanged && restored);
  } finally {
    if (!restored && orderId) {
      try {
        await applyUsedTireInventorySale({ supabaseAdmin, items, restore: true });
      } catch (error) {
        result.steps.push({ step: 'restore-on-error', ok: false, message: error.message });
      }
    }
    if (orderId) {
      const { error: deleteError } = await supabaseAdmin
        .from('used_tire_orders')
        .delete()
        .eq('id', orderId);
      result.steps.push({ step: 'delete-test-order', ok: !deleteError, message: deleteError?.message || '' });
    }
  }

  if (!result.ok) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    result: error.result || null,
  }, null, 2));
  process.exit(1);
});
