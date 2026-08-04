const CACHE_NAME = "chessprep-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
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
  "/js/stockfishEngine.js"
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

// Interceptar peticiones: estrategia cache-first para estáticos, network-first para API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  
  // Peticiones a la API: network-first con fallback a offline
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clonar respuesta para cachear
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback: intentar servir desde caché si existe
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            
            // Si no hay caché, devolver respuesta offline
            return new Response(
              JSON.stringify({ 
                error: "offline", 
                message: "No hay conexión. Los datos pueden estar desactualizados." 
              }),
              { 
                status: 503, 
                headers: { "Content-Type": "application/json" } 
              }
            );
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
      
      // Si no está en caché, intentar red
      return fetch(event.request).then((response) => {
        // No cachear respuestas que no sean exitosas
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        
        // Clonar respuesta para cachear
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        
        return response;
      }).catch(() => {
        // Fallback para navegación: servir index.html offline
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
