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

const CACHE_NAME = 'messenger-v5';
const RECENT_NOTIFICATION_TTL = 5 * 60 * 1000;
const RECENT_TAG_TTL = 15 * 1000;
const CLIENT_STATE_TTL = 30 * 1000;
const recentNotifications = new Map();
const recentTags = new Map();

const clientState = {
  visible: false,
  focused: false,
  chatId: null,
  timestamp: 0
};

function pruneRecentNotifications(now = Date.now()) {
  for (const [key, timestamp] of recentNotifications.entries()) {
    if (now - timestamp > RECENT_NOTIFICATION_TTL) {
      recentNotifications.delete(key);
    }
  }

  for (const [tag, timestamp] of recentTags.entries()) {
    if (now - timestamp > RECENT_TAG_TTL) {
      recentTags.delete(tag);
    }
  }
}

function updateClientState(update = {}) {
  const now = Date.now();

  if (typeof update.visible === 'boolean') {
    clientState.visible = update.visible;
    if (!update.visible) {
      clientState.focused = false;
    }
  }

  if (typeof update.focused === 'boolean') {
    clientState.focused = update.focused;
  }

  if (update.chatId !== undefined) {
    clientState.chatId = update.chatId;
  }

  clientState.timestamp = update.timestamp || now;
}

function isClientStateFresh(now = Date.now()) {
  return now - clientState.timestamp < CLIENT_STATE_TTL;
}

async function shouldSuppressNotification(data = {}) {
  const now = Date.now();
  const stateFresh = isClientStateFresh(now);

  if (stateFresh && clientState.visible) {
    return true;
  }

  const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windowClients.some((client) => client.visibilityState === 'visible');
}

function resolveNotificationTag(data = {}) {
  return data.tag || `chat-${data.chatId || data.conversationId || data.threadId || 'default'}`;
}

function extractMessageId(data = {}, fallback) {
  return (
    data.messageId ||
    data.messageID ||
    data.id ||
    data.firebaseMessagingMsgId ||
    data.firebaseMessagingMessageId ||
    fallback
  );
}

function buildNotificationPayload(payload = {}) {
  const data = { ...(payload.data || {}) };
  const notification = payload.notification || {};

  const title = data.title || notification.title || 'Новое сообщение';
  const body = data.body || notification.body || data.text || '';

  if (!title && !body) {
    return null;
  }

  const tag = resolveNotificationTag(data);
  const messageId = extractMessageId(data, payload.messageId || payload.messageID);

  return {
    title,
    body,
    tag,
    data: {
      ...data,
      messageId,
      receivedAt: Date.now()
    }
  };
}

async function showNotificationOnce(notification) {
  if (!notification) {
    return;
  }

  const { title, body, tag, data } = notification;
  const now = Date.now();
  const dedupeKey = extractMessageId(data, `${tag}:${body}`);
  const fallbackDedupeKey = tag ? `${tag}:${body}` : body;
  const dedupeKeys = Array.from(new Set([dedupeKey, fallbackDedupeKey].filter(Boolean)));

  if (await shouldSuppressNotification(data)) {
    return;
  }

  pruneRecentNotifications(now);

  if (dedupeKeys.some((key) => recentNotifications.has(key))) {
    return;
  }

  if (tag) {
    const lastShownForTag = recentTags.get(tag);
    if (lastShownForTag && now - lastShownForTag < RECENT_TAG_TTL) {
      return;
    }
  }

  dedupeKeys.forEach((key) => {
    recentNotifications.set(key, now);
  });

  if (tag) {
    recentTags.set(tag, now);
  }

  if (tag && self.registration && self.registration.getNotifications) {
    try {
      const existing = await self.registration.getNotifications({ tag });
      existing.forEach((item) => item.close());
    } catch (error) {
      console.warn('Не удалось получить существующие уведомления:', error);
    }
  }

  const options = {
    body,
    tag,
    data: {
      ...data,
      dedupeKey,
      displayedAt: now
    },
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    renotify: false,
    vibrate: [200, 100, 200]
  };

  try {
    await self.registration.showNotification(title, options);
  } catch (error) {
    console.error('Не удалось показать уведомление:', error);
    dedupeKeys.forEach((key) => {
      recentNotifications.delete(key);
    });
    if (tag) {
      recentTags.delete(tag);
    }
  }
}

if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    const notification = buildNotificationPayload(payload);
    return showNotificationOnce(notification);
  });
}

self.addEventListener('push', (event) => {
  if (messaging) {
    return;
  }

  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch (error) {
    payload = { notification: { title: 'Новое сообщение', body: event.data.text() } };
  }

  const notification = buildNotificationPayload(payload);

  if (!notification) {
    return;
  }

  event.waitUntil(showNotificationOnce(notification));
});

self.addEventListener('message', (event) => {
  if (!event.data) {
    return;
  }

  if (event.data.type === 'CLIENT_STATE') {
    updateClientState(event.data);
    return;
  }

  if (event.data.type !== 'NEW_MESSAGE') {
    return;
  }

  const { sender, text, chatId, messageId } = event.data;
  const notification = {
    title: sender || 'Новое сообщение',
    body: text || 'У вас новое сообщение',
    tag: resolveNotificationTag({ chatId }),
    data: {
      chatId,
      messageId,
      source: 'local'
    }
  };

  const promise = showNotificationOnce(notification);
  if (event.waitUntil) {
    event.waitUntil(promise);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
      return undefined;
    })
  );
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return undefined;
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
