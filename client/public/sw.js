// Spliiit Service Worker - enables "Add to Home Screen"
const CACHE_NAME = 'spliiit-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Network-first strategy for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Don't cache API calls or auth endpoints
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  
  // For everything else, try network first, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
