const CACHE_NAME = 'tic2tic-v3.0';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@800&family=Playfair+Display:wght@700&family=Inter:wght@400;600&display=swap'
];

// Install event
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching app assets');
        return cache.addAll(ASSETS);
      })
      .then(() => {
        console.log('Service Worker installed');
        return self.skipWaiting();
      })
  );
});

// Activate event
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker activated');
        return self.clients.claim();
      })
  );
});

// Fetch event with network-first strategy
self.addEventListener('fetch', e => {
  // Skip non-GET requests
  if (e.request.method !== 'GET') return;
  
  // Skip chrome-extension requests
  if (e.request.url.startsWith('chrome-extension://')) return;
  
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Cache the response
        const responseClone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(e.request, responseClone));
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(e.request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // If not in cache, return offline page or index.html
            if (e.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});

// Background sync for updates
self.addEventListener('sync', e => {
  if (e.tag === 'update-quotes') {
    e.waitUntil(updateQuotes());
  }
  
  if (e.tag === 'update-timezone') {
    e.waitUntil(updateTimezoneData());
  }
});

// Periodic sync (if supported)
if ('periodicSync' in self.registration) {
  self.registration.periodicSync.register('update-quotes', {
    minInterval: 24 * 60 * 60 * 1000 // Once per day
  }).catch(err => {
    console.log('Periodic sync could not be registered:', err);
  });
}

async function updateQuotes() {
  // Could fetch new quotes from API in future
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('/');
  if (response.ok) {
    await cache.put('/', response);
  }
  return;
}

async function updateTimezoneData() {
  // Update timezone information in background
  console.log('Updating timezone data');
  return;
}

// Push notifications
self.addEventListener('push', e => {
  if (!e.data) return;
  
  const data = e.data.json();
  const options = {
    body: data.body || 'Time is ticking!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    },
    actions: [
      {
        action: 'open',
        title: 'Open Tic2Tic'
      },
      {
        action: 'close',
        title: 'Close'
      }
    ]
  };
  
  e.waitUntil(
    self.registration.showNotification(data.title || 'Tic2Tic', options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  
  if (e.action === 'open') {
    e.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Message handling
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
