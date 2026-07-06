// Minimal same-origin service worker (required for PWA installability).
// Registered directly as a same-origin file — blob: URLs are blocked by
// most browsers for ServiceWorker registration for security reasons.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', e => {});
