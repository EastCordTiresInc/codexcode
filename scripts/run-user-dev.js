const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Match scripts/run-dev.js so the user-side server gets Stripe/Supabase secrets.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
    if (!match) return;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value.replace(/\\n/g, '\n');
  });
}

const root = path.join(__dirname, '..');
loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.netlify', '.env'));

const stripeKey = String(process.env.STRIPE_SECRET_KEY || '');
if (!stripeKey) {
  console.warn('[EastCord user-dev] STRIPE_SECRET_KEY is missing. Checkout will fail until it is set in .netlify/.env');
} else if (!stripeKey.startsWith('sk_test_')) {
  console.warn('[EastCord user-dev] STRIPE_SECRET_KEY is not a test key (sk_test_...). Use a Stripe test secret for local booking.');
} else {
  console.log('[EastCord user-dev] Stripe test secret loaded.');
}

const child = spawn(
  'npx',
  [
    'netlify',
    'dev',
    '-p',
    '8889',
    '--target-port',
    '4001',
    '--framework',
    '#custom',
    '-c',
    'scripts\\keep-alive.cmd',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
