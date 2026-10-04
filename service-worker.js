// Service worker: keeps the app installable and available offline,
// but always prefers the freshest version when online.
const CACHE_NAME = 'registro-chiamate-v5';
const APP_SHELL = [
  './crm-chiamate-standalone.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Tocco su una notifica (follow-up / appuntamento): riporta in primo piano
// l'app se è già aperta, altrimenti la apre.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      if (wins.length) return wins[0].focus();
      return self.clients.openWindow('./crm-chiamate-standalone.html');
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Functions (backup, calendario): sempre dalla rete, mai in cache (dati personali).
  if (url.pathname.startsWith('/.netlify/')) return;

  // The app shell (the page itself) is network-first: always try to fetch
  // the latest version online, and only fall back to the cached copy if
  // there is no connection. This is what makes updates show up immediately.
  const isAppShell = event.request.mode === 'navigate' || url.pathname.endsWith('.html');
  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets (icons, manifest) rarely change, so cache-first is fine.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
