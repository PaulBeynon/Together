const CACHE = 'together-v3';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only intercept same-origin GET requests. Cross-origin calls (the
  // togetherChat Cloud Function, fonts, etc.) and non-GET requests
  // (POST/PUT) are left completely alone — Safari's service worker
  // implementation can fail ("Load failed") when it tries to handle
  // those, so it's safest to never touch them.
  if(url.origin !== self.location.origin || e.request.method !== 'GET'){
    return;
  }

  const isPage = e.request.mode === 'navigate' || e.request.destination === 'document';

  if(isPage){
    // network-first for the app shell — always try to get the latest
    // version, only falling back to cache when actually offline
    e.respondWith(
      fetch(e.request)
        .then(res => {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // cache-first for other static assets (fonts, icons, etc.)
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});

/* ---- FIREBASE / FCM: push handling goes here in the next pass ----
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Together', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./index.html'));
});
------------------------------------------------------------------ */
