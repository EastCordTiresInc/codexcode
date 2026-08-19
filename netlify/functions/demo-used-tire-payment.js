const { createClient } = require('@supabase/supabase-js');
const { applyUsedTireInventorySale } = require('./lib/used-tire-order');
const { sendEmail, getEmailConfig } = require('./lib/send-email');
const { buildUsedTireReceipt } = require('./lib/used-tire-receipt');

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

function isLocalHost(event) {
  const host = String(event.headers.host || event.headers.Host || '');
  return /localhost|127\.0\.0\.1/i.test(host);
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getCustomer(payload) {
  const name = String(payload?.customer?.name || payload?.name || '').trim();
  const email = String(payload?.customer?.email || payload?.email || '').trim().toLowerCase();
  const phone = String(payload?.customer?.phone || payload?.phone || '').trim();
  return { name, email, phone };
}

exports.handler = async function demoUsedTirePayment(event) {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed.' });
  if (!isLocalHost(event)) {
    return json(403, { message: 'Demo payment is only available on localhost.' });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return json(500, { message: 'Supabase admin configuration is missing.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return json(400, { message: 'Invalid demo payment request.' });
  }

  const restore = Boolean(payload.restore);
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 8) : [];
  if (!items.length) {
    return json(400, { message: 'Add at least one tire before the demo payment.' });
  }

  const customer = getCustomer(payload);
  if (!restore) {
    if (!customer.name || !customer.email) {
      return json(400, { message: 'Name and email are required so we can send a receipt.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
      return json(400, { message: 'Please enter a valid email address for the receipt.' });
    }
  }

  const result = await applyUsedTireInventorySale({
    supabaseAdmin,
    items,
    restore,
  });

  if (!result.ok) {
    return json(result.statusCode || 500, { message: result.message || 'Demo payment failed.' });
  }

  let email = { ok: false, skipped: true, reason: 'restore' };
  if (!restore) {
    const receipt = buildUsedTireReceipt({
      customer,
      items,
      demo: true,
      websiteUpdates: result.websiteUpdates,
    });
    try {
      email = await sendEmail({
        to: customer.email,
        subject: receipt.subject,
        text: receipt.text,
        html: receipt.html,
      });
    } catch (error) {
      email = { ok: false, skipped: false, reason: error.message || 'send_failed' };
    }
  }

  console.info('[EastCord demo payment]', {
    restore,
    itemCount: items.length,
    sheetUpdated: result.sheet?.updated?.length || 0,
    sheetError: result.sheet?.error || null,
    emailOk: Boolean(email.ok),
    emailReason: email.reason || null,
  });

  return json(200, {
    ok: true,
    demo: true,
    restore,
    customer: restore ? undefined : { name: customer.name, email: customer.email },
    websiteUpdates: result.websiteUpdates,
    sheet: result.sheet,
    email,
    hasResendApiKey: Boolean(getEmailConfig().apiKey),
    message: restore
      ? 'Demo sale restored on the website.'
      : 'Demo sale applied. A receipt email was attempted.',
  });
};
