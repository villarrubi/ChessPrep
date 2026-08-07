"use strict";

// Register Service Worker for offline / PWA support (must be an external
// script: CSP script-src does not allow unsafe-inline).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[PWA] Service Worker registrado:", registration.scope);
      })
      .catch((error) => {
        console.log("[PWA] Error al registrar Service Worker:", error);
      });
  });
}
