/* LearniTY service worker.
 *
 * The app is a static single page, so this worker only keeps the app shell
 * available and lets installed copies launch without a network round-trip.
 * Strategy is deliberately network-first: a new deploy must win over a cached
 * copy, while a cached copy is still used when the network is unavailable.
 * Bump CACHE_NAME when the precache list or offline behaviour changes.
 */
const CACHE_NAME = 'learnity-pwa-v15';

const CORE_ASSETS = [
    '/index.html',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
    '/js/shared.js',
    '/js/dictation.js',
    '/js/new-vocab.js',
    '/js/grammar-quest.js',
    '/js/grammar/drive-and-go.js',
    '/js/grammar/drive-and-go-race.js',
    '/js/grammar/drive-and-go-multiplayer.js',
    '/js/leaderboard.js',
    '/js/admin.js',
    '/js/profile.js',
    '/js/word-battle.js',
    '/js/word-jump.js',
    '/js/pwa.js'
];

// CDN files needed for the app shell. Supabase auth/data calls live on
// *.supabase.co and are never cached here.
const CDN_HOSTS = new Set([
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.jsdelivr.net'
]);

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.indexOf('learnity-') === 0 && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

function isCacheable(response, allowOpaque) {
    if (!response) return false;
    if (response.status === 206) return false;
    return response.ok || (allowOpaque && response.type === 'opaque');
}

async function networkFirst(request, fallbackUrl, allowOpaque) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (isCacheable(response, allowOpaque)) {
            cache.put(request, response.clone()).catch(() => {});
            return response;
        }
        // A captive portal or a dead local server can answer with a 5xx
        // instead of rejecting. Keep the app shell usable in that case.
        if (fallbackUrl) {
            const fallback = await cache.match(fallbackUrl);
            if (fallback) return fallback;
        }
        return response;
    } catch (err) {
        const hit = await cache.match(request);
        if (hit) return hit;
        if (fallbackUrl) {
            const fallback = await cache.match(fallbackUrl);
            if (fallback) return fallback;
        }
        return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (url.pathname === '/sw.js') return;
    if (url.pathname.indexOf('/api/') === 0) return;
    if (url.pathname === '/favicon.ico') return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request, '/index.html', false));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request, null, false));
        return;
    }

    if (CDN_HOSTS.has(url.hostname)) {
        event.respondWith(networkFirst(request, null, true));
    }
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
