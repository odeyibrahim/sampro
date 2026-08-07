const CACHE_NAME = 'vgallery-cache-v2';
const PRECACHE_URLS = [
    '/',
    '/css/styles.css',
    '/js/utils.js',
    '/js/app.js',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        )
    );
    self.clients.claim();
});

// Single fetch listener with all guards
self.addEventListener('fetch', (event) => {
    // Guard 1: Only cache GET requests
    if (event.request.method !== 'GET') return;

    // Guard 2: Skip non-http schemes (chrome-extension, data, blob, etc.)
    if (!event.request.url.startsWith('http')) return;

    const url = new URL(event.request.url);

    // Guard 3: Never cache admin, API, or payment flows
    if (url.pathname.startsWith('/admin/') ||
        url.pathname.startsWith('/.netlify/') ||
        url.pathname.startsWith('/payment-callback')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => cached);
            return cached || network;
        })
    );
});
