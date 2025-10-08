const CACHE_NAME = 'messenger-v2';
const DEFAULT_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%234F46E5'/%3E%3Ctext x='50' y='70' font-size='60' text-anchor='middle' fill='white' font-family='Arial, sans-serif' font-weight='bold'%3EM%3C/text%3E%3C/svg%3E";

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD-JW_GPcXYE6Mo87wKDAKKtRSwIGzLp5g',
  authDomain: 'lchat3-7ad86.firebaseapp.com',
  projectId: 'lchat3-7ad86',
  storageBucket: 'lchat3-7ad86.firebasestorage.app',
  messagingSenderId: '956958925747',
  appId: '1:956958925747:web:966a2906f540538251a1c6'
};

var messaging = null;

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

var notificationHistory = {};
var notificationOrder = [];
var DEDUPE_TTL = 2000;
var HISTORY_LIMIT = 200;

var clientState = {};
var CLIENT_STATE_TTL = 60000;

function pruneHistory(now) {
  while (notificationOrder.length > 0) {
    var key = notificationOrder[0];
    var ts = notificationHistory[key];
    if (typeof ts !== 'number' || now - ts > DEDUPE_TTL) {
      notificationOrder.shift();
      delete notificationHistory[key];
    } else {
      break;
    }
  }
}

function isDuplicate(key) {
  if (!key) return false;
  var now = Date.now();
  pruneHistory(now);

  var last = notificationHistory[key];
  notificationHistory[key] = now;
  notificationOrder.push(key);

  return typeof last === 'number' && now - last < DEDUPE_TTL;
}

function updateClientState(clientId, partialState) {
  if (!clientId) return;
  partialState = partialState || {};

  var prev = clientState[clientId] || {};
  var next = {
    chatId: partialState.chatId !== undefined ? partialState.chatId : (prev.chatId || null),
    isVisible: typeof partialState.isVisible === 'boolean' ? partialState.isVisible : !!prev.isVisible,
    hasFocus: typeof partialState.hasFocus === 'boolean' ? partialState.hasFocus : !!prev.hasFocus,
    timestamp: Date.now()
  };

  clientState[clientId] = next;
}

function cleanupClientState() {
  var now = Date.now();
  Object.keys(clientState).forEach(function(clientId) {
    var state = clientState[clientId];
    if (!state || now - state.timestamp > CLIENT_STATE_TTL) {
      delete clientState[clientId];
    }
  });
}

function buildNotificationOptions(options) {
  options = options || {};
  return {
    body: options.body || 'You have a new message',
    icon: DEFAULT_ICON,
    badge: DEFAULT_ICON,
    tag: options.tag || 'message-notification',
    data: options.data || {},
    requireInteraction: false,
    vibrate: [200, 100, 200]
  };
}

function extractUrlFromPayload(payload) {
  if (!payload) return '/';
  if (payload.fcmOptions && payload.fcmOptions.link) {
    return payload.fcmOptions.link;
  }
  if (payload.data && payload.data.url) {
    return payload.data.url;
  }
  return '/';
}

function showNotification(params) {
  params = params || {};
  var title = params.title || 'Notification';
  var tag = params.data && params.data.tag ? params.data.tag : (params.tag || null);
  var key = tag || (title + '|' + (params.body || ''));

  if (isDuplicate(key)) {
    console.log('[SW] Skip duplicate notification', key);
    return Promise.resolve();
  }

  var options = buildNotificationOptions({
    body: params.body,
    data: params.data,
    tag: tag
  });

  return self.registration.showNotification(title, options);
}

function showNotificationFromPayload(payload) {
  payload = payload || {};
  var data = {};

  if (payload.data) {
    for (var k in payload.data) {
      if (Object.prototype.hasOwnProperty.call(payload.data, k)) {
        data[k] = payload.data[k];
      }
    }
  }

  var notification = payload.notification || {};
  var title = notification.title || data.title || data.sender || 'New message';
  var body = notification.body || data.body || data.text || 'You have a new message';

  var messageId = data.messageId || data.id || data.mid || payload.messageId || data.messageID || data.msgId;
  if (messageId) {
    data.messageId = messageId;
  }

  var chatId = data.chatId || data.chatID || data.threadId || data.roomId;
  if (chatId) {
    data.chatId = chatId;
  }

  if (!data.url) {
    data.url = extractUrlFromPayload(payload);
  }

  if (!data.tag) {
    if (messageId) {
      data.tag = 'message-' + messageId;
    } else if (chatId) {
      data.tag = 'chat-' + chatId;
    }
  }

  return showNotification({
    title: title,
    body: body,
    data: data,
    tag: data.tag
  });
}

