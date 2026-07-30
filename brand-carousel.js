(() => {
  const brands = [
    { name: 'Michelin', category: 'Touring • Performance • Winter' },
    { name: 'Bridgestone', category: 'All-Season • SUV • Winter' },
    { name: 'Goodyear', category: 'Daily Driving • CUV • Light Truck' },
    { name: 'Continental', category: 'Passenger • Touring • Winter' },
    { name: 'Yokohama', category: 'Performance • SUV • All-Season' },
    { name: 'Hankook', category: 'Passenger • CUV • Winter' },
    { name: 'Firestone', category: 'Daily Driving • Seasonal Options' },
    { name: 'BFGoodrich', category: 'SUV • Light Truck • Performance' },
    { name: 'General Tire', category: 'All-Season • SUV • Winter' },
  ];

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rotationMs = 2800;

  function initBrandCarousel() {
    const carousel = document.querySelector('[data-brand-carousel]');
    if (!carousel) return;

    const card = carousel.querySelector('.brand-carousel-card');
    const nameTarget = carousel.querySelector('[data-brand-name]');
    const categoryTarget = carousel.querySelector('[data-brand-category]');
    const dotsTarget = carousel.querySelector('[data-brand-dots]');
    const previousButton = carousel.querySelector('[data-brand-prev]');
    const nextButton = carousel.querySelector('[data-brand-next]');

    if (!card || !nameTarget || !categoryTarget || !dotsTarget) return;

    let activeIndex = 0;
    let timer = null;

    const dots = brands.map((brand, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'brand-carousel-dot';
      dot.setAttribute('aria-label', `Show ${brand.name}`);
      dot.addEventListener('click', () => {
        showBrand(index);
        restart();
      });
      dotsTarget.appendChild(dot);
      return dot;
    });

    function renderBrand() {
      const brand = brands[activeIndex];
      nameTarget.textContent = brand.name;
      categoryTarget.textContent = brand.category;
      dots.forEach((dot, index) => {
        dot.classList.toggle('is-active', index === activeIndex);
        dot.setAttribute('aria-current', index === activeIndex ? 'true' : 'false');
      });
    }

    function showBrand(index) {
      activeIndex = (index + brands.length) % brands.length;

      if (prefersReducedMotion) {
        renderBrand();
        return;
      }

      card.classList.add('is-changing');
      window.setTimeout(() => {
        renderBrand();
        card.classList.remove('is-changing');
      }, 180);
    }

    function nextBrand() {
      showBrand(activeIndex + 1);
    }

    function previousBrand() {
      showBrand(activeIndex - 1);
    }

    function start() {
      if (prefersReducedMotion || timer) return;
      timer = window.setInterval(nextBrand, rotationMs);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    function restart() {
      stop();
      start();
    }

    previousButton?.addEventListener('click', () => {
      previousBrand();
      restart();
    });

    nextButton?.addEventListener('click', () => {
      nextBrand();
      restart();
    });

    carousel.addEventListener('mouseenter', stop);
    carousel.addEventListener('mouseleave', start);
    carousel.addEventListener('focusin', stop);
    carousel.addEventListener('focusout', start);

    renderBrand();
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBrandCarousel);
  } else {
    initBrandCarousel();
  }
})();
