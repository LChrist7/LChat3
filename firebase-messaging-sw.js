// Firebase Messaging service worker: background notifications
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: 'AIzaSyD-JW_GPcXYE6Mo87wKDAKKtRSwIGzLp5g',
  authDomain: 'lchat3-7ad86.firebaseapp.com',
  projectId: 'lchat3-7ad86',
  storageBucket: 'lchat3-7ad86.firebasestorage.app',
  messagingSenderId: '956958925747',
  appId: '1:956958925747:web:966a2906f540538251a1c6'
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

const showNotification = (payload = {}) => {
  const title = payload.notification?.title || payload.data?.title || 'Новое уведомление';
  const body = payload.notification?.body || payload.data?.body || 'У вас новое сообщение';

  const options = {
    body,
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    tag: payload.data?.tag || 'message-notification',
    data: payload.data || {},
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(title, options);
};

// Background messages (Chrome, Android, Desktop)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw] onBackgroundMessage', payload);
  return showNotification(payload);
});

// iOS 16.4+ sometimes only fires generic push event, so mirror handling there
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json() || {};
  } catch (error) {
    console.warn('[firebase-messaging-sw] push payload parse error', error);
  }

  event.waitUntil(showNotification(payload));
});

self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw] notificationclick', event);
  event.notification.close();

  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
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
