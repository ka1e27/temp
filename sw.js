// Service worker: offline play + installability for Hex Dominion 2.
//
// NETWORK-FIRST for everything same-origin. v1 used cache-first, which is fine
// for a finished game but means a returning player can be served a stale mix of
// files after an update. Network-first always runs the newest deploy when online
// and falls back to the last good copy when offline, when the server fails (5xx),
// when the network is slow (a few seconds) and when a captive portal answers with
// something that is not the file asked for.
//
// The cache name carries a version: activating a new worker deletes the OLD
// `hexdominion-*` caches (v1's 'hexdominion-v1' included), so old files can never be
// mixed in. It deletes NOTHING ELSE: ka1e27.github.io is ONE origin shared by every
// GitHub Pages project of the same owner, and their caches are not ours to touch.
//
// FIRST VISIT: a worker does not control the page that registered it, so nothing that page
// loaded went through the fetch handler below and none of it was cached; reloading offline right
// after a first visit would fail. Two things close that gap: the app shell is cached at install,
// and the page sends the list of everything it loaded (a 'precache' message) once the worker is
// ready, which the worker fetches into the same cache.
//
// Everything is relative to the worker's SCOPE, never to "/": the site lives under a project
// subpath (https://ka1e27.github.io/temp/).
const CACHE_PREFIX = 'hexdominion-';
const CACHE = 'hexdominion-v2-5';
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const NETWORK_TIMEOUT_MS = 3500; // with a cached copy at hand, a network that has not answered by then loses

const isFontHost = (url) => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

/**
 * Is `res` plausibly the thing `req` asked for? A captive portal or a broken proxy answers a `.js` request with an HTML page and a 200: caching or serving it
 * would break the game until the cache is cleared. Judged by what the request is for (its destination, else its extension) against the Content-Type.
 */
function plausible(req, res) {
  if (!res || res.type === 'opaque') return true; // fonts and the like: cannot be inspected
  const type = (res.headers.get('Content-Type') || '').toLowerCase();
  if (!type) return true;
  const path = new URL(req.url).pathname.toLowerCase();
  const dest = req.destination || '';
  const isHtml = type.includes('text/html');
  if (dest === 'script' || /\.m?js$/.test(path)) return type.includes('javascript') || type.includes('ecmascript');
  if (dest === 'style' || /\.css$/.test(path)) return type.includes('css');
  if (dest === 'image' || /\.(png|jpe?g|gif|webp|svg|ico)$/.test(path)) return type.startsWith('image/');
  if (/\.(json|webmanifest)$/.test(path) || dest === 'manifest') return type.includes('json');
  if (dest === 'document' || /\.html?$/.test(path) || path.endsWith('/')) return isHtml;
  return true;
}

/** Fetches each URL into the cache unless it is already there. Best effort: one failure never blocks the rest. */
async function precache(list) {
  const cache = await caches.open(CACHE);
  await Promise.all(list.map(async (raw) => {
    try {
      const url = new URL(raw, self.registration.scope);
      const font = isFontHost(url);
      if (url.origin !== self.location.origin && !font) return;
      if (await cache.match(url.href)) return;
      const req = font ? new Request(url.href, { mode: 'no-cors' }) : new Request(url.href, { cache: 'reload' });
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque') && plausible(req, res)) await cache.put(url.href, res);
    } catch { /* offline, or a file that does not exist: skip it */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache(SHELL));
  self.skipWaiting();
});

self.addEventListener('message', (e) => {
  const data = e.data;
  if (data && data.type === 'precache' && Array.isArray(data.urls)) e.waitUntil(precache(data.urls));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // only OUR old caches: every other app on this origin keeps its own
    for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

const offlineResponse = () => new Response('Offline, and this file was never cached.', {
  status: 503, headers: { 'Content-Type': 'text/plain' },
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google Fonts: cache-first (immutable URLs), so text renders offline too.
  const isFont = isFontHost(url);
  if (url.origin !== self.location.origin && !isFont) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isFont) {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    }

    const cached = await cache.match(req, { ignoreSearch: true });
    // the network attempt: good answers refresh the cache (awaited by the worker through waitUntil, errors swallowed); it resolves to the Response or throws
    const network = fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res && res.ok && plausible(req, res)) e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
      return res;
    });
    // an attempt nobody is waiting for any more must not become an unhandled rejection
    e.waitUntil(network.catch(() => {}));

    if (!cached) {
      try { return await network; } catch { return offlineResponse(); }
    }
    // a copy is at hand: use the network's answer only if it came in time AND is the real thing; otherwise the cached copy (offline, slow, 5xx, a portal's page)
    try {
      const res = await Promise.race([network, new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS))]);
      if (res && res.ok && plausible(req, res)) return res;
      if (res && res.status >= 400 && res.status < 500) return res; // a real 404/403: the file is gone, do not pretend otherwise
      return cached;
    } catch {
      return cached;
    }
  })());
});
