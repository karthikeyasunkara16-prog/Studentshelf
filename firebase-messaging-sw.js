// =====================================================
// StudentShelf Firebase Messaging Service Worker
// =====================================================

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Initialize Firebase within the Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyDFZn2f8kH_mFgzH5FIJdARgIaQ0hn0kqM",
  authDomain: "studentshelf.firebaseapp.com",
  projectId: "studentshelf",
  storageBucket: "studentshelf.firebasestorage.app",
  messagingSenderId: "220940888620",
  appId: "1:220940888620:web:9a1a8471f54117c37f3f89",
  measurementId: "G-CSMR5XLSMK"
});

const messaging = firebase.messaging();

// Handle background push messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);
  const notificationTitle = payload.notification?.title || payload.data?.title || "StudentShelf Update";
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || "You have a new update.",
    icon: '/icon.png',
    badge: '/badge.png',
    data: { url: payload.data?.url || '#/messages' }
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click to navigate user
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '#/messages';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Import existing PWA offline caching logic seamlessly
try {
  importScripts('/sw.js');
} catch (e) {
  console.log('[firebase-messaging-sw.js] sw.js cache import skipped or fallback:', e);
}
