const CACHE_NAME = 'sitesnap-v1';
const ASSETS = [
  '.',
  'index.html',
  'css/style.css',
  'js/db.js',
  'js/camera.js',
  'js/floorplan.js',
  'js/export.js',
  'js/app.js',
  'js/vendor/jspdf.umd.min.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
