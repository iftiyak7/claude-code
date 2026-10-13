/* BizLedger service worker (served from /{slug}/sw.js with BZL_VERSION and
 * BZL_ASSETS prepended by PHP).
 *
 * - App shell + static assets: stale-while-revalidate, so the app opens
 *   instantly and offline.
 * - REST API calls: always network (financial data must be live); the app
 *   itself falls back to its IndexedDB snapshot when offline.
 */
/* global BZL_VERSION, BZL_ASSETS */
const CACHE = `bizledger-${BZL_VERSION}`;
const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    SCOPE,
    `${BZL_ASSETS}css/app.css?v=${BZL_VERSION}`,
    `${BZL_ASSETS}js/app.js?v=${BZL_VERSION}`,
    `${BZL_ASSETS}img/icon.svg?v=${BZL_VERSION}`,
  ]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('bizledger-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/wp-json/') || url.searchParams.has('rest_route') || url.pathname.includes('/print/')) return;

  const isAsset = req.url.startsWith(BZL_ASSETS);
  const isShell = req.mode === 'navigate' && req.url.startsWith(SCOPE);
  if (!isAsset && !isShell) return;

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = isShell ? SCOPE : req;
    const cached = await cache.match(key);
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
