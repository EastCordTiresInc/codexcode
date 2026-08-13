const fs = require('fs');
const path = require('path');

const IMAGE_MIME_PREFIX = 'image/';
const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp|gif|heic|bmp)$/i;
const PHOTO_CACHE_PATH = path.join(__dirname, '..', '..', 'assets', 'drive-photo-cache.json');
const PHOTO_CACHE_FALLBACK_PATH = path.join(__dirname, '..', '..', 'assets', 'tire-photo-cache.json');
let photoCache = null;

function loadPhotoCache() {
  if (photoCache) return photoCache;
  photoCache = {};
  for (const cachePath of [PHOTO_CACHE_PATH, PHOTO_CACHE_FALLBACK_PATH]) {
    try {
      if (fs.existsSync(cachePath)) {
        photoCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        break;
      }
    } catch (error) {
      photoCache = {};
    }
  }
  return photoCache;
}

exports.handler = async function getDrivePhotos(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed.' });
  }

  const folderId = getQueryParam(event, 'folderId');
  if (!folderId) {
    return jsonResponse(400, { message: 'folderId is required.' });
  }

  const debug = getQueryParam(event, 'debug') === '1';

  try {
    const result = await listFolderPhotos(folderId);
    const body = { photos: result.photos };
    if (debug) body.debug = result.debug;
    return jsonResponse(200, body);
  } catch (error) {
    return jsonResponse(502, {
      message: error.message || 'Could not load Google Drive photos.',
      photos: [],
    });
  }
};

function getQueryParam(event, key) {
  return event.queryStringParameters?.[key]?.trim() || '';
}

async function listFolderPhotos(folderId) {
  const debug = { hasApiKey: false, apiStatus: null, apiFileCount: 0, apiError: null, scrapeIdCount: 0, cacheHit: false };
  const cache = loadPhotoCache();
  if (Array.isArray(cache[folderId]) && cache[folderId].length) {
    debug.cacheHit = true;
    return { photos: cache[folderId], debug };
  }

  const apiKey = process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY || '';

  if (apiKey) {
    debug.hasApiKey = true;
    try {
      const apiPhotos = await listPhotosWithDriveApi(folderId, apiKey, debug);
      if (apiPhotos.length) {
        return { photos: apiPhotos, debug };
      }
    } catch (error) {
      debug.apiError = error.message;
    }
  }

  const scrapedPhotos = await scrapePublicFolderPhotos(folderId, debug);
  return { photos: scrapedPhotos, debug };
}

async function listPhotosWithDriveApi(folderId, apiKey, debug) {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = [
    'https://www.googleapis.com/drive/v3/files',
    `?q=${query}`,
    `&key=${encodeURIComponent(apiKey)}`,
    '&fields=files(id,name,mimeType,thumbnailLink)',
    '&pageSize=20',
    '&supportsAllDrives=true',
    '&includeItemsFromAllDrives=true',
  ].join('');

  const response = await fetch(url);
  const payload = await response.json();
  debug.apiStatus = response.status;

  if (!response.ok) {
    throw new Error(payload.error?.message || `Google Drive API ${response.status}`);
  }

  const files = payload.files || [];
  debug.apiFileCount = files.length;

  return files
    .filter(isImageFile)
    .map(toPhotoEntry);
}

async function scrapePublicFolderPhotos(folderId, debug) {
  const response = await fetch(`https://drive.google.com/drive/folders/${folderId}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Google Drive folder ${response.status}`);
  }

  const html = await response.text();
  if (isDriveSignInPage(html)) {
    throw new Error('Drive folder is not public. Share it as “Anyone with the link can view”.');
  }

  const fileIds = extractFileIds(html, folderId);
  debug.scrapeIdCount = fileIds.length;
  return fileIds.map((id) => toPhotoEntry({ id, name: 'Tire photo' }));
}

function isImageFile(file) {
  if (file.mimeType && file.mimeType.startsWith(IMAGE_MIME_PREFIX)) return true;
  return IMAGE_NAME_PATTERN.test(file.name || '');
}

function isDriveSignInPage(html) {
  return /accounts\.google\.com\/v3\/signin|identity-signin-identifier|ServiceLogin/i.test(html);
}

function isLikelyDriveFileId(id, folderId) {
  if (!id || id === folderId) return false;
  if (id.length < 25 || id.length > 100) return false;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return false;
  if (id.startsWith('AIza')) return false;
  if (!/[0-9]/.test(id)) return false;
  if (/identity|signin|VfPpkd|toggles|frontend/i.test(id)) return false;
  return true;
}

function extractFileIds(html, folderId) {
  const ids = new Set();

  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/g,
    /"docId":"([a-zA-Z0-9_-]+)"/g,
    /data-id="([a-zA-Z0-9_-]+)"/g,
  ];

  patterns.forEach((pattern) => {
    for (const match of html.matchAll(pattern)) {
      const id = match[1];
      if (isLikelyDriveFileId(id, folderId)) ids.add(id);
    }
  });

  return [...ids].slice(0, 12);
}

function toPhotoEntry(file) {
  const id = file.id;
  const name = file.name || 'Tire photo';
  const isHeic = /\.heic$/i.test(name) || file.mimeType === 'image/heic' || file.mimeType === 'image/heif';
  const thumbUrl = `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
  const viewUrl = `https://drive.google.com/uc?export=view&id=${id}`;
  const sources = isHeic
    ? [thumbUrl, viewUrl]
    : [thumbUrl, viewUrl, file.thumbnailLink?.replace(/=s\d+$/, '=s1000')].filter(Boolean);

  return {
    id,
    name,
    url: thumbUrl,
    sources: [...new Set(sources.filter(Boolean))],
    viewUrl: `https://drive.google.com/file/d/${id}/view`,
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
    body: JSON.stringify(body),
  };
}
