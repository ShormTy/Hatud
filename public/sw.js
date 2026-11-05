// Hatud service worker: installable app; the site itself is never cached (always the newest code).
// Only /offline.html is kept, to show when a page cannot be loaded because there is no internet.
const OFFLINE_CACHE = "hatud-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {}) // if this fails the worker still installs; the app stays installable
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== OFFLINE_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    // Page loads: try the network; only if it fails (no signal) show the offline page.
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }
  // Everything else (scripts, styles, map tiles, Firebase): plain network, nothing cached.
  event.respondWith(fetch(event.request));
});
