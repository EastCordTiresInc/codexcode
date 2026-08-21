const fs = require('fs');
const path = require('path');

const root = process.cwd();
const APPOINTMENT_PAGE = '/appointment.html';
const NEW_TIRES_PAGE = '/new-tires.html';
const MIO_BOOKING_URL = '/appointment.html';
const MOBILE_MENU_SCRIPT = '<script src="mobile-menu.js?v=1" defer></script>';
const extensions = new Set(['.html', '.js']);
const skipDirs = new Set(['.git', 'node_modules', '.netlify']);

const replacements = [
  [new RegExp(MIO_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), APPOINTMENT_PAGE],
  [/href="\/appointment\.html"/g, 'href="/appointment.html"'],
  [/href="\/#appointment"/g, 'href="/appointment.html"'],
  [/href="index\.html#appointment"/g, 'href="/appointment.html"'],
  [/href="\/new-tires\.html"/g, `href="${NEW_TIRES_PAGE}"`],
  [/href="\/#new-tires"/g, `href="${NEW_TIRES_PAGE}"`],
  [/href="index\.html#new-tires"/g, `href="${NEW_TIRES_PAGE}"`],
  [/class="service-card new-tires-card" id="new-tires" href="\/new-tires\.html"/g, `class="service-card new-tires-card" id="new-tires" href="${NEW_TIRES_PAGE}"`],
  [/class="service-card new-tires-card" id="new-tires" href="\/#tire-brands"/g, `class="service-card new-tires-card" id="new-tires" href="${NEW_TIRES_PAGE}"`],
  [/class="service-card changeover-card" id="appointment" href="\/appointment\.html"/g, 'class="service-card changeover-card" id="appointment" href="/appointment.html"'],
  [/class="service-card changeover-card" id="appointment" href="\/#contact"/g, 'class="service-card changeover-card" id="appointment" href="/appointment.html"'],
  [/href="\/appointment\.html"\s+target="_blank"\s+rel="noopener noreferrer"/g, 'href="/appointment.html"'],
  [/href="\/appointment\.html"\s*\n\s*target="_blank"\s*\n\s*rel="noopener noreferrer"/g, 'href="/appointment.html"'],
  [/\{ label: 'Book Appointment', href: appointmentLink, external: true \}/g, "{ label: 'Book Appointment', href: appointmentLink }"],
  [/including TireConnect for new tire orders and our appointment booking system for service bookings/g, 'including TireConnect for new tire orders and our appointment booking system for service bookings'],
  [/TireConnect, payment providers/g, 'TireConnect, payment providers'],
  [/TireConnect, payment processors/g, 'TireConnect, payment processors'],
  [/TireConnect, payment providers, social media/g, 'TireConnect, payment providers, social media'],
  [/TireConnect, payment providers, social media links/g, 'TireConnect, payment providers, social media links'],
  [/\.main-nav\.open \{/g, '.main-nav.open,\n  .main-nav.is-open {'],
  [/\n    els\.menuToggle\?\.addEventListener\('click', \(\) => \{\n      const isOpen = els\.menuToggle\.getAttribute\('aria-expanded'\) === 'true';\n      els\.menuToggle\.setAttribute\('aria-expanded', String\(!isOpen\)\);\n      els\.primaryNavigation\?\.classList\.toggle\('is-open', !isOpen\);\n    \}\);\n\n    els\.primaryNavigation\?\.querySelectorAll\('a'\)\.forEach\(\(link\) => link\.addEventListener\('click', closeMobileMenu\)\);/g, ''],
];

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) continue;
    updateFile(fullPath);
  }
}

function ensureMobileMenuScript(filePath, content) {
  if (path.extname(filePath) !== '.html' || content.includes('mobile-menu.js')) return content;
  return content.replace(/\n\s*<\/body>/, `\n    ${MOBILE_MENU_SCRIPT}\n  </body>`);
}

function updateFile(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  let next = original;

  for (const [pattern, replacement] of replacements) {
    next = next.replace(pattern, replacement);
  }

  next = ensureMobileMenuScript(filePath, next);

  if (next !== original) {
    fs.writeFileSync(filePath, next);
    console.log(`[EastCord appointment automation] Routed appointment and new tire links in ${path.relative(root, filePath)}`);
  }
}

walk(root);
