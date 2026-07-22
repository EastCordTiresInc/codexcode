const fs = require('fs');

const config = {
  provider: 'supabase',
  supabaseUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
  stripePublishableKey: process.env.VITE_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLIC_KEY || '',
};

const output = `window.EASTCORD_AUTH_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync('auth-config.js', output);
