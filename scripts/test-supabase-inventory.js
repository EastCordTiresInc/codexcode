const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.netlify', '.env');
const envText = fs.readFileSync(envPath, 'utf8');
const env = {};
envText.split(/\r?\n/).forEach((line) => {
  const match = line.match(/^\s*([^#=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

async function main() {
  const endpoint = `${url}/rest/v1/usedtireinventory?select=id,tire_size,width,profile,wheel_size,current_stock&current_stock=gt.0&limit=5`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  console.log('HTTP status:', response.status);
  const body = await response.text();
  if (!response.ok) {
    console.log('Error body:', body.slice(0, 500));
    return;
  }

  const rows = JSON.parse(body);
  console.log('Rows returned:', rows.length);
  console.log('Sample:', JSON.stringify(rows[0] || null, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
