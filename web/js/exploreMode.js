"use strict";

(function (global) {
  class ExploreMode {
    constructor(engine) {
      this.engine = engine;
      this.active = false;
      this.basePly = 0;
      this.baseFen = null;
      this.chess = null;
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this.analyzing = false;
      this.evaluationId = 0;
      this.onChange = null;
      this.onMove = null;
      this.getSettings = null;
    }

    async enter(fen, ply, { onChange, onMove, getSettings } = {}) {
      await global.loadChessScript("/vendor/chess/chess.min.js");
      this.onChange = onChange || null;
      this.onMove = onMove || null;
      this.getSettings = getSettings || null;
      this.setPosition(fen, ply);
    }

    setPosition(fen, ply) {
      this._cancelEvaluation();
      this.active = true;
      this.basePly = ply;
      this.baseFen = fen;
      this.chess = new global.Chess(fen);
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this._emit();
    }

    _depth() {
      const settings = typeof this.getSettings === "function" ? this.getSettings() : null;
      return global.clampEngineSetting(
        settings?.depth ?? global.STOCKFISH_DEFAULT_DEPTH,
        global.STOCKFISH_MIN_DEPTH,
        global.STOCKFISH_MAX_DEPTH,
      );
    }

    exit() {
      this._cancelEvaluation();
      this.active = false;
      this.chess = null;
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this.analyzing = false;
      this._emit();
      this.onChange = null;
      this.onMove = null;
      this.getSettings = null;
    }

    fen() {
      return this.chess ? this.chess.fen() : this.baseFen;
    }

    canUndo() {
      return Boolean(this.chess && this.chess.history().length);
    }

    undo() {
      if (!this.active || !this.chess) return;
      this._cancelEvaluation();
      this.chess.undo();
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this._emit();
    }

    canMoveFrom(square) {
      if (!this.active || !this.chess) return false;
      const piece = this.chess.get(square);
      return Boolean(piece && piece.color === this.chess.turn());
    }

    legalMovesFrom(square) {
      if (!this.canMoveFrom(square)) return [];
      return this.chess.moves({ square, verbose: true }).map((move) => move.to);
    }

    boardPosition() {
      if (!this.chess) return null;
      return this.chess.board();
    }

    handleSquareClick(square) {
      if (!this.active || !this.chess) return;

      if (this.selectedSquare) {
        if (square === this.selectedSquare) {
          this.selectedSquare = null;
          this.legalTargets = [];
          this._emit();
          return;
        }
        if (this.legalTargets.includes(square)) {
          const from = this.selectedSquare;
          this.movePiece(from, square);
          return;
        }
      }

      if (!this.canMoveFrom(square)) {
        this.selectedSquare = null;
        this.legalTargets = [];
        this._emit();
        return;
      }

      this.selectedSquare = square;
      this.legalTargets = this.legalMovesFrom(square);
      this._emit();
    }

    movePiece(from, to) {
      if (!this.active || !this.chess || !this.legalMovesFrom(from).includes(to)) return false;
      const fenBefore = this.chess.fen();
      const promotion = needsPromotion(this.chess, from, to) ? "q" : undefined;
      const move = this.chess.move({ from, to, promotion });
      this.selectedSquare = null;
      this.legalTargets = [];
      if (!move) {
        this._emit();
        return false;
      }
      if (typeof this.onMove === "function") this.onMove(move, this);
      this._emit();
      void this._evaluateLastMove(move, fenBefore);
      return true;
    }

    async _evaluateLastMove(move, fenBefore) {
      // Manual analysis uses its own worker. A newer move cancels only the stale
      // manual request, never the background analysis of the original game.
      const evaluationId = ++this.evaluationId;
      const triedUci = `${move.from}${move.to}${move.promotion || ""}`;
      this.engine.terminate();
      this.analyzing = true;
      this.lastTry = {
        san: move.san,
        uci: triedUci,
        status: "analyzing",
      };
      this._emit();

      try {
        await this.engine.init();
        if (evaluationId !== this.evaluationId || !this.active) return;

        const sideToMove = fenBefore.split(" ")[1] || "w";
        const depth = this._depth();
        const best = await this.engine.analyzeFen(fenBefore, { depth, multipv: 1 });
        if (evaluationId !== this.evaluationId || !this.active) return;
        let playedScore = best.score;
        if (triedUci !== best.bestMove) {
          playedScore = await this.engine.evaluateMove(fenBefore, triedUci, { depth });
        }
        if (evaluationId !== this.evaluationId || !this.active) return;
        const cpl = global.MoveQuality.centipawnLoss(best.score, playedScore, sideToMove);
        const judgment = global.MoveQuality.classifyCpl(cpl, {
          missedMate: typeof best.score?.mate === "number" && best.score.mate > 0 &&
            !(typeof playedScore?.mate === "number" && playedScore.mate > 0),
          allowedMate: typeof playedScore?.mate === "number" && playedScore.mate < 0,
        });

        this.lastTry = {
          ...this.lastTry,
          status: "done",
          judgment,
          glyph: global.MoveQuality.judgmentGlyph(judgment),
          label: global.MoveQuality.judgmentLabel(judgment),
          cpl,
          bestUci: best.bestMove,
          bestSan: global.uciToSan(fenBefore, best.bestMove),
          score: global.toWhitePov(playedScore, sideToMove),
          bestScore: global.toWhitePov(best.score, sideToMove),
        };
      } catch (error) {
        if (evaluationId !== this.evaluationId || !this.active) return;
        this.lastTry = {
          ...this.lastTry,
          status: "error",
          error: error.message || String(error),
        };
      } finally {
        if (evaluationId === this.evaluationId && this.active) {
          this.analyzing = false;
          this._emit();
        }
      }
    }

    _cancelEvaluation() {
      this.evaluationId += 1;
      this.analyzing = false;
      try { this.engine.terminate(); } catch { /* ignore */ }
    }

    _emit() {
      if (typeof this.onChange === "function") this.onChange(this);
    }
  }

  function needsPromotion(chess, from, to) {
    const piece = chess.get(from);
    if (!piece || piece.type !== "p") return false;
    const rank = to[1];
    return (piece.color === "w" && rank === "8") || (piece.color === "b" && rank === "1");
  }

  global.ExploreMode = ExploreMode;
})(window);
