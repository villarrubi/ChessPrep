const CACHE_NAME = "chessprep-v20260809-repertoire-moves";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/licenses.html",
  "/styles.css",
  "/app.js",
  "/i18n.js",
  "/manifest.json",
  "/js/storage.js",
  "/js/dossierController.js",
  "/js/eloCalculator.js",
  "/js/exploreMode.js",
  "/js/gameAnalysis.js",
  "/js/gameViewerController.js",
  "/js/moveQuality.js",
  "/js/otbController.js",
  "/js/pgnImportController.js",
  "/js/registerServiceWorker.js",
  "/js/stockfishEngine.js",
  "/vendor/NOTICE.md",
  "/vendor/chess/LICENSE",
  "/vendor/stockfish/COPYING.txt",
  "/vendor/stockfish/SOURCE.md",
  "/vendor/stockfish/UGLIFYJS-LICENSE.txt"
];

// Instalar Service Worker y cachear assets estáticos
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[ServiceWorker] Cacheando assets estáticos");
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activar Service Worker y limpiar caches antiguos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

function canCacheRequest(request) {
  // Cache.put only supports GET; never persist mutating/streamed API calls.
  return request.method === "GET";
}

function canCacheResponse(response) {
  return Boolean(response) && response.ok && response.status === 200 && response.type === "basic";
}

function putInCache(request, response) {
  if (!canCacheRequest(request) || !canCacheResponse(response)) return;
  const responseClone = response.clone();
  caches.open(CACHE_NAME).then((cache) => {
    cache.put(request, responseClone);
  }).catch(() => {
    // Ignore cache write failures (quota, opaque responses, etc.)
  });
}

function offlineApiResponse() {
  return new Response(
    JSON.stringify({
      error: "offline",
      message: "No hay conexión. Los datos pueden estar desactualizados.",
    }),
    {
      status: 503,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Interceptar peticiones: estrategia cache-first para estáticos, network-first para API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Peticiones a la API: network-first; only GET responses may be cached.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          putInCache(event.request, response);
          return response;
        })
        .catch(() => {
          if (!canCacheRequest(event.request)) {
            return offlineApiResponse();
          }
          return caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || offlineApiResponse();
          });
        })
    );
    return;
  }

  // Assets estáticos y HTML: cache-first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        putInCache(event.request, response);
        return response;
      }).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});

// Manejar mensajes del cliente (por ejemplo, para actualizar caché)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === "CLEAR_CACHE") {
    caches.delete(CACHE_NAME);
  }
});
