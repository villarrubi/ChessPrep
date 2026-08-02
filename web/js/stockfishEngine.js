"use strict";

(function (global) {
  const WORKER_URL = "/vendor/stockfish/stockfish.js";
  const DEFAULT_DEPTH = 14;
  const DEFAULT_LINES = 3;
  const MAX_DEPTH = 30;
  const MAX_LINES = 30;
  const MIN_DEPTH = 5;
  const MIN_LINES = 1;

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
    }

    async init() {
      if (this.ready) return;
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._doInit().catch((error) => {
        this._initPromise = null;
        this.terminate();
        throw error;
      });
      return this._initPromise;
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
      await this._sendAndWait("uci", (line) => line === "uciok", 20000);
      await this._sendAndWait("isready", (line) => line === "readyok", 20000);
      this.ready = true;
    }

    onInfo(listener) {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }

    async analyzeFen(fen, { depth = DEFAULT_DEPTH, multipv = 1 } = {}) {
      await this.init();
      const safeDepth = clamp(depth, MIN_DEPTH, MAX_DEPTH);
      const safeMulti = clamp(multipv, MIN_LINES, MAX_LINES);
      return this._enqueue(async () => {
        const linesByPv = new Map();
        let bestMove = "";
        if (this._multipv !== safeMulti) {
          this._post(`setoption name MultiPV value ${safeMulti}`);
          this._multipv = safeMulti;
        }
        this._post("stop");
        this._post(`position fen ${fen}`);
        await this._sendAndWait(`go depth ${safeDepth}`, (line) => {
          if (line.startsWith("info ") && line.includes(" score ")) {
            const parsed = parseInfoLine(line);
            if (parsed.score && parsed.pv?.length) {
              linesByPv.set(parsed.multipv || 1, {
                multipv: parsed.multipv || 1,
                score: parsed.score,
                pv: parsed.pv,
                depth: parsed.depth,
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
          depth: safeDepth,
          multipv: safeMulti,
        };
      });
    }

    /**
     * Evaluate a specific move from fen by searching the resulting position
     * and negating the score (side to move after the move).
     */
    async evaluateMove(fen, moveUci, { depth = DEFAULT_DEPTH } = {}) {
      await this.init();
      const safeDepth = clamp(depth, MIN_DEPTH, MAX_DEPTH);
      const after = await this._enqueue(async () => {
        let score = { cp: 0 };
        if (this._multipv !== 1) {
          this._post("setoption name MultiPV value 1");
          this._multipv = 1;
        }
        this._post("stop");
        this._post(`position fen ${fen} moves ${moveUci}`);
        await this._sendAndWait(`go depth ${safeDepth}`, (line) => {
          if (line.startsWith("info ") && line.includes(" score ")) {
            const parsed = parseInfoLine(line);
            if (parsed.score) score = parsed.score;
          }
          return line.startsWith("bestmove ");
        });
        return score;
      });
      return negateScore(after);
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

    _onMessage(line) {
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

  function parseInfoLine(line) {
    const parts = line.split(/\s+/);
    const result = { depth: null, score: null, pv: [], multipv: 1 };
    for (let i = 0; i < parts.length; i += 1) {
      const token = parts[i];
      if (token === "depth") result.depth = Number(parts[++i]);
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

  function negateScore(score) {
    if (!score) return { cp: 0 };
    if (typeof score.mate === "number") return { mate: -score.mate };
    return { cp: -(score.cp || 0) };
  }

  global.StockfishEngine = StockfishEngine;
  global.STOCKFISH_DEFAULT_DEPTH = DEFAULT_DEPTH;
  global.STOCKFISH_DEFAULT_LINES = DEFAULT_LINES;
  global.STOCKFISH_MIN_DEPTH = MIN_DEPTH;
  global.STOCKFISH_MAX_DEPTH = MAX_DEPTH;
  global.STOCKFISH_MIN_LINES = MIN_LINES;
  global.STOCKFISH_MAX_LINES = MAX_LINES;
  global.clampEngineSetting = clamp;
})(window);
