const fs = require('fs');

const indexPath = 'index.html';
const index = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

const brandSection = `      <section class="popular-brands section" id="tire-brands" aria-labelledby="tire-brands-title">
        <div class="shell popular-brands-shell">
          <div class="section-heading brand-card-heading">
            <div>
              <h2 id="tire-brands-title"><span>Popular Tire Brands</span> <span>We Can Source</span></h2>
            </div>
            <p>
              We help customers find used and new tires from popular brands based on size, season, and current supplier availability.
            </p>
          </div>

          <div class="brand-text-grid" aria-label="Popular tire brands EastCord can help source">
            <article class="brand-text-card brand-style-michelin">
              <strong>MICHELIN</strong>
            </article>
            <article class="brand-text-card brand-style-bridgestone">
              <strong>Bridgestone</strong>
            </article>
            <article class="brand-text-card brand-style-goodyear">
              <strong>GOODYEAR</strong>
            </article>
            <article class="brand-text-card brand-style-continental">
              <strong>Continental</strong>
            </article>
            <article class="brand-text-card brand-style-yokohama">
              <strong>YOKOHAMA</strong>
            </article>
            <article class="brand-text-card brand-style-hankook">
              <strong>HANKOOK</strong>
            </article>
            <article class="brand-text-card brand-style-firestone">
              <strong>Firestone</strong>
            </article>
            <article class="brand-text-card brand-style-bfgoodrich">
              <strong>BFGoodrich</strong>
            </article>
            <article class="brand-text-card brand-style-general">
              <strong>GENERAL TIRE</strong>
            </article>
          </div>

          <p class="brand-note">
            Brand names are trademarks of their respective owners. Availability may vary by size, season, and supplier stock.
          </p>

          <div class="brand-actions" aria-label="Tire brand section actions">
            <a class="button button-primary" href="/used-tires">Check Used Tires</a>
            <a class="button button-dark" href="/new-tires.html">Shop New Tires</a>
          </div>
        </div>
      </section>`;

let output = index.replace(
  /      <section class="popular-brands section" id="tire-brands" aria-labelledby="tire-brands-title">[\s\S]*?      <\/section>\r?\n\r?\n      <section class="tire-calculator section"/,
  `${brandSection}\n\n      <section class="tire-calculator section"`,
);

if (output === index) {
  throw new Error('Popular tire brands section replacement did not match index.html.');
}

output = output.replace(/\n    <script src="brand-carousel\.js\?v=1" defer><\/script>/g, '');

fs.writeFileSync(indexPath, output);
console.log('Built text-only Popular Tire Brands card grid.');
