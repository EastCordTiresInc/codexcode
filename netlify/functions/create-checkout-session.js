exports.handler = async function createCheckoutSession(event, context) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed.' });
  }

  const user = context.clientContext && context.clientContext.user;
  if (!user) {
    return jsonResponse(401, { message: 'Please log in before checkout.' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (_error) {
    return jsonResponse(400, { message: 'Invalid checkout request.' });
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return jsonResponse(400, { message: 'Your cart is empty.' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return jsonResponse(501, {
      message: 'Checkout login is working. Stripe payment is not configured yet. Add STRIPE_SECRET_KEY in Netlify and connect real Stripe price IDs before enabling payment.',
    });
  }

  return jsonResponse(501, {
    message: 'Stripe checkout is ready to connect, but no Stripe session builder has been configured yet.',
  });
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
