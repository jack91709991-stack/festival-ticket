const CACHE_NAME = 'fes-ticket-v3';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'index.css',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  // CDN scripts & styles
  'https://unpkg.com/html5-qrcode',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=M+PLUS+1p:wght@400;500;700&display=swap'
];

// Install Event - Caching all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching static assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Cache first with network fallback for static assets
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // Bypass cache for Google Apps Script Web App calls (always go to network)
  if (requestUrl.hostname === 'script.google.com' || requestUrl.hostname === 'script.googleusercontent.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-First strategy for static assets
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache, but fetch in background to update (Stale-While-Revalidate pattern)
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            }
          }).catch(err => console.log('Background fetch failed (offline):', err));
          
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(event.request).then(networkResponse => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          // Cache the newly fetched resource
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
      }).catch(() => {
        // Fallback for offline mode when no cache match
        if (event.request.mode === 'navigate') {
          return caches.match('index.html');
        }
      })
  );
});
