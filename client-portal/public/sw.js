/* Only this client's public static shell is cached. No API, images, or staff routes. */
const CACHE = 'homemaster-client-shell-v1';
const ASSETS = ['/client/', '/client/index.html', '/client/styles.css', '/client/app.js', '/client/icon.svg', '/client/icon-192.png', '/client/icon-512.png', '/client/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('homemaster-client-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic') caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || Response.error())));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'CLIENT_LOGOUT') event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('homemaster-client-private-')).map(key => caches.delete(key)))));
});
