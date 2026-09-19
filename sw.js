/* Service worker: aplikacja i dane z cache, kafelki mapy zapamiętywane w miarę oglądania. */

const VERSION = 'v2';
const APP_CACHE = `app-${VERSION}`;
const TILE_CACHE = 'tiles-v1';
const MAX_RUNTIME_TILES = 3000;

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './trails.json',
  './manifest.webmanifest',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const TILE_HOSTS = ['tile.opentopomap.org', 'tile.openstreetmap.org'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

function isTile(url) {
  return TILE_HOSTS.some((h) => url.hostname.endsWith(h));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (isTile(url)) {
    event.respondWith(tileResponse(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(appResponse(event.request));
  }
});

/* Aplikacja: najpierw cache, w tle odświeżenie z sieci (stale-while-revalidate). */
async function appResponse(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) return cached;
  const res = await network;
  if (res) return res;
  if (request.mode === 'navigate') return cache.match('./index.html');
  return new Response('', { status: 504 });
}

/* Kafelki: z cache, a brakujące z sieci (i do cache). Offline bez kafelka — pusta odpowiedź. */
async function tileResponse(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
      trimTiles(cache);
    }
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    const excess = keys.length - MAX_RUNTIME_TILES;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}

/* Pobranie paczki kafelków na żądanie z aplikacji (przycisk „Pobierz mapę offline”). */
self.addEventListener('message', async (event) => {
  const { type, urls } = event.data || {};
  if (type !== 'prefetch-tiles' || !Array.isArray(urls)) return;
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  let failed = 0;
  const queue = urls.slice();
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (!(await cache.match(url))) {
          const res = await fetch(url);
          if (res.ok) await cache.put(url, res);
          else failed++;
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === urls.length) {
        event.source.postMessage({ type: 'prefetch-progress', done, total: urls.length, failed });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  event.source.postMessage({ type: 'prefetch-done', total: urls.length, failed });
});
