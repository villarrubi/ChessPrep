const CHESSPREP_DB_VERSION = 1;
const CHESSPREP_DB_NAME = "ChessPrepDB";
const CHESSPREP_STORES = {
  PLAYERS: "players",
  GAMES: "games",
  ANALYSIS: "analysis",
  SETTINGS: "settings"
};

let dbInstance = null;

/**
 * Abre o crea la base de datos IndexedDB para persistencia local
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

      // Store de jugadores: guarda información básica del perfil
      if (!db.objectStoreNames.contains(CHESSPREP_STORES.PLAYERS)) {
        const playerStore = db.createObjectStore(CHESSPREP_STORES.PLAYERS, { keyPath: "id" });
        playerStore.createIndex("username", "username", { unique: false });
        playerStore.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }

      // Store de partidas: guarda las partidas analizadas
      if (!db.objectStoreNames.contains(CHESSPREP_STORES.GAMES)) {
        const gamesStore = db.createObjectStore(CHESSPREP_STORES.GAMES, { keyPath: "gameId" });
        gamesStore.createIndex("playerId", "playerId", { unique: false });
        gamesStore.createIndex("date", "date", { unique: false });
        gamesStore.createIndex("source", "source", { unique: false });
      }

      // Store de análisis: guarda análisis de Stockfish
      if (!db.objectStoreNames.contains(CHESSPREP_STORES.ANALYSIS)) {
        const analysisStore = db.createObjectStore(CHESSPREP_STORES.ANALYSIS, { keyPath: "id" });
        analysisStore.createIndex("gameId", "gameId", { unique: false });
      }

      // Store de configuración: guarda preferencias del usuario
      if (!db.objectStoreNames.contains(CHESSPREP_STORES.SETTINGS)) {
        db.createObjectStore(CHESSPREP_STORES.SETTINGS, { keyPath: "key" });
      }
    };
  });
}

/**
 * Guarda un jugador en la base de datos local
 */
async function savePlayer(playerData) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.PLAYERS], "readwrite");
    const store = transaction.objectStore(CHESSPREP_STORES.PLAYERS);
    
    const data = {
      ...playerData,
      lastAccessed: new Date().toISOString()
    };
    
    const request = store.put(data);
    
    request.onsuccess = () => resolve(data);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Obtiene un jugador por su ID
 */
async function getPlayer(playerId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.PLAYERS], "readonly");
    const store = transaction.objectStore(CHESSPREP_STORES.PLAYERS);
    const request = store.get(playerId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda múltiples partidas en la base de datos local
 */
async function saveGames(gamesArray, playerId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.GAMES], "readwrite");
    const store = transaction.objectStore(CHESSPREP_STORES.GAMES);
    
    const savedGames = [];
    gamesArray.forEach((game) => {
      const gameData = {
        ...game,
        playerId,
        savedAt: new Date().toISOString()
      };
      store.put(gameData);
      savedGames.push(gameData);
    });
    
    transaction.oncomplete = () => resolve(savedGames);
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Obtiene las partidas de un jugador desde la base de datos local
 */
async function getGamesByPlayer(playerId, limit = 100) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.GAMES], "readonly");
    const store = transaction.objectStore(CHESSPREP_STORES.GAMES);
    const index = store.index("playerId");
    const request = index.getAll(playerId);
    
    request.onsuccess = () => {
      const games = request.result || [];
      // Ordenar por fecha descendente y aplicar límite
      games.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      resolve(games.slice(0, limit));
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda un análisis en la base de datos local
 */
async function saveAnalysis(analysisData) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.ANALYSIS], "readwrite");
    const store = transaction.objectStore(CHESSPREP_STORES.ANALYSIS);
    
    const data = {
      ...analysisData,
      savedAt: new Date().toISOString()
    };
    
    const request = store.put(data);
    
    request.onsuccess = () => resolve(data);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Obtiene un análisis por su ID
 */
async function getAnalysis(analysisId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CHESSPREP_STORES.ANALYSIS], "readonly");
    const store = transaction.objectStore(CHESSPREP_STORES.ANALYSIS);
    const request = store.get(analysisId);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
 * Borra todos los datos locales (útil para testing o reset)
 */
async function clearAllData() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      Object.values(CHESSPREP_STORES),
      "readwrite"
    );
    
    Object.values(CHESSPREP_STORES).forEach(storeName => {
      transaction.objectStore(storeName).clear();
    });
    
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

/**
 * Exporta datos locales a JSON (para backup)
 */
async function exportData() {
  const db = await openDatabase();
  const data = {};
  
  for (const [storeName, storeKey] of Object.entries(CHESSPREP_STORES)) {
    data[storeKey] = await new Promise((resolve, reject) => {
      const transaction = db.transaction([storeKey], "readonly");
      const store = transaction.objectStore(storeKey);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  return data;
}

/**
 * Importa datos desde JSON (restaurar backup)
 */
async function importData(data) {
  const db = await openDatabase();
  
  for (const [storeKey, items] of Object.entries(data)) {
    if (!Array.isArray(items)) continue;
    
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([storeKey], "readwrite");
      const store = transaction.objectStore(storeKey);
      
      items.forEach(item => store.put(item));
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

// Exportar funciones para uso global
window.ChessPrepStorage = {
  openDatabase,
  savePlayer,
  getPlayer,
  saveGames,
  getGamesByPlayer,
  saveAnalysis,
  getAnalysis,
  saveSetting,
  getSetting,
  clearAllData,
  exportData,
  importData
};
