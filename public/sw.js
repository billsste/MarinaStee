/* Marina Stee service worker — minimal offline shell.
 *
 * Strategy:
 *   - Static assets (CSS/JS/images/icons): cache-first
 *   - Navigation requests: network-first, cached HTML fallback
 *   - API calls (/api/*) and live data: always network, never cached
 *
 * Keep this small and dumb — heavy SW logic is a maintenance burden, and
 * it complicates the iOS native-shell migration. See
 * reference-marina-stee-pwa-and-ios in shared memory.
 */

// Bumped each time we evict stale precached chunks. The activate handler
// deletes any cache whose name doesn't match the current one, so changing
// this string is the kill-switch for old assets. v3 = dock PWA polish pass
// (manifest icons, precache extension, navigation error guard).
const CACHE_NAME = "marina-stee-v3";

// Precache the dock shell + the home icon endpoints. The Next-generated
// /icon and /apple-icon routes resolve to PNGs, so they're safe to cache
// long-term — they only change when the app/icon.tsx source changes,
// which itself forces a SW bump via CACHE_NAME.
const PRECACHE_URLS = [
  "/dock",
  "/",
  "/manifest.webmanifest",
  "/icon",
  "/apple-icon",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Best-effort: don't fail install if a URL 404s during dev.
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Allow the page to kick a waiting SW into active state without a tab
// reload. The register helper posts { type: 'SKIP_WAITING' } after an
// update is detected. Without this, an iOS PWA install never picks up
// the new SW until the user fully kills the app.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Ignore non-http(s) schemes — chrome-extension://, devtools://, etc.
  // would throw at cache.put() and log a confusing error in the console.
  if (!req.url.startsWith("http")) return;

  const url = new URL(req.url);

  // Never touch API or live-data routes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/data/")) {
    return;
  }

  // Static assets: cache-first
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon" ||
    url.pathname === "/apple-icon" ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Navigations: network-first, fall back to cache, then to the dock shell.
  // Only cache 2xx responses — otherwise a transient 502 from the origin
  // would poison the cache and the offline fallback would serve the error
  // page forever.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || caches.match("/dock"))
        )
    );
  }
});
