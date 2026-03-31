/**
 * RTW Planner Service Worker
 * Caches static assets for faster repeat loads and basic offline support.
 * Map tiles are cached opportunistically with a size limit.
 */

const CACHE_VERSION = 'rtw-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const TILE_CACHE = `${CACHE_VERSION}-tiles`;
const MAX_TILE_ENTRIES = 500;

// Static assets to pre-cache on install
const PRECACHE_URLS = [
    '/',
    '/static/css/style.css',
    '/static/js/app.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k.startsWith('rtw-') && k !== STATIC_CACHE && k !== TILE_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // API requests: network-only (never cache dynamic data)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // Map tile requests: cache-first with size limit
    if (url.hostname.includes('tile') || url.pathname.includes('/tiles/')) {
        event.respondWith(tileFirst(event.request));
        return;
    }

    // Static assets: stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
});

async function staleWhileRevalidate(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);

    const networkPromise = fetch(request).then(response => {
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(() => null);

    return cached || await networkPromise;
}

async function tileFirst(request) {
    const cache = await caches.open(TILE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        if (response.ok) {
            // Evict oldest entries if cache is too large
            const keys = await cache.keys();
            if (keys.length >= MAX_TILE_ENTRIES) {
                await cache.delete(keys[0]);
            }
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        // Offline and not cached — return a transparent 1x1 PNG placeholder
        return new Response(
            Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), c => c.charCodeAt(0)),
            { headers: { 'Content-Type': 'image/png' } }
        );
    }
}
