const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fileEnv = {};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([^#=]+)=(.*)$/);
      if (!match) return;

      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      fileEnv[key] = value;
    });
}

loadEnvFile(path.join(ROOT, '.env'));
loadEnvFile(path.join(ROOT, '.netlify', '.env'));

const apiKey = String(fileEnv.VITE_TIRECONNECT_API_KEY || process.env.VITE_TIRECONNECT_API_KEY || '').trim();

const output = `window.EASTCORD_TIRECONNECT_CONFIG = ${JSON.stringify({ apiKey }, null, 2)};\n`;
fs.writeFileSync(path.join(ROOT, 'tireconnect-config.js'), output);

if (apiKey) {
  console.log('[EastCord] Wrote tireconnect-config.js');
} else {
  console.warn('[EastCord] Missing VITE_TIRECONNECT_API_KEY in .env or .netlify/.env');
  console.warn('[EastCord] The new-tires widget will stay hidden until that key is set.');
}
