const CACHE_NAME = 'messenger-v1';
const urlsToCache = [
  '/',
  '/index.html'
];

// Установка Service Worker
self.addEventListener('install', event => {
  console.log('Cache SW: Установка...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache SW: Кэширование файлов');
        return cache.addAll(urlsToCache);
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', event => {
  console.log('Cache SW: Активация...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Cache SW: Удаление старого кэша', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Перехват запросов
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});

// Прием сообщений от приложения для локальных уведомлений
self.addEventListener('message', event => {
  console.log('Cache SW получил сообщение:', event.data);
  
  if (event.data && event.data.type === 'NEW_MESSAGE') {
    const { sender, text, chatId } = event.data;
    
    // Показываем локальное уведомление (только когда приложение открыто)
    self.registration.showNotification(sender, {
      body: text,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      tag: 'message-' + chatId,
      requireInteraction: false,
      vibrate: [200, 100, 200],
      data: {
        chatId: chatId,
        url: '/'
      }
    });
  }
});

// Клик по уведомлению
self.addEventListener('notificationclick', event => {
  console.log('Клик по уведомлению:', event);
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
