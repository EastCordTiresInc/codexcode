window.EASTCORD_AUTH_CONFIG = {
  provider: 'supabase',
  supabaseUrl: '',
  supabaseAnonKey: '',
};

(() => {
  if (window.EastCordCartIsolationLoaderLoaded) return;
  window.EastCordCartIsolationLoaderLoaded = true;
  const script = document.createElement('script');
  script.src = 'cart-account-isolation-v2.js?v=2';
  script.defer = true;
  document.head.appendChild(script);
})();
