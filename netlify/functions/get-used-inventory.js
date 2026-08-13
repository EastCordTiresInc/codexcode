const INVENTORY_SELECT = 'id,tire_size,rim_size,type,brand,current_stock,selling_price,drive_link,is_flotation';

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
  params.set('select', INVENTORY_SELECT);
  params.append('order', 'brand.asc');
  params.append('order', 'tire_size.asc');

  const url = `${supabaseUrl}/rest/v1/usedtireinventory?${params.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Accept: 'application/json',
      },
    });

    const body = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body,
    };
  } catch (error) {
    return jsonResponse(502, {
      message: error.message || 'Could not reach Supabase from the server.',
    });
  }
};

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
