"use strict";

(function (global) {
  const WORKER_URL = "/vendor/stockfish/stockfish-18-lite-single.js";
  const ENGINE_VERSION = "18-lite-single-18.0.8";
  const ENGINE_CACHE_NAMESPACE = `stockfish-${ENGINE_VERSION}`;
  const DEFAULT_NODES = 150000;
  const DEFAULT_LINES = 3;
  const MAX_NODES = 2000000;
  const MAX_LINES = 30;
  const MIN_NODES = 10000;
  const MIN_LINES = 1;
  const POSITION_CACHE_LIMIT = 256;

  // All StockfishEngine instances share completed position searches. The
  // interactive worker can therefore reuse the exact reference result shown
  // by the viewer, and returning to a position does not trigger a new answer.
  const positionCache = new Map();
  const pendingSearches = new Map();

  class StockfishEngine {
    constructor() {
      this.worker = null;
      this.ready = false;
      this._initPromise = null;
      this._queue = Promise.resolve();
      this._pending = null;
      this._listeners = new Set();
      this._requestId = 0;
      this._multipv = 1;
      this.name = "Stockfish 18 Lite";
    }

    async init() {
      if (this.ready) return;
      if (this._initPromise) return this._initPromise;
      const initPromise = this._doInit();
      const guardedPromise = initPromise.catch((error) => {
        // A cancelled initialization may reject after a new Worker has already
        // started. Only the promise that is still current may tear it down.
        if (this._initPromise === guardedPromise) {
          this._initPromise = null;
          this.terminate();
        }
        throw error;
      });
      this._initPromise = guardedPromise;
      return guardedPromise;
    }

    async _doInit() {
      if (typeof Worker === "undefined") {
        throw new Error("Este navegador no soporta Web Workers.");
      }
      this.worker = new Worker(WORKER_URL);
      this.worker.onmessage = (event) => this._onMessage(String(event.data ?? event));
      this.worker.onerror = (event) => {
        const error = new Error(event?.message || "Error en el motor Stockfish");
        if (this._pending) {
          const pending = this._pending;
          this._pending = null;
          pending.reject(error);
        }
      };
      await this._sendAndWait("uci", (line) => {
        if (line.startsWith("id name ")) this.name = line.slice(8).trim() || this.name;
        return line === "uciok";
      }, 60000);
      await this._sendAndWait("isready", (line) => line === "readyok", 30000);
      this.ready = true;
    }

    onInfo(listener) {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }

    async analyzeFen(fen, { nodes = DEFAULT_NODES, multipv = 1 } = {}) {
      const safeNodes = clamp(nodes, MIN_NODES, MAX_NODES);
      const safeMulti = clamp(multipv, MIN_LINES, MAX_LINES);
      const cacheKey = `${ENGINE_CACHE_NAMESPACE}|position|n${safeNodes}|m${safeMulti}|${fen}`;
      return runSharedSearch(cacheKey, async () => {
        await this.init();
        return this._enqueue(async () => {
          const linesByPv = new Map();
          let bestMove = "";
          if (this._multipv !== safeMulti) {
            this._post(`setoption name MultiPV value ${safeMulti}`);
            this._multipv = safeMulti;
          }
          this._post("stop");
          this._post("setoption name Clear Hash");
          this._post(`position fen ${fen}`);
          await this._sendAndWait(`go nodes ${safeNodes}`, (line) => {
            if (line.startsWith("info ") && line.includes(" score ")) {
              const parsed = parseInfoLine(line);
              if (parsed.score && parsed.pv?.length) {
                linesByPv.set(parsed.multipv || 1, {
                  multipv: parsed.multipv || 1,
                  score: parsed.score,
                  pv: parsed.pv,
                  depth: parsed.depth,
                  nodes: parsed.nodes,
                });
              }
              for (const listener of this._listeners) listener(parsed);
            }
            if (line.startsWith("bestmove ")) {
              bestMove = line.split(/\s+/)[1] || "";
              if (bestMove === "(none)") bestMove = "";
              return true;
            }
            return false;
          });

          const lines = [...linesByPv.values()].sort((a, b) => a.multipv - b.multipv);
          const top = lines[0] || { score: { cp: 0 }, pv: bestMove ? [bestMove] : [], multipv: 1 };
          if (!bestMove && top.pv?.[0]) bestMove = top.pv[0];
          return {
            bestMove,
            score: top.score || { cp: 0 },
            pv: top.pv || [],
            lines,
            fen,
            depth: top.depth || null,
            nodes: safeNodes,
            multipv: safeMulti,
          };
        });
      });
    }

    /**
     * Evaluate a move from the original position with a root restriction.
     * This keeps its score directly comparable with analyzeFen at the same
     * node budget; searching the resulting position would add one effective ply.
     */
    async evaluateMove(fen, moveUci, { nodes = DEFAULT_NODES } = {}) {
      const safeNodes = clamp(nodes, MIN_NODES, MAX_NODES);
      const safeMove = String(moveUci || "").trim().toLowerCase();
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(safeMove)) {
        throw new Error("Jugada UCI no válida");
      }
      const cacheKey = `${ENGINE_CACHE_NAMESPACE}|move|n${safeNodes}|${safeMove}|${fen}`;
      return runSharedSearch(cacheKey, async () => {
        await this.init();
        return this._enqueue(async () => {
          let score = { cp: 0 };
          if (this._multipv !== 1) {
            this._post("setoption name MultiPV value 1");
            this._multipv = 1;
          }
          this._post("stop");
          this._post("setoption name Clear Hash");
          this._post(`position fen ${fen}`);
          // UCI `searchmoves` consumes the remaining move tokens, so it must
          // come after every other search limit (including `nodes`).
          await this._sendAndWait(`go nodes ${safeNodes} searchmoves ${safeMove}`, (line) => {
            if (line.startsWith("info ") && line.includes(" score ")) {
              const parsed = parseInfoLine(line);
              if (parsed.score) score = parsed.score;
            }
            return line.startsWith("bestmove ");
          });
          return score;
        });
      });
    }

    async stop() {
      if (!this.worker) return;
      this._post("stop");
      if (this._pending) {
        const pending = this._pending;
        this._pending = null;
        pending.reject(new Error("Análisis cancelado"));
      }
    }

    terminate() {
      if (this.worker) {
        try { this._post("quit"); } catch { /* ignore */ }
        this.worker.terminate();
      }
      this.worker = null;
      this.ready = false;
      this._initPromise = null;
      this._multipv = 1;
      if (this._pending) {
        const pending = this._pending;
        this._pending = null;
        pending.reject(new Error("Motor detenido"));
      }
      this._queue = Promise.resolve();
      this._listeners.clear();
    }

    _post(command) {
      this.worker?.postMessage(command);
    }

    _onMessage(message) {
      // stockfish.js may batch several UCI records in one Worker message.
      for (const line of String(message).split(/\r?\n/).filter(Boolean)) {
        if (!this._pending) return;
        let done = false;
        try {
          done = Boolean(this._pending.match(line));
        } catch (error) {
          const pending = this._pending;
          this._pending = null;
          pending.reject(error);
          return;
        }
        if (done) {
          const pending = this._pending;
          this._pending = null;
          pending.resolve();
        }
      }
    }

    _sendAndWait(command, match, timeoutMs = 120000) {
      const requestId = ++this._requestId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this._pending?.id === requestId) {
            this._pending = null;
            reject(new Error("Tiempo de espera del motor agotado"));
          }
        }, timeoutMs);
        this._pending = {
          id: requestId,
          match,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
        this._post(command);
      });
    }

    _enqueue(task) {
      const run = this._queue.then(task, task);
      this._queue = run.catch(() => {});
      return run;
    }
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function runSharedSearch(key, search) {
    const cached = readCache(key);
    if (cached) return Promise.resolve(cached);
    if (pendingSearches.has(key)) return pendingSearches.get(key);

    const pending = Promise.resolve()
      .then(search)
      .then((result) => {
        writeCache(key, result);
        return result;
      })
      .finally(() => {
        if (pendingSearches.get(key) === pending) pendingSearches.delete(key);
      });
    pendingSearches.set(key, pending);
    return pending;
  }

  function readCache(key) {
    if (!positionCache.has(key)) return null;
    const value = positionCache.get(key);
    // Refresh insertion order to make this a small LRU cache.
    positionCache.delete(key);
    positionCache.set(key, value);
    return value;
  }

  function writeCache(key, value) {
    positionCache.delete(key);
    positionCache.set(key, value);
    while (positionCache.size > POSITION_CACHE_LIMIT) {
      positionCache.delete(positionCache.keys().next().value);
    }
  }

  function parseInfoLine(line) {
    const parts = line.split(/\s+/);
    const result = { depth: null, nodes: null, score: null, pv: [], multipv: 1 };
    for (let i = 0; i < parts.length; i += 1) {
      const token = parts[i];
      if (token === "depth") result.depth = Number(parts[++i]);
      else if (token === "nodes") result.nodes = Number(parts[++i]);
      else if (token === "multipv") result.multipv = Number(parts[++i]);
      else if (token === "score") {
        const kind = parts[++i];
        const value = Number(parts[++i]);
        result.score = kind === "mate" ? { mate: value } : { cp: value };
      } else if (token === "pv") {
        result.pv = parts.slice(i + 1).filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move));
        break;
      }
    }
    return result;
  }

  global.StockfishEngine = StockfishEngine;
  global.STOCKFISH_DEFAULT_NODES = DEFAULT_NODES;
  global.STOCKFISH_DEFAULT_LINES = DEFAULT_LINES;
  global.STOCKFISH_MIN_NODES = MIN_NODES;
  global.STOCKFISH_MAX_NODES = MAX_NODES;
  global.STOCKFISH_MIN_LINES = MIN_LINES;
  global.STOCKFISH_MAX_LINES = MAX_LINES;
  global.STOCKFISH_ENGINE_NAME = "Stockfish 18 Lite";
  global.STOCKFISH_ENGINE_VERSION = ENGINE_VERSION;
  global.clampEngineSetting = clamp;
})(window);
