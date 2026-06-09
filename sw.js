const CACHE_NAME = 'rtttl-studio-v1';
const STATIC_ASSETS = [
  '/RTTTL/',
  '/RTTTL/index.html',
  '/RTTTL/manifest.json',
  '/RTTTL/js/app.js',
  '/RTTTL/js/rtttl-engine.js',
  '/RTTTL/js/audio-engine.js',
  '/RTTTL/js/piano-roll.js',
  '/RTTTL/js/midi-parser.js'
];

const CDN_CACHE = 'rtttl-cdn-v1';
const CDN_URLS = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
  'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.all.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('Failed to cache static asset:', err);
        });
      }),
      caches.open(CDN_CACHE).then(cache => {
        return Promise.allSettled(
          CDN_URLS.map(url =>
            fetch(url).then(response => {
              if (response.ok) cache.put(url, response);
            }).catch(err => {
              console.warn('Failed to cache CDN resource:', url, err);
            })
          )
        );
      })
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== CDN_CACHE)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.url.startsWith('http')) {
    if (event.request.url.includes('cdn.') || event.request.url.includes('jsdelivr')) {
      event.respondWith(
        caches.open(CDN_CACHE).then(cache => {
          return cache.match(event.request).then(cached => {
            const fetchPromise = fetch(event.request).then(response => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            }).catch(() => cached);
            return cached || fetchPromise;
          });
        })
      );
      return;
    }

    if (url.pathname.startsWith('/RTTTL/')) {
      event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
          return cache.match(event.request).then(cached => {
            const fetchPromise = fetch(event.request).then(response => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            }).catch(() => cached);
            return cached || fetchPromise;
          });
        })
      );
      return;
    }
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
