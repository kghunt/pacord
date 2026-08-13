// Minimal service worker — required for PWA installability.
// No caching: everything goes straight to the server (this app needs a live connection).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
