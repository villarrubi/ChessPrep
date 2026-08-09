"use strict";

// Register Service Worker for offline / PWA support (must be an external
// script: CSP script-src does not allow unsafe-inline).
if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[PWA] Service Worker registrado:", registration.scope);
        // Check immediately instead of waiting for the browser's periodic
        // update window; controllerchange reloads once when a new build wins.
        return registration.update();
      })
      .catch((error) => {
        console.log("[PWA] Error al registrar o actualizar Service Worker:", error);
      });
  });
}
