/**
 * ============================================================================
 * Service Worker - Offline-First POS
 * ============================================================================
 * Caches the app for offline use and handles background sync
 * ============================================================================
 */

const CACHE_NAME = 'checkout-charlie-v1';
const STATIC_CACHE = 'static-v1';
const DATA_CACHE = 'data-v1';

// Static files to cache for offline use
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json'
];

// API endpoints to cache
const API_CACHE_URLS = [
  '/api/pos/products',
  '/api/customers'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[ServiceWorker] Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DATA_CACHE) {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }

  // Handle static files - cache first, network fallback
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version but also update cache in background
          fetchAndCache(event.request);
          return cachedResponse;
        }
        return fetchAndCache(event.request);
      })
      .catch(() => {
        // If offline and no cache, return the cached index.html for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      })
  );
});

// Handle API requests with network-first, cache fallback
async function handleApiRequest(request) {
  const url = new URL(request.url);

  // For GET requests - try network, fall back to cache
  if (request.method === 'GET') {
    try {
      const networkResponse = await fetch(request);

      // Cache successful GET responses
      if (networkResponse.ok) {
        const cache = await caches.open(DATA_CACHE);
        cache.put(request, networkResponse.clone());
      }

      return networkResponse;
    } catch (error) {
      console.log('[ServiceWorker] Network failed, trying cache for:', url.pathname);
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }

      // Return offline response for products/customers
      if (url.pathname.includes('/products') || url.pathname.includes('/customers')) {
        return new Response(JSON.stringify({
          products: [],
          customers: [],
          offline: true,
          message: 'Using cached data - you are offline'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      throw error;
    }
  }

  // For POST/PUT/DELETE - try network, queue if offline
  try {
    return await fetch(request);
  } catch (error) {
    console.log('[ServiceWorker] Offline - request will be queued');

    // Return a response indicating offline queue
    return new Response(JSON.stringify({
      queued: true,
      offline: true,
      message: 'Transaction saved offline - will sync when online'
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Fetch and cache helper
async function fetchAndCache(request) {
  const response = await fetch(request);

  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }

  return response;
}

// Background sync for offline transactions
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync:', event.tag);

  if (event.tag === 'sync-sales') {
    event.waitUntil(syncOfflineSales());
  }
});

async function syncOfflineSales() {
  // This will be called when back online
  // The main app handles the actual sync via IndexedDB
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_SALES' });
  });
}

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
