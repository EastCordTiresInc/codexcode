const fs = require('fs');

const indexPath = 'index.html';
const original = fs.readFileSync(indexPath, 'utf8');

let output = original.replace(
  /(<div class="brand-actions"[^>]*>\s*<a class="button button-primary" href=")[^"]+(">Check Used Tires<\/a>)/,
  '$1/used-tires.html$2',
);

output = output.replace(/\n    <script src="brand-carousel\.js\?v=1" defer><\/script>/g, '');

if (!output.includes('href="/used-tires.html">Check Used Tires</a>')) {
  throw new Error('Could not point the homepage Check Used Tires button at used-tires.html.');
}

if (output !== original) {
  fs.writeFileSync(indexPath, output);
}

console.log('Homepage Check Used Tires button points at used-tires.html.');
