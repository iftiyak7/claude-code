/* Offline support: app shell stale-while-revalidate, data network-first, uploads cache-first. */
const CACHE = 'j360-v5';
const SHELL = ['/app/', '/app.css', '/icons.js', '/i18n.js', '/icon.svg', '/manifest.webmanifest',
  '/js/ads.js', '/js/boot.js', '/js/components.js', '/js/data.js', '/js/events.js', '/js/gates.js', '/js/main.js', '/js/page_account.js', '/js/page_classifieds.js', '/js/page_post.js', '/js/pages.js', '/js/router.js', '/js/search.js', '/js/sheets.js', '/js/state.js', '/js/util.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/my') || url.pathname.startsWith('/download')) return;
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok && url.pathname === '/api/bootstrap') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  if (/\.(mp4|webm|mov)$/.test(url.pathname) || e.request.headers.has('range')) return;   // videos stream with Range requests
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit || c.match('/app/'));
    return hit || net;
  }));
});
