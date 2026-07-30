const fs = require('fs');

const indexPath = 'index.html';
const index = fs.readFileSync(indexPath, 'utf8');

const brandSection = `      <section class="popular-brands section" id="tire-brands" aria-labelledby="tire-brands-title">
        <div class="shell popular-brands-shell">
          <div class="section-heading brand-carousel-heading">
            <div>
              <h2 id="tire-brands-title">Popular Tire Brands We Can Source</h2>
            </div>
            <p>
              We help customers find used and new tires from popular brands based on size, season, and current supplier availability.
            </p>
          </div>

          <div class="brand-carousel-wrap" data-brand-carousel aria-label="Text-only popular tire brand carousel">
            <div class="brand-carousel-panel">
              <div class="brand-carousel-card" aria-live="polite">
                <span class="brand-carousel-kicker">Popular brand</span>
                <strong class="brand-carousel-name" data-brand-name>Michelin</strong>
                <span class="brand-carousel-accent" aria-hidden="true"></span>
                <span class="brand-carousel-category" data-brand-category>Touring • Performance • Winter</span>
              </div>

              <div class="brand-carousel-controls" aria-label="Brand carousel controls">
                <button class="brand-carousel-arrow" type="button" data-brand-prev aria-label="Previous brand">‹</button>
                <div class="brand-carousel-dots" data-brand-dots aria-label="Brand carousel indicators"></div>
                <button class="brand-carousel-arrow" type="button" data-brand-next aria-label="Next brand">›</button>
              </div>
            </div>
          </div>

          <p class="brand-note">
            Brand names are trademarks of their respective owners. Availability may vary by size, season, and supplier stock.
          </p>

          <div class="brand-actions" aria-label="Tire brand section actions">
            <a class="button button-primary" href="#used-tires">Check Used Tires</a>
            <a class="button button-dark" href="#new-tires">Shop New Tires</a>
          </div>
        </div>
      </section>`;

let output = index.replace(
  /      <section class="popular-brands section" id="tire-brands" aria-labelledby="tire-brands-title">[\s\S]*?      <\/section>\n\n      <section class="tire-calculator section"/,
  `${brandSection}\n\n      <section class="tire-calculator section"`,
);

if (output === index) {
  throw new Error('Popular tire brands section replacement did not match index.html.');
}

if (!output.includes('brand-carousel.js')) {
  output = output.replace(
    '    <script type="module" src="auth.js"></script>\n    <script src="tire-size-calculator.js" defer></script>',
    '    <script type="module" src="auth.js"></script>\n    <script src="brand-carousel.js?v=1" defer></script>\n    <script src="tire-size-calculator.js" defer></script>',
  );
}

fs.writeFileSync(indexPath, output);
console.log('Built text-only Popular Tire Brands carousel.');
