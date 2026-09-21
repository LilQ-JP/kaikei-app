/**
 * Service Worker for フリーランス会計 PWA
 * Provides offline caching with cache-first strategy for static assets
 * and network-first strategy for navigation requests.
 */

const CACHE_NAME = "kaikei-v1";

// Assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Install: pre-cache essential assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for navigation, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension, analytics, and dev server requests
  if (
    request.url.includes("chrome-extension") ||
    request.url.includes("__manus__") ||
    request.url.includes("umami") ||
    request.url.includes("hot-update")
  ) {
    return;
  }

  // 会計データAPIは必ずサーバーへ到達させ、古いデータを返さない。
  if (new URL(request.url).pathname.startsWith("/api/")) return;

  // Navigation requests: network-first with fallback to cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match("/") || caches.match(request))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first
  if (
    request.url.match(/\.(js|css|png|jpg|jpeg|svg|gif|woff2?|ttf|eot)(\?.*)?$/) ||
    request.url.includes("fonts.googleapis.com") ||
    request.url.includes("fonts.gstatic.com")
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Other requests: network-first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
