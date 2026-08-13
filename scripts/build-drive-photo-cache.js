process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INVENTORY_PATH = path.join(ROOT, 'assets', 'used-inventory.json');
const CACHE_PATH = path.join(ROOT, 'assets', 'drive-photo-cache.json');
const CACHE_ALIAS_PATH = path.join(ROOT, 'assets', 'tire-photo-cache.json');
const IMAGE_MIME_PREFIX = 'image/';
const IMAGE_NAME_PATTERN = /\.(jpe?g|png|webp|gif|heic|bmp)$/i;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) return;
    process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  });
}

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '.netlify', '.env'));

const apiKey = process.env.GOOGLE_API_KEY || process.env.VITE_GOOGLE_API_KEY || '';

if (!apiKey) {
  console.error('[EastCord] Missing GOOGLE_API_KEY in .env');
  process.exit(1);
}

if (!fs.existsSync(INVENTORY_PATH)) {
  console.error('[EastCord] Missing assets/used-inventory.json');
  process.exit(1);
}

function parseFolderId(url) {
  const match = String(url || '').match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

function isImageFile(file) {
  if (file.mimeType?.startsWith(IMAGE_MIME_PREFIX)) return true;
  return IMAGE_NAME_PATTERN.test(file.name || '');
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

async function listFolderPhotos(folderId) {
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

  if (!response.ok) {
    throw new Error(payload.error?.message || `Drive API ${response.status}`);
  }

  return (payload.files || []).filter(isImageFile).map(toPhotoEntry);
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const folderIds = [...new Set(
    inventory.map((row) => parseFolderId(row.drive_link)).filter(Boolean),
  )];

  console.log(`[EastCord] Caching photos for ${folderIds.length} Drive folders...`);

  const cache = {};
  let successCount = 0;
  let emptyCount = 0;

  for (const folderId of folderIds) {
    try {
      const photos = await listFolderPhotos(folderId);
      if (photos.length) {
        cache[folderId] = photos;
        successCount += 1;
        console.log(`  OK  ${folderId} (${photos.length} photo${photos.length === 1 ? '' : 's'})`);
      } else {
        emptyCount += 1;
        console.warn(`  --  ${folderId} (no photos — is the folder shared publicly?)`);
      }
    } catch (error) {
      emptyCount += 1;
      console.warn(`  !!  ${folderId} (${error.message})`);
    }
  }

  const cacheJson = `${JSON.stringify(cache, null, 2)}\n`;
  fs.writeFileSync(CACHE_PATH, cacheJson);
  fs.writeFileSync(CACHE_ALIAS_PATH, cacheJson);
  console.log(`[EastCord] Wrote ${successCount} folders to assets/drive-photo-cache.json and tire-photo-cache.json (${emptyCount} empty/failed).`);
}

main().catch((error) => {
  console.error('[EastCord] Photo cache build failed.', error);
  process.exit(1);
});
