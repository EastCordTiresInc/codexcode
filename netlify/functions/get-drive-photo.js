exports.handler = async function getDrivePhoto(event) {
  if (event.httpMethod !== 'GET') {
    return textResponse(405, 'Method not allowed.');
  }

  const id = event.queryStringParameters?.id?.trim() || '';
  const size = event.queryStringParameters?.sz?.trim() || 'w1000';

  if (!id) {
    return textResponse(400, 'id is required.');
  }

  const candidates = [
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=${encodeURIComponent(size)}`,
    `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EastCordTiresBot/1.0)',
        },
      });

      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) continue;

      return {
        statusCode: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
        },
        body: buffer.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      // Try the next Drive URL pattern.
    }
  }

  return textResponse(404, 'Photo not available.');
};

function textResponse(statusCode, message) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: message,
  };
}
