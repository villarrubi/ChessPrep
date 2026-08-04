/**
 * ChessPrep - Almacenamiento Local (IndexedDB)
 * Gestiona la persistencia de datos en el navegador del usuario
 */

const DB_NAME = 'ChessPrepDB';
const DB_VERSION = 1;
const STORE_PLAYERS = 'players';
const STORE_GAMES = 'games';
const STORE_ANALYSIS = 'analysis';
const STORE_PREFS = 'preferences';

let db = null;

/**
 * Inicializa la base de datos IndexedDB
 */
export async function initStorage() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('Error al abrir IndexedDB:', request.error);
            reject(request.error);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Almacén de jugadores (perfiles guardados)
            if (!database.objectStoreNames.contains(STORE_PLAYERS)) {
                const playerStore = database.createObjectStore(STORE_PLAYERS, { keyPath: 'fideId' });
                playerStore.createIndex('name', 'name', { unique: false });
                playerStore.createIndex('lastAccess', 'lastAccess', { unique: false });
            }

            // Almacén de partidas (PGNs cacheados)
            if (!database.objectStoreNames.contains(STORE_GAMES)) {
                const gameStore = database.createObjectStore(STORE_GAMES, { keyPath: 'id' });
                gameStore.createIndex('fideId', 'fideId', { unique: false });
                gameStore.createIndex('date', 'date', { unique: false });
            }

            // Almacén de análisis (resultados de Stockfish)
            if (!database.objectStoreNames.contains(STORE_ANALYSIS)) {
                const analysisStore = database.createObjectStore(STORE_ANALYSIS, { keyPath: 'gameId' });
            }

            // Almacén de preferencias (configuración del usuario)
            if (!database.objectStoreNames.contains(STORE_PREFS)) {
                database.createObjectStore(STORE_PREFS, { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB inicializado correctamente');
            resolve(db);
        };
    });
}

/**
 * Guarda un objeto en un almacén específico
 */
export async function saveData(storeName, data) {
    if (!db) await initStorage();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Obtiene un objeto por su clave
 */
export async function getData(storeName, key) {
    if (!db) await initStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Obtiene todos los objetos de un almacén
 */
export async function getAllData(storeName) {
    if (!db) await initStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Elimina un objeto por su clave
 */
export async function deleteData(storeName, key) {
    if (!db) await initStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Limpia todo un almacén
 */
export async function clearStore(storeName) {
    if (!db) await initStorage();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/**
 * Guarda las preferencias del usuario
 */
export async function savePreference(key, value) {
    await saveData(STORE_PREFS, { key, value });
}

/**
 * Obtiene una preferencia del usuario
 */
export async function getPreference(key, defaultValue = null) {
    const result = await getData(STORE_PREFS, key);
    return result ? result.value : defaultValue;
}

/**
 * Guarda un jugador en el historial local
 */
export async function savePlayer(playerData) {
    playerData.lastAccess = Date.now();
    await saveData(STORE_PLAYERS, playerData);
}

/**
 * Obtiene el historial de jugadores consultados
 */
export async function getPlayerHistory() {
    const players = await getAllData(STORE_PLAYERS);
    return players.sort((a, b) => b.lastAccess - a.lastAccess);
}

/**
 * Guarda una partida en caché local
 */
export async function cacheGame(gameData) {
    await saveData(STORE_GAMES, gameData);
}

/**
 * Obtiene partidas cacheadas de un jugador
 */
export async function getCachedGames(fideId) {
    const allGames = await getAllData(STORE_GAMES);
    return allGames.filter(g => g.fideId === fideId);
}
