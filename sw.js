/**
 * Service Worker para ChessPrep
 * Permite el funcionamiento offline y la instalación como PWA
 */

const CACHE_NAME = 'chessprep-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/i18n.js',
  '/js/storage.js',
  '/js/moveQuality.js',
  '/js/stockfishEngine.js',
  '/js/gameAnalysis.js',
  '/js/exploreMode.js',
  '/js/gameViewerController.js',
  '/js/dossierController.js',
  '/js/otbController.js',
  '/js/pgnImportController.js',
  '/js/eloCalculator.js',
  '/manifest.json'
];

// Instalación: cachear assets estáticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Cacheando assets');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activación: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Interceptación de peticiones: estrategia cache-first para assets, network-first para API
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Si es una petición a la API, intentar red primero
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clonar la respuesta para guardarla en cache si es exitosa
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Si falla la red, intentar devolver del cache
          return caches.match(event.request);
        })
    );
  } else {
    // Para assets estáticos, usar cache primero
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request);
        })
    );
  }
});
