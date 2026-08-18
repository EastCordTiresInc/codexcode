exports.handler = async function getDrivePhoto(event) {
  if (event.httpMethod !== 'GET') {
    return textResponse(405, 'Method not allowed.');
  }

  const id = event.queryStringParameters?.id?.trim() || '';
  const size = normalizePhotoSize(event.queryStringParameters?.sz?.trim());

  if (!id) {
    return textResponse(400, 'id is required.');
  }

  const pixels = size.replace(/^w/, '');
  const candidates = [
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=s${pixels}`,
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
          'Cache-Control': 'public, max-age=2592000, immutable',
          'Netlify-CDN-Cache-Control': 'public, max-age=31536000, durable',
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

function normalizePhotoSize(size) {
  const allowed = {
    w400: 'w400',
    w600: 'w600',
    w800: 'w800',
    w1000: 'w800',
    w1600: 'w1600',
    w2400: 'w1600',
  };
  return allowed[size] || 'w800';
}

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
