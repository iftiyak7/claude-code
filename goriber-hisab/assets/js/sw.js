/* Goriber Hisab no longer uses a service worker on the website (the Android app
 * carries its own copy of the app). Browsers that still run one from an older
 * version fetch this file, which wipes the old caches, removes itself and reloads
 * the open tabs so they get the current files.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('goriber-hisab')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const tabs = await self.clients.matchAll({ type: 'window' });
    tabs.forEach((c) => c.navigate(c.url).catch(() => {}));
  })());
});
