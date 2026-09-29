const { checkAndRepairResendDomain } = require('./lib/send-email');

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

exports.handler = async (event) => {
  const method = event.httpMethod || 'GET';
  const isScheduled = String(event.headers?.['x-nf-event'] || '').toLowerCase() === 'schedule';
  if (!['GET', 'POST'].includes(method) && !isScheduled) {
    return json(405, { message: 'Method not allowed.' });
  }

  const repair = isScheduled || method === 'POST';
  try {
    const result = await checkAndRepairResendDomain({
      alertStaff: repair,
      repair,
    });
    const httpStatus = result.domain || result.ok ? 200 : 502;
    return json(httpStatus, {
      ...result,
      scheduled: isScheduled,
    });
  } catch (error) {
    console.error('[EastCord email] Domain watch failed.', error);
    return json(502, { ok: false, message: error.message || 'Domain check failed.' });
  }
};
