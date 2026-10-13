(() => {
  const root = document.querySelector('[data-brand-reel]');
  const image = root?.querySelector('img');
  if (!root || !image) return;

  const logos = [
    '/assets/popular-brands/michelin.svg',
    '/assets/popular-brands/bridgestone.svg',
    '/assets/popular-brands/goodyear.svg',
    '/assets/popular-brands/continental.svg',
    '/assets/popular-brands/yokohama.svg',
    '/assets/popular-brands/hankook.svg',
    '/assets/popular-brands/firestone.svg',
    '/assets/popular-brands/bfgoodrich.svg',
    '/assets/popular-brands/general-tire.svg',
  ];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  let timer = null;
  let swapTimer = null;

  function showNext() {
    window.clearTimeout(swapTimer);
    root.classList.add('is-fading');
    swapTimer = window.setTimeout(() => {
      index = (index + 1) % logos.length;
      image.src = logos[index];
      root.classList.remove('is-fading');
    }, reduceMotion ? 0 : 420);
  }

  function start() {
    if (reduceMotion || timer) return;
    timer = window.setInterval(showNext, 2600);
  }

  function stop() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  if (reduceMotion) {
    root.classList.add('is-static');
    return;
  }

  start();
})();
