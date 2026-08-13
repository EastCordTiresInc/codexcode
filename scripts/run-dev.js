const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Local Windows networks often intercept HTTPS with a custom cert Node does not trust.
// This applies only to `npm run dev` — production Netlify is unaffected.
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

const child = spawn('netlify', ['dev', '-p', '8888'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: root,
});

child.on('exit', (code) => process.exit(code ?? 0));
