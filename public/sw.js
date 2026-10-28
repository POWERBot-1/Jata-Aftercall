/* JATA AFTERCALL service worker — privacy-safe selective caching (Phase 8).
 *
 * Caches ONLY versioned, public, same-origin static assets and the offline notice. It never
 * caches an HTML navigation, an API response, an authenticated page, a preview draft, a checkout
 * page, a payment response or anything with a query string. AI answers, payment verification,
 * publishing and POS synchronisation always require a live connection.
 */
const VERSION = "jata-aftercall-pwa-1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-64.png",
];

// Versioned build output + curated public media only. The extension allowlist prevents an
// arbitrary path under these prefixes (e.g. an API-ish route) from being stored.
const SAFE_ASSET = /^\/(?:_next\/static\/|icons\/|landing\/|category\/|workspace\/)[^?]*\.(?:js|mjs|css|woff2?|png|jpe?g|webp|svg|ico|json)$/;

const SENSITIVE_PREFIXES = [
  "/api/", "/dashboard", "/admin", "/checkout", "/receipt", "/login", "/register",
  "/forgot-password", "/reset-password", "/onboarding", "/dev/", "/b/", "/r/", "/health",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // A single missing optional asset must not break installation; the offline page is required.
    await Promise.all(PRECACHE.map(async (url) => {
      try { await cache.add(new Request(url, { cache: "reload" })); } catch { /* optional asset */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("jata-aftercall-") && name !== STATIC_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isSafeStatic(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (url.search) return false; // preview, tracking and signed URLs are never cached
  if (SENSITIVE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return false;
  if (request.headers.has("Authorization") || request.headers.has("Cookie")) return false;
  return SAFE_ASSET.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try { url = new URL(request.url); } catch { return; }

  // Navigations: always network-first and NEVER written to the cache. On failure, serve the
  // honest offline notice (installed at activate time) instead of a stale private page.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Bypass the browser HTTP cache: a prerendered or authenticated HTML page must never be
        // replayed from disk. If the network genuinely fails, show the honest offline notice.
        return await fetch(request, { cache: "no-store" });
      } catch {
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response("You are offline. Reconnect to use JATA AFTERCALL.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })());
    return;
  }

  if (!isSafeStatic(request, url)) return;

  // Stale-while-revalidate for public static assets only.
  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then(async (response) => {
      if (response.ok && response.type === "basic" && !/no-store|private/i.test(response.headers.get("Cache-Control") || "")) {
        try { await cache.put(request, response.clone()); } catch { /* quota or opaque response */ }
      }
      return response;
    }).catch(() => null);
    if (cached) { void network; return cached; }
    return (await network) || new Response("", { status: 504, statusText: "Offline" });
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
