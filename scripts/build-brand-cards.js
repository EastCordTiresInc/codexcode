const fs = require('fs');

const indexPath = 'index.html';
const index = fs.readFileSync(indexPath, 'utf8');

const brandSection = `      <section class="popular-brands section" id="tire-brands" aria-labelledby="tire-brands-title">
        <div class="shell popular-brands-shell">
          <div class="section-heading brand-card-heading">
            <div>
              <h2 id="tire-brands-title">Popular Tire Brands We Can Source</h2>
            </div>
            <p>
              We help customers find used and new tires from popular brands based on size, season, and current supplier availability.
            </p>
          </div>

          <div class="brand-text-grid" aria-label="Popular tire brands EastCord can help source">
            <article class="brand-text-card brand-style-michelin">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Michelin</strong>
              <span>Touring • Performance • Winter</span>
            </article>
            <article class="brand-text-card brand-style-bridgestone">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Bridgestone</strong>
              <span>All-Season • SUV • Winter</span>
            </article>
            <article class="brand-text-card brand-style-goodyear">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Goodyear</strong>
              <span>Daily Driving • CUV • Light Truck</span>
            </article>
            <article class="brand-text-card brand-style-continental">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Continental</strong>
              <span>Passenger • Touring • Winter</span>
            </article>
            <article class="brand-text-card brand-style-yokohama">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Yokohama</strong>
              <span>Performance • SUV • All-Season</span>
            </article>
            <article class="brand-text-card brand-style-hankook">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Hankook</strong>
              <span>Passenger • CUV • Winter</span>
            </article>
            <article class="brand-text-card brand-style-firestone">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>Firestone</strong>
              <span>Daily Driving • Seasonal Options</span>
            </article>
            <article class="brand-text-card brand-style-bfgoodrich">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>BFGoodrich</strong>
              <span>SUV • Light Truck • Performance</span>
            </article>
            <article class="brand-text-card brand-style-general">
              <span class="brand-accent" aria-hidden="true"></span>
              <strong>General Tire</strong>
              <span>All-Season • SUV • Winter</span>
            </article>
          </div>

          <p class="brand-note">
            Brand names are trademarks of their respective owners. Availability may vary by size, season, and supplier stock.
          </p>

          <div class="brand-actions" aria-label="Tire brand section actions">
            <a class="button button-primary" href="#used-tires">Check Used Tires</a>
            <a class="button button-dark" href="/new-tires.html">Shop New Tires</a>
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

output = output.replace(/\n    <script src="brand-carousel\.js\?v=1" defer><\/script>/g, '');

fs.writeFileSync(indexPath, output);
console.log('Built text-only Popular Tire Brands card grid.');
