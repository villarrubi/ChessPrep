"use strict";

(function (global) {
  class GameAnalysisController {
    constructor(engine) {
      this.engine = engine;
      this.cache = new Map();
      this.activeKey = null;
      this.running = false;
      this.aborted = false;
      this.onUpdate = null;
    }

    cacheKey(game, depth) {
      return `${game.source}:${game.id}:d${depth}`;
    }

    getCached(game, depth) {
      return this.cache.get(this.cacheKey(game, depth)) || null;
    }

    async ensureLibs() {
      await loadChessLibrary();
    }

    async start(game, { onUpdate, depth } = {}) {
      const analysisDepth = global.clampEngineSetting(
        depth ?? global.STOCKFISH_DEFAULT_DEPTH,
        global.STOCKFISH_MIN_DEPTH,
        global.STOCKFISH_MAX_DEPTH,
      );
      await this.ensureLibs();
      await this.engine.init();
      this.onUpdate = onUpdate || null;
      this.aborted = false;
      this.activeKey = this.cacheKey(game, analysisDepth);

      let analysis = this.getCached(game, analysisDepth);
      if (!analysis) {
        analysis = {
          key: this.activeKey,
          status: "running",
          depth: analysisDepth,
          done: 0,
          total: game.moves_uci.length,
          plies: new Array(game.moves_uci.length).fill(null),
          evals: new Array(game.fens.length).fill(null),
          whiteCpls: [],
          blackCpls: [],
          whiteAccuracy: null,
          blackAccuracy: null,
          keyMoments: [],
          error: null,
        };
        // Starting position eval placeholder
        analysis.evals[0] = { cp: 0 };
        this.cache.set(this.activeKey, analysis);
      }

      if (analysis.status === "complete") {
        this._emit(analysis);
        return analysis;
      }

      analysis.status = "running";
      analysis.error = null;
      this.running = true;
      this._emit(analysis);

      try {
        for (let i = 0; i < game.moves_uci.length; i += 1) {
          if (this.aborted || this.activeKey !== this.cacheKey(game, analysisDepth)) break;
          if (analysis.plies[i]) {
            analysis.done = Math.max(analysis.done, i + 1);
            continue;
          }

          const fenBefore = game.fens[i];
          const playedUci = game.moves_uci[i];
          const san = game.moves[i];
          const sideToMove = fenBefore.split(" ")[1] || "w";

          // Full-game quality uses MultiPV 1; live lines are probed separately.
          const best = await this.engine.analyzeFen(fenBefore, { depth: analysisDepth, multipv: 1 });
          if (this.aborted || this.activeKey !== this.cacheKey(game, analysisDepth)) break;

          const bestWhite = toWhitePov(best.score, sideToMove);
          analysis.evals[i] = bestWhite;

          let playedScoreStm;
          if (playedUci === best.bestMove) {
            playedScoreStm = best.score;
          } else {
            playedScoreStm = await this.engine.evaluateMove(fenBefore, playedUci, { depth: analysisDepth });
            if (this.aborted || this.activeKey !== this.cacheKey(game, analysisDepth)) break;
          }

          const playedWhite = toWhitePov(playedScoreStm, sideToMove);
          const cpl = global.MoveQuality.centipawnLoss(best.score, playedScoreStm, sideToMove);
          const missedMate = typeof best.score?.mate === "number" && best.score.mate > 0 &&
            !(typeof playedScoreStm?.mate === "number" && playedScoreStm.mate > 0);
          const allowedMate = typeof playedScoreStm?.mate === "number" && playedScoreStm.mate < 0;
          const judgment = global.MoveQuality.classifyCpl(cpl, { missedMate, allowedMate });
          const bestSan = uciToSan(fenBefore, best.bestMove);

          analysis.plies[i] = {
            ply: i + 1,
            san,
            playedUci,
            bestUci: best.bestMove,
            bestSan,
            pv: best.pv || [],
            scoreBefore: bestWhite,
            scorePlayed: playedWhite,
            cpl,
            judgment,
            glyph: global.MoveQuality.judgmentGlyph(judgment),
            label: global.MoveQuality.judgmentLabel(judgment),
          };

          // Eval after move ≈ played score from white POV (position after move)
          analysis.evals[i + 1] = playedWhite;

          if (sideToMove === "w") analysis.whiteCpls.push(cpl);
          else analysis.blackCpls.push(cpl);

          analysis.done = i + 1;
          analysis.whiteAccuracy = global.MoveQuality.accuracyFromCpls(analysis.whiteCpls);
          analysis.blackAccuracy = global.MoveQuality.accuracyFromCpls(analysis.blackCpls);
          analysis.keyMoments = global.MoveQuality.buildKeyMoments(analysis.plies.filter(Boolean));
          this._emit(analysis);
        }

        if (this.aborted) {
          analysis.status = analysis.done >= analysis.total ? "complete" : "paused";
        } else if (this.activeKey === this.cacheKey(game, analysisDepth) && analysis.done >= analysis.total) {
          analysis.status = "complete";
        } else {
          analysis.status = "paused";
        }
      } catch (error) {
        if (this.aborted) {
          analysis.status = analysis.done >= analysis.total ? "complete" : "paused";
        } else {
          analysis.status = "error";
          analysis.error = error.message || String(error);
        }
      } finally {
        this.running = false;
        this._emit(analysis);
      }
      return analysis;
    }

    stop() {
      this.aborted = true;
      this.engine.stop();
    }

    clearActive() {
      this.stop();
      this.activeKey = null;
      try { this.engine.terminate(); } catch { /* ignore */ }
    }

    _emit(analysis) {
      if (typeof this.onUpdate === "function") this.onUpdate(analysis);
    }
  }

  function toWhitePov(score, sideToMove) {
    if (!score) return { cp: 0 };
    if (sideToMove === "w") {
      return typeof score.mate === "number" ? { mate: score.mate } : { cp: score.cp || 0 };
    }
    if (typeof score.mate === "number") return { mate: -score.mate };
    return { cp: -(score.cp || 0) };
  }

  function uciToSan(fen, uci) {
    if (!uci || typeof global.Chess === "undefined") return uci || "";
    try {
      const chess = new global.Chess(fen);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      return move ? move.san : uci;
    } catch {
      return uci;
    }
  }

  function pvToSan(fen, pv) {
    if (!pv?.length || typeof global.Chess === "undefined") return [];
    try {
      const chess = new global.Chess(fen);
      const sans = [];
      for (const uci of pv) {
        const move = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci.length > 4 ? uci[4] : undefined,
        });
        if (!move) break;
        sans.push(move.san);
      }
      return sans;
    } catch {
      return [];
    }
  }

  let chessLoadPromise = null;

  function loadChessLibrary() {
    if (typeof global.Chess === "function") return Promise.resolve();
    if (chessLoadPromise) return chessLoadPromise;
    chessLoadPromise = import("/vendor/chess/chess.min.js")
      .then((mod) => {
        global.Chess = mod.Chess || mod.default?.Chess || mod.default;
        if (typeof global.Chess !== "function") {
          throw new Error("chess.js no expuso Chess");
        }
      })
      .catch((error) => {
        chessLoadPromise = null;
        throw new Error(error.message || "No se pudo cargar chess.js");
      });
    return chessLoadPromise;
  }

  global.GameAnalysisController = GameAnalysisController;
  global.loadChessScript = loadChessLibrary;
  global.uciToSan = uciToSan;
  global.pvToSan = pvToSan;
  global.toWhitePov = toWhitePov;
})(window);
