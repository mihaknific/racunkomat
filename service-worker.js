/**
 * Service Worker for Računkomat PWA
 * Strategy: Cache First for app shell, Network First for dynamic content
 */

const CACHE_NAME = 'racunkomat-cache-v34';

// App shell — files needed for the app to work offline
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/main.js',
    './js/ui.js',
    './js/modules/StorageManager.js',
    './js/modules/LazyLoader.js',
    './js/modules/ux.js',
    './js/modules/Component.js',
    './js/event-bus.js',
    './js/utils.js',
    './js/store.js',
    './js/validators.js',
    './js/pdf-generator.js',
    './js/components/analytics.js',
    './js/components/invoice-form.js',
    './js/components/invoice-list.js',
    './js/components/settings.js',
    './js/components/toast.js',
    './js/components/home.js',
    './js/components/form/IssuerSection.js',
    './js/components/form/PartnerSection.js',
    './js/components/form/EntityFormHandler.js',
    './js/components/form/EntityModal.js',
    './js/components/form/InvoiceDetails.js',
    './js/components/form/ItemsTable.js',
    './js/modules/PdfWorker.js',
    './js/modules/UpnDrawer.js',
    './js/vendor/chart.min.js',
    './js/vendor/pdfmake.min.js',
    './js/vendor/vfs_fonts.js',
    './js/vendor/kjua.min.js',
    './js/vendor/pdf-lib.min.js',
    './js/vendor/fontkit.umd.js',
    './assets/icons/favicon.svg',
    './assets/icons/icon-maskable.svg',
    './assets/icons/apple-touch-icon.png',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './css/vendor/fontawesome.css',
    './assets/webfonts/fa-solid-900.woff2',
    './assets/webfonts/fa-regular-400.woff2',
    './assets/webfonts/inter-latin-300-normal.woff2',
    './assets/webfonts/inter-latin-ext-300-normal.woff2',
    './assets/webfonts/inter-latin-400-normal.woff2',
    './assets/webfonts/inter-latin-ext-400-normal.woff2',
    './assets/webfonts/inter-latin-500-normal.woff2',
    './assets/webfonts/inter-latin-ext-500-normal.woff2',
    './assets/webfonts/inter-latin-600-normal.woff2',
    './assets/webfonts/inter-latin-ext-600-normal.woff2',
    './assets/webfonts/inter-latin-700-normal.woff2',
    './assets/webfonts/inter-latin-ext-700-normal.woff2',
    './fonts/Myriad Pro Semibold.ttf'
];

// 1. Install — cache the app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
    );
});

// 2. Activate — clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// 3. Fetch — split strategy for optimal freshness + performance
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Skip non-GET and cross-origin requests
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    // Stale-While-Revalidate for navigation (index.html, ./)
    // Serves cached version instantly, then updates cache in background
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('./')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async cache => {
                const cached = await cache.match(event.request);
                const fetchPromise = fetch(event.request).then(response => {
                    if (response.ok) {
                        cache.put(event.request, response.clone());
                    }
                    return response;
                }).catch(() => cached); // Offline fallback

                return cached || fetchPromise;
            })
        );
        return;
    }

    // Cache-First for all other app shell assets (JS, CSS, fonts, icons)
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});

// 4. Listen for update messages from the app
self.addEventListener('message', event => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
