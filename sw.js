const CACHE_NAME = 'messenger-v2';

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('✅ Cache SW: Установка...');
  self.skipWaiting(); // Активируемся сразу
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Cache SW: Кэш готов');
        return Promise.resolve();
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', event => {
  console.log('✅ Cache SW: Активация...');
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('🗑️ Удаление старого кэша:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      clients.claim()
    ])
  );
});

// Перехват запросов
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Игнорируем запросы к внешним ресурсам
  if (
    url.origin.includes('firebase') ||
    url.origin.includes('google') ||
    url.origin.includes('gstatic') ||
    url.origin.includes('googleapis') ||
    url.origin.includes('cloudflare') ||
    url.origin.includes('unpkg') ||
    url.origin.includes('cdnjs') ||
    url.pathname.includes('favicon.ico') ||
    url.pathname.includes('manifest.json') ||
    url.protocol === 'chrome-extension:'
  ) {
    // Пропускаем эти запросы без кэширования
    event.respondWith(fetch(event.request).catch(() => {
      return new Response('', { status: 404 });
    }));
    return;
  }
  
  // Для HTML страниц - network first
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cachedResponse => {
              return cachedResponse || new Response('Offline', { status: 503 });
            });
        })
    );
    return;
  }
  
  // Для остальных - cache first
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request)
          .then(fetchResponse => {
            if (fetchResponse && fetchResponse.status === 200 && event.request.method === 'GET') {
              const responseClone = fetchResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return fetchResponse;
          });
      })
      .catch(() => new Response('Offline', { status: 503 }))
  );
});

// Прием сообщений для локальных уведомлений
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'NEW_MESSAGE') {
    const { sender, text } = event.data;
    
    self.registration.showNotification(sender, {
      body: text,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      tag: 'message-notification',
      requireInteraction: false,
      vibrate: [200, 100, 200]
    });
  }
});

// Клик по уведомлению
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (let client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});