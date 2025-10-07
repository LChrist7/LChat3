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

const NOTIFICATION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TRACKED_NOTIFICATIONS = 300;
const trackedNotificationIds = new Map();

function pruneTrackedNotifications(now = Date.now()) {
  for (const [id, timestamp] of trackedNotificationIds.entries()) {
    if (now - timestamp > NOTIFICATION_TTL_MS) {
      trackedNotificationIds.delete(id);
    }
  }

  if (trackedNotificationIds.size > MAX_TRACKED_NOTIFICATIONS) {
    const ordered = [...trackedNotificationIds.entries()].sort((a, b) => a[1] - b[1]);
    while (ordered.length > MAX_TRACKED_NOTIFICATIONS) {
      const [oldestId] = ordered.shift();
      trackedNotificationIds.delete(oldestId);
    }
  }
}

function hasTrackedNotification(id) {
  if (!id) {
    return false;
  }

  const now = Date.now();
  const timestamp = trackedNotificationIds.get(id);

  if (timestamp && now - timestamp <= NOTIFICATION_TTL_MS) {
    return true;
  }

  if (timestamp) {
    trackedNotificationIds.delete(id);
  }

  return false;
}

function trackNotification(id) {
  if (!id) {
    return;
  }

  const now = Date.now();
  pruneTrackedNotifications(now);
  trackedNotificationIds.set(id, now);
}

function resolveNotificationTag(data = {}) {
  return data.tag || `chat-${data.chatId || data.conversationId || data.threadId || 'default'}`;
}

async function ensureUniqueNotification(tag, messageId) {
  if (!self.registration || !self.registration.getNotifications) {
    return true;
  }

  try {
    const notifications = await self.registration.getNotifications({ tag, includeTriggered: true });
    let duplicateFound = false;

    for (const notification of notifications) {
      const existingId = notification.data?.messageId || notification.data?.dedupeKey;

      if (messageId && existingId === messageId) {
        duplicateFound = true;
      } else if (!messageId && notification.tag === tag && !existingId) {
        duplicateFound = true;
      } else if (notification.tag === tag && (!messageId || existingId !== messageId)) {
        notification.close();
      }
    }

    return !duplicateFound;
  } catch (error) {
    console.warn('Не удалось получить активные уведомления для дедупликации:', error);
    return true;
  }
}

async function displayNotification({
  title,
  body,
  data = {},
  tag,
  requireInteraction = false,
  vibrate = [200, 100, 200]
}) {
  const resolvedTag = tag || resolveNotificationTag(data);
  const messageId = data.messageId || data.messageID || data.id;
  const dedupeKey = messageId || `${resolvedTag}:${body || ''}`;

  if (hasTrackedNotification(dedupeKey)) {
    return;
  }

  trackNotification(dedupeKey);

  if (!(await ensureUniqueNotification(resolvedTag, messageId || dedupeKey))) {
    return;
  }

  const notificationOptions = {
    body,
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    tag: resolvedTag,
    data: {
      ...data,
      messageId: messageId || dedupeKey,
      dedupeKey,
      displayedAt: Date.now()
    },
    requireInteraction,
    vibrate,
    timestamp: Date.now(),
    renotify: false
  };

  try {
    await self.registration.showNotification(title || 'Новое сообщение', notificationOptions);
  } catch (error) {
    console.error('Не удалось показать уведомление:', error);
    trackedNotificationIds.delete(dedupeKey);
  }
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

async function handleNotificationPayload(payload, source = 'push') {
  if (!payload) {
    return;
  }

  const notificationData = payload.data ? { ...payload.data } : { ...payload };

  if (payload.notification) {
    notificationData.title = notificationData.title || payload.notification.title;
    notificationData.body = notificationData.body || payload.notification.body;
  }

  const messageId = payload.messageId || payload.messageID || notificationData.messageId || notificationData.messageID || notificationData.id;
  const title = notificationData.title || 'Новое сообщение';
  const body = notificationData.body || notificationData.text || 'У вас новое сообщение';

  await displayNotification({
    title,
    body,
    data: {
      ...notificationData,
      messageId: messageId,
      source,
    }
  });
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log('Фоновое сообщение получено:', payload);
    handleNotificationPayload(payload, 'messaging');
  });
}

self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};

  try {
    payload = event.data.json();
  } catch (error) {
    console.warn('Не удалось распарсить push payload как JSON:', error);
    try {
      payload = { data: { body: event.data.text() } };
    } catch (textError) {
      console.warn('Не удалось извлечь текст из push payload:', textError);
    }
  }

  if (event.stopImmediatePropagation) {
    event.stopImmediatePropagation();
  }

  event.waitUntil(handleNotificationPayload(payload, 'push'));
});

async function handleLocalNotificationMessage(message) {
  const { sender, text, chatId, messageId } = message;

  await displayNotification({
    title: sender || 'Новое сообщение',
    body: text || 'У вас новое сообщение',
    tag: resolveNotificationTag({ chatId }),
    data: {
      chatId,
      sender,
      messageId,
      source: 'local'
    }
  });
}

// Прием сообщений для локальных уведомлений
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'NEW_MESSAGE') {
    const promise = handleLocalNotificationMessage(event.data);
    if (event.waitUntil) {
      event.waitUntil(promise);
    }
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
