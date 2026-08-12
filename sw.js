// OFFLINE PLAY. The one platform feature an idle game cannot really do without.
//
// The whole premise of the genre is "come back later", and the meta layer is
// built for it — regions pay crowns while the tab is shut and meta/idle.js pays
// out an absence up to `OFFLINE.baseCapMs`. But a player with no connection
// could not open the game AT ALL to collect any of it. The manifest and the
// icons were already here, so it was installable and then dead on a train.
//
// RUNTIME CACHING, NOT A PRECACHE MANIFEST, and that is forced by the project
// rather than chosen. Precaching wants a list of every asset, and this game is
// ~100 hand-written ES modules with no build step to generate one — a
// hand-maintained list would be wrong the first time somebody added a file, and
// silently: the app would keep working online and fail only offline, which is
// the worst way for it to be wrong. Runtime caching needs no list. The first
// visit loads exactly what the game needs, which populates the cache with
// exactly the right set by construction, and every visit after that works
// offline.
//
// STALE-WHILE-REVALIDATE. Serve from cache immediately (so a return visit is
// instant and an offline one works at all), fetch in the background, and keep
// the fresh copy for next time. The cost is honest and worth stating: a player
// who reloads right after a deploy is one version behind until the load after
// that. For a single-player game with local saves that is fine; the alternative
// — network-first — would make every load wait on the network to discover
// nothing had changed, which is the slow half of both worlds.
//
// The save lives in localStorage (`hexdominion.save` / `hexdominion.battle`),
// which this never touches. A cache purge cannot cost a player their campaign.
const CACHE = 'hexdominion-v1';

// Take over from an older worker straight away rather than waiting for every
// tab to close — otherwise a returning player can sit on a months-old worker
// indefinitely, since this game is exactly the sort you keep pinned.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GET only, and same-origin only. A POST has no business in a static game,
  // and caching a cross-origin response opaquely would fill the bucket with
  // things this worker cannot even read the status of.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cached = await caches.match(req);
    const fresh = fetch(req).then(async (res) => {
      // `res.ok` excludes 404s and 5xxs: caching an error page under a module's
      // URL would make the game permanently broken offline, and it would look
      // like a code fault rather than a caching one.
      if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    }).catch(() => null);

    // Cache first when we have it — `fresh` is deliberately not awaited here,
    // it runs on and updates the cache for the next load.
    if (cached) return cached;
    const res = await fresh;
    if (res) return res;
    // Offline and never seen: nothing useful to say, but a Response is
    // required, and a thrown error inside respondWith surfaces as a confusing
    // network error in the console.
    return new Response('Offline, and this file was never cached.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  })());
});
