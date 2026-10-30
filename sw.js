const CACHE_PREFIX = 'spectrum-pwa-';
const CACHE_NAME = CACHE_PREFIX + '26.10.5';
const ROOT = new URL('./', self.location.href);
const CORE = [
  './index.html', './style.css?v=26.10.5', './app.js?v=26.10.5',
  './peak-tracker.mjs?v=26.10.5', './waterfall.mjs?v=26.10.5', './band-activity.mjs?v=26.10.5', './processor.js', './pwa.js?v=26.10.5',
  './version.json', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png'
].map(path => new URL(path, ROOT).href);
const ASSETS = new Set(CORE);
const HOME = new URL('index.html', ROOT).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch the entire release before committing; do not cache a sign-in redirect.
    const responses = await Promise.all(CORE.map(async url => {
      const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (!response.ok || response.redirected || response.type === 'opaque') throw new Error('App cache unavailable');
      if (!url.endsWith('/index.html') && (response.headers.get('Content-Type') || '').includes('text/html')) throw new Error('Unexpected sign-in response');
      return response;
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(responses.map((response, i) => cache.put(CORE[i], response)));
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin) return;
  const homeNavigation = request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.pathname === new URL(HOME).pathname);
  if (!homeNavigation && !ASSETS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(homeNavigation ? HOME : url.href);
    return cached || fetch(request);
  })());
});