function shouldSuppressForActiveClient(data) {
  data = data || {};
  cleanupClientState();

  var chatId = data.chatId || data.chatID || data.threadId || data.roomId;
  if (!chatId) return Promise.resolve(false);

  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
    var now = Date.now();
    for (var i = 0; i < clientList.length; i++) {
      var client = clientList[i];
      var state = clientState[client.id];
      if (!state) continue;
      if (now - state.timestamp > CLIENT_STATE_TTL) {
        delete clientState[client.id];
        continue;
      }
      if (state.chatId === chatId && state.isVisible && state.hasFocus) {
        return true;
      }
    }
    return false;
  });
}

// Service Worker lifecycle -------------------------------------------------
self.addEventListener('install', function(event) {
  console.log('[SW] install');
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', function(event) {
  console.log('[SW] activate');
  event.waitUntil(
    Promise.all([
      caches.keys().then(function(cacheNames) {
        return Promise.all(cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
          return null;
        }));
      }),
      clients.claim()
    ])
  );
});

self.addEventListener('fetch', function(event) {
  var requestUrl = new URL(event.request.url);

  if (
    requestUrl.origin.indexOf('firebase') !== -1 ||
    requestUrl.origin.indexOf('google') !== -1 ||
    requestUrl.origin.indexOf('gstatic') !== -1 ||
    requestUrl.origin.indexOf('googleapis') !== -1 ||
    requestUrl.origin.indexOf('cloudflare') !== -1 ||
    requestUrl.origin.indexOf('unpkg') !== -1 ||
    requestUrl.origin.indexOf('cdnjs') !== -1 ||
    requestUrl.pathname.indexOf('favicon.ico') !== -1 ||
    requestUrl.pathname.indexOf('manifest.json') !== -1 ||
    requestUrl.protocol === 'chrome-extension:'
  ) {
    event.respondWith(fetch(event.request).catch(function() {
      return new Response('', { status: 404 });
    }));
    return;
  }

  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          return caches.match(event.request).then(function(cached) {
            return cached || new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        if (response) return response;
        return fetch(event.request).then(function(fetchResponse) {
          if (fetchResponse && fetchResponse.status === 200 && event.request.method === 'GET') {
            var clone = fetchResponse.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return fetchResponse;
        });
      })
      .catch(function() {
        return new Response('Offline', { status: 503 });
      })
  );
});

// Messaging handlers -------------------------------------------------------
self.addEventListener('push', function(event) {
  if (!event.data) return;

  var payload = {};
  try {
    payload = event.data.json() || {};
  } catch (error) {
    console.warn('[SW] push payload parse error', error);
  }

  if (payload.notification && !(payload.data && payload.data.forceManual === '1')) {
    console.log('[SW] Skip manual notification (FCM will display it)');
    return;
  }

  event.waitUntil(
    shouldSuppressForActiveClient(payload.data || {}).then(function(suppress) {
      if (suppress) {
        console.log('[SW] Notification suppressed for active chat', payload.data && payload.data.chatId);
        return;
      }
      return showNotificationFromPayload(payload);
    })
  );
});

self.addEventListener('message', function(event) {
  var clientId = event.source && event.source.id;
  var messageData = event.data || {};

  if (!clientId || !messageData.type) return;

  if (messageData.type === 'CLIENT_STATE') {
    updateClientState(clientId, messageData.state || {});
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var notificationData = event.notification && event.notification.data ? event.notification.data : {};
  var targetUrl = notificationData.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && client.focus) {
          try {
            client.postMessage({ type: 'notification-click', data: notificationData });
          } catch (err) {
            console.warn('[SW] postMessage failed:', err);
          }
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
