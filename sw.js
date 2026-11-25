// Service worker: keeps a full copy of the app on the device so it works with no connection.
// Bump VERSION whenever files change so phones pick up the new copy.
const VERSION = 'v3';
const CACHE = 'linguadrive-' + VERSION;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/speech.js',
  './js/packs.js',
  './js/progress.js',
  './js/course.js',
  './js/course/es-a1.js',
  './js/course/es-a2.js',
  './js/course/es-b1.js',
  './js/tutor.js',
  './js/engine.js',
  './js/lesson.js',
  './js/app.js',
  './packs/spanish.js',
  './packs/french.js',
  './packs/german.js',
  './packs/italian.js',
  './packs/template.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('linguadrive-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App files: serve from the device instantly, refresh the copy in the background when online.
// Anything else (the AI tutor, speech services) goes straight to the network.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true }) ||
        (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
      const fresh = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
