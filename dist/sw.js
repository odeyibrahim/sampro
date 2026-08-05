const CACHE_NAME = 'vgallery-cache-v1';
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
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/admin/') ||
        url.pathname.startsWith('/.netlify/') ||
        url.pathname.startsWith('/payment-callback')) {
        return;
    }
    if (event.request.method !== 'GET') return;
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