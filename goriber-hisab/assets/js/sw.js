/* Goriber Hisab service worker (served from /{slug}/sw.js with BZL_VERSION and
 * BZL_ASSETS prepended by PHP).
 *
 * - Static assets: stale-while-revalidate.
 * - App shell: network first (it carries the signed-in user's nonce), the
 *   cached copy only when offline. Login and print pages are never touched.
 * - REST API calls: always network (financial data must be live); the app
 *   itself falls back to its IndexedDB snapshot when offline.
 */
/* global BZL_VERSION, BZL_ASSETS */
const CACHE = `goriber-hisab-${BZL_VERSION}`;
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
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('goriber-hisab-') && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/wp-json/') || url.searchParams.has('rest_route') || url.pathname.includes('/print/')) return;

  const isAsset = req.url.startsWith(BZL_ASSETS);
  const isShell = req.mode === 'navigate' && url.pathname === new URL(SCOPE).pathname;
  if (!isAsset && !isShell) return;

  if (isShell) {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok && !res.redirected && res.type === 'basic') caches.open(CACHE).then((c) => c.put(SCOPE, res.clone()));
      return res;
    }).catch(() => caches.match(SCOPE).then((r) => r || Response.error())));
    return;
  }
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
