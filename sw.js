const CACHE_NAME = 'messenger-v2';
const DEFAULT_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%234F46E5'/%3E%3Ctext x='50' y='70' font-size='60' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-weight='bold'%3EM%3C/text%3E%3C/svg%3E";

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD-JW_GPcXYE6Mo87wKDAKKtRSwIGzLp5g',
  authDomain: 'lchat3-7ad86.firebaseapp.com',
  projectId: 'lchat3-7ad86',
  storageBucket: 'lchat3-7ad86.firebasestorage.app',
  messagingSenderId: '956958925747',
  appId: '1:956958925747:web:966a2906f540538251a1c6'
};

let messaging = null;

try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

  if (!(self.firebase && firebase.apps && firebase.apps.length)) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  messaging = firebase.messaging();
  console.log('[SW] Firebase Messaging initialised');
} catch (error) {
  console.warn('[SW] Unable to initialise Firebase Messaging:', error);
}

const buildNotificationOptions = ({ body, data = {}, tag }) => ({
  body: body || 'У вас новое сообщение',
  icon: DEFAULT_ICON,
  badge: DEFAULT_ICON,
  tag: tag || 'message-notification',
  data,
  requireInteraction: false,
  vibrate: [200, 100, 200]
});

const notificationHistory = new Map();
const DEDUPE_TTL = 2000;
const HISTORY_LIMIT = 200;

const isDuplicate = key => {
  if (!key) return false;
  const now = Date.now();
  const last = notificationHistory.get(key);
  notificationHistory.set(key, now);

  if (notificationHistory.size > HISTORY_LIMIT) {
    for (const [storedKey, timestamp] of notificationHistory) {
      if (now - timestamp > DEDUPE_TTL) {
        notificationHistory.delete(storedKey);
      }
      if (notificationHistory.size <= HISTORY_LIMIT) {
        break;
      }
    }
  }

  return typeof last === 'number' && now - last < DEDUPE_TTL;
};

const getTagFromData = data => {
  if (!data) return 'message-notification';
  if (data.messageId) return `message-${data.messageId}`;
  if (data.chatId) return `chat-${data.chatId}`;
  if (data.tag) return data.tag;
  return 'message-notification';
};

const extractUrlFromPayload = payload => {
  if (payload?.fcmOptions?.link) return payload.fcmOptions.link;
  if (payload?.data?.url) return payload.data.url;
  return '/';
};

const showNotification = ({ title, body, data = {} }) => {
  const tag = getTagFromData(data);
  const key = tag || `${title}|${body}`;

  if (isDuplicate(key)) {
    console.log('[SW] Skip duplicate notification', key);
    return Promise.resolve();
  }

  const options = buildNotificationOptions({ body, data, tag });
  return self.registration.showNotification(title || 'Сообщение', options);
};

const showNotificationFromPayload = payload => {
  const title =
    payload?.notification?.title || payload?.data?.title || payload?.data?.sender || 'Новое сообщение';
  const body =
    payload?.notification?.body || payload?.data?.body || payload?.data?.text || 'У вас новое сообщение';
  const data = { ...(payload?.data || {}) };

  if (!data.url) {
    data.url = extractUrlFromPayload(payload);
  }

  return showNotification({ title, body, data });
};

// Service Worker lifecycle -------------------------------------------------
self.addEventListener('install', event => {
  console.log('[SW] install');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then(() => {
      console.log('[SW] cache opened');
    })
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] activate');
  event.waitUntil(
    Promise.all([
      caches.keys().then(cacheNames =>
        Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] delete old cache:', cacheName);
              return caches.delete(cacheName);
            }
            return null;
          })
        )
      ),
      clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

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
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 404 })));
    return;
  }

  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached => cached || new Response('Offline', { status: 503 }))
        )
    );
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then(
        response =>
          response ||
          fetch(event.request).then(fetchResponse => {
            if (fetchResponse && fetchResponse.status === 200 && event.request.method === 'GET') {
              const clone = fetchResponse.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return fetchResponse;
          })
      )
      .catch(() => new Response('Offline', { status: 503 }))
  );
});

// Messaging handlers -------------------------------------------------------
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json() || {};
  } catch (error) {
    console.warn('[SW] push payload parse error', error);
  }

  event.waitUntil(showNotificationFromPayload(payload));
});

self.addEventListener('message', event => {
  const data = event.data || {};

  if (data.type === 'NEW_MESSAGE') {
    const { sender, text, chatId, messageId, url } = data;
    const notificationData = {
      title: sender || 'Новое сообщение',
      body: text || 'У вас новое сообщение',
      data: {
        chatId,
        messageId,
        url: url || (chatId ? `/chat/${chatId}` : '/'),
        tag: messageId ? `message-${messageId}` : chatId ? `chat-${chatId}` : undefined
      }
    };

    event.waitUntil(showNotification(notificationData));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'notification-click', data: event.notification?.data || {} });
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
