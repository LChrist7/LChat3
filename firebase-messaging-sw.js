// Firebase Messaging Service Worker для background notifications
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Firebase конфигурация
const firebaseConfig = {
  apiKey: "AIzaSyD-JW_GPcXYE6Mo87wKDAKKtRSwIGzLp5g",
  authDomain: "lchat3-7ad86.firebaseapp.com",
  projectId: "lchat3-7ad86",
  storageBucket: "lchat3-7ad86.firebasestorage.app",
  messagingSenderId: "956958925747",
  appId: "1:956958925747:web:966a2906f540538251a1c6"
};

// Инициализация Firebase
firebase.initializeApp(firebaseConfig);

// Инициализация Messaging
const messaging = firebase.messaging();

// Обработка фоновых уведомлений (когда приложение закрыто)
messaging.onBackgroundMessage((payload) => {
  console.log('Фоновое сообщение получено:', payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || 'Новое сообщение';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'У вас новое сообщение',
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%234F46E5"/%3E%3Ctext x="50" y="70" font-size="60" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold"%3EM%3C/text%3E%3C/svg%3E',
    tag: 'message-notification',
    data: payload.data || {},
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
  console.log('Клик по уведомлению:', event);
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Если окно уже открыто - фокусируемся
        for (let client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        // Иначе открываем новое окно
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});