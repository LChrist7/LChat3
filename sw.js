importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyD-JW_GPcXYE6Mo87wKDAKKtRSwIGzLp5g",
  authDomain: "lchat3-7ad86.firebaseapp.com",
  projectId: "lchat3-7ad86",
  storageBucket: "lchat3-7ad86.firebasestorage.app",
  messagingSenderId: "956958925747",
  appId: "1:956958925747:web:966a2906f540538251a1c6"
};

firebase.initializeApp(firebaseConfig);

let messaging = null;
try {
  messaging = firebase.messaging();
} catch (error) {
  console.warn('Firebase Messaging недоступен в Service Worker:', error);
}

const displayedNotificationIds = new Set();

function shouldDisplayNotification(messageId) {
  if (!messageId) {
    return true;
  }

  if (displayedNotificationIds.has(messageId)) {
    return false;
  }

  displayedNotificationIds.add(messageId);

  if (displayedNotificationIds.size > 100) {
    const iterator = displayedNotificationIds.values();
    const oldest = iterator.next().value;
    if (oldest) {
      displayedNotificationIds.delete(oldest);
    }
  }

  return true;
}

function resolveNotificationTag(data = {}) {
  return data.tag || `chat-${data.chatId || data.conversationId || data.threadId || 'default'}`;
}

const CACHE_NAME = 'messenger-v3';

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

  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }

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

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log('Фоновое сообщение получено:', payload);

    const notificationData = payload.data || {};
    const messageId = notificationData.messageId || notificationData.messageID || notificationData.id;
    const dedupeKey = messageId || (notificationData.chatId ? `${notificationData.chatId}:${notificationData.body || notificationData.text || payload.notification?.body || ''}` : null);

    if (!shouldDisplayNotification(dedupeKey)) {
      return;
    }

    const notificationTitle = payload.notification?.title || payload.data?.title || 'Новое сообщение';
    const notificationOptions = {
      body: payload.notification?.body || payload.data?.body || 'У вас новое сообщение',
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      tag: resolveNotificationTag(notificationData),
      data: {
        ...notificationData,
        messageId: messageId || dedupeKey,
      },
      requireInteraction: false,
      vibrate: [200, 100, 200]
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

// Прием сообщений для локальных уведомлений
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'NEW_MESSAGE') {
    const { sender, text, chatId, messageId } = event.data;
    const dedupeKey = messageId || `${chatId || 'default'}:${text}:${sender}`;

    if (!shouldDisplayNotification(dedupeKey)) {
      return;
    }

    self.registration.showNotification(sender, {
      body: text,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
      tag: resolveNotificationTag({ chatId }),
      data: {
        chatId,
        messageId: messageId || dedupeKey,
      },
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
