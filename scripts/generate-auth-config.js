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

function pickEnv(...keys) {
  for (const key of keys) {
    if (fileEnv[key]) return fileEnv[key];
  }

  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }

  return '';
}

function pickSupabaseAnonKey() {
  const candidates = [
    pickEnv('VITE_SUPABASE_ANON_KEY'),
    pickEnv('SUPABASE_ANON_KEY'),
    pickEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    pickEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  ].filter(Boolean);

  return candidates.find((value) => value.startsWith('eyJ')) || candidates[0] || '';
}

const supabaseUrl = pickEnv(
  'VITE_SUPABASE_URL',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
);
const supabaseAnonKey = pickSupabaseAnonKey();

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[EastCord] Missing Supabase URL or anon key in .env or .netlify/.env');
}

if (supabaseAnonKey && !supabaseAnonKey.startsWith('eyJ')) {
  console.warn('[EastCord] Supabase anon key does not look valid (expected JWT starting with eyJ).');
  console.warn('[EastCord] Copy the anon public key from Supabase -> Project Settings -> API.');
} else if (supabaseAnonKey) {
  console.log('[EastCord] Supabase anon key loaded successfully.');
}

const config = {
  provider: 'supabase',
  supabaseUrl,
  supabaseAnonKey,
  stripePublishableKey: pickEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLIC_KEY'),
  stripeTestMode: String(pickEnv('STRIPE_SECRET_KEY')).startsWith('sk_test_'),
  googleApiKey: pickEnv('GOOGLE_API_KEY', 'VITE_GOOGLE_API_KEY'),
};

const output = `window.EASTCORD_AUTH_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync(path.join(ROOT, 'auth-config.js'), output);

console.log('[EastCord] Wrote auth-config.js');
if (supabaseUrl) {
  console.log(`[EastCord] Supabase URL: ${supabaseUrl}`);
}
