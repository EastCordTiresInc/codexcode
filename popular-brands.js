(() => {
  const root = document.querySelector('[data-brand-reel]');
  const slots = [...(root?.querySelectorAll('img') || [])];
  if (!root || slots.length < 2) return;

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
  const FADE_MS = 900;
  let index = 0;
  let front = 0;
  let timer = null;
  let fading = false;

  function prepareOutgoing(outgoing, shownIndex) {
    const following = logos[(shownIndex + 1) % logos.length];
    const finish = (event) => {
      if (event && event.propertyName && event.propertyName !== 'opacity') return;
      outgoing.removeEventListener('transitionend', finish);
      outgoing.src = following;
      fading = false;
    };
    outgoing.addEventListener('transitionend', finish);
    window.setTimeout(() => {
      outgoing.removeEventListener('transitionend', finish);
      if (outgoing.src.indexOf(following) === -1) outgoing.src = following;
      fading = false;
    }, FADE_MS + 80);
  }

  function showNext() {
    if (fading) return;
    const nextIndex = (index + 1) % logos.length;
    const incoming = slots[1 - front];
    const outgoing = slots[front];

    const begin = () => {
      fading = true;
      incoming.classList.add('is-shown');
      outgoing.classList.remove('is-shown');
      const shownIndex = nextIndex;
      front = 1 - front;
      index = nextIndex;
      prepareOutgoing(outgoing, shownIndex);
    };

    if (incoming.complete && incoming.naturalWidth > 0) {
      begin();
      return;
    }

    incoming.addEventListener('load', begin, { once: true });
  }

  function start() {
    if (reduceMotion || timer) return;
    timer = window.setInterval(showNext, 2800);
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

  slots[0].classList.add('is-shown');
  start();
})();
