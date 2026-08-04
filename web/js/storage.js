const CHESSPREP_DB_VERSION = 2;
const CHESSPREP_DB_NAME = "ChessPrepDB";
const CHESSPREP_STORES = {
  SETTINGS: "settings"
};

let dbInstance = null;

/**
 * Abre o crea la base de datos IndexedDB para persistencia local
 * NOTA: Solo se guardan preferencias de usuario (idioma, tema, profundidad Stockfish).
 * Los datos dinámicos (partidas, jugadores, análisis) NO se almacenan para garantizar
 * que siempre se muestren actualizados desde las fuentes externas.
 */
async function openDatabase() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CHESSPREP_DB_NAME, CHESSPREP_DB_VERSION);

    request.onerror = () => {
      console.error("Error al abrir ChessPrepDB:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Eliminar stores antiguos si existen (migración desde v1)
      if (db.objectStoreNames.contains("players")) {
        db.deleteObjectStore("players");
      }
      if (db.objectStoreNames.contains("games")) {
        db.deleteObjectStore("games");
      }
      if (db.objectStoreNames.contains("analysis")) {
        db.deleteObjectStore("analysis");
      }

      // Store de configuración: guarda preferencias del usuario
      if (!db.objectStoreNames.contains(CHESSPREP_STORES.SETTINGS)) {
        db.createObjectStore(CHESSPREP_STORES.SETTINGS, { keyPath: "key" });
      }
    };
  });
}

/**
 * Guarda una preferencia de configuración
 */
async function saveSetting(key, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.SETTINGS], "readwrite");
    const store = transaction.objectStore(CHESSPREP_STORES.SETTINGS);
    const request = store.put({ key, value });
    
    request.onsuccess = () => resolve({ key, value });
    request.onerror = () => reject(request.error);
  });
}

/**
 * Obtiene una preferencia de configuración
 */
async function getSetting(key, defaultValue = null) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.SETTINGS], "readonly");
    const store = transaction.objectStore(CHESSPREP_STORES.SETTINGS);
    const request = store.get(key);
    
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result.value : defaultValue);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Borra las preferencias de configuración locales
 */
async function clearSettings() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.SETTINGS], "readwrite");
    const store = transaction.objectStore(CHESSPREP_STORES.SETTINGS);
    const request = store.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Exportar funciones para uso global
// NOTA: Solo se exportan funciones de configuración. 
// Las funciones de guardado de jugadores, partidas y análisis han sido eliminadas
// para garantizar que los datos siempre se obtengan actualizados desde las APIs externas.
window.ChessPrepStorage = {
  openDatabase,
  saveSetting,
  getSetting,
  clearSettings
};
