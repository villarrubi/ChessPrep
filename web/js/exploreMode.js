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
      this.onChange = null;
      this.getSettings = null;
    }

    async enter(fen, ply, { onChange, getSettings } = {}) {
      await global.loadChessScript("/vendor/chess/chess.min.js");
      this.active = true;
      this.basePly = ply;
      this.baseFen = fen;
      this.chess = new global.Chess(fen);
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this.onChange = onChange || null;
      this.getSettings = getSettings || null;
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
      this.active = false;
      this.chess = null;
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this.analyzing = false;
      this._emit();
    }

    fen() {
      return this.chess ? this.chess.fen() : this.baseFen;
    }

    canUndo() {
      return Boolean(this.chess && this.chess.history().length);
    }

    undo() {
      if (!this.active || !this.chess) return;
      this.chess.undo();
      this.selectedSquare = null;
      this.legalTargets = [];
      this.lastTry = null;
      this._emit();
    }

    boardPosition() {
      if (!this.chess) return null;
      return this.chess.board();
    }

    async handleSquareClick(square) {
      if (!this.active || !this.chess || this.analyzing) return;

      if (this.selectedSquare) {
        if (square === this.selectedSquare) {
          this.selectedSquare = null;
          this.legalTargets = [];
          this._emit();
          return;
        }
        if (this.legalTargets.includes(square)) {
          const from = this.selectedSquare;
          const promotion = needsPromotion(this.chess, from, square) ? "q" : undefined;
          const move = this.chess.move({ from, to: square, promotion });
          this.selectedSquare = null;
          this.legalTargets = [];
          if (move) {
            this._emit();
            await this._evaluateLastMove(move);
          } else {
            this._emit();
          }
          return;
        }
      }

      const piece = this.chess.get(square);
      if (!piece || piece.color !== this.chess.turn()) {
        this.selectedSquare = null;
        this.legalTargets = [];
        this._emit();
        return;
      }

      this.selectedSquare = square;
      this.legalTargets = this.chess.moves({ square, verbose: true }).map((move) => move.to);
      this._emit();
    }

    async _evaluateLastMove(move) {
      this.analyzing = true;
      this.lastTry = {
        san: move.san,
        uci: `${move.from}${move.to}${move.promotion || ""}`,
        status: "analyzing",
      };
      this._emit();

      try {
        await this.engine.init();
        const fenBefore = (() => {
          const clone = new global.Chess(this.baseFen);
          const history = this.chess.history({ verbose: true });
          history.slice(0, -1).forEach((item) => {
            clone.move({ from: item.from, to: item.to, promotion: item.promotion });
          });
          return clone.fen();
        })();

        const sideToMove = fenBefore.split(" ")[1] || "w";
        const depth = this._depth();
        const best = await this.engine.analyzeFen(fenBefore, { depth, multipv: 1 });
        let playedScore = best.score;
        if (this.lastTry.uci !== best.bestMove) {
          playedScore = await this.engine.evaluateMove(fenBefore, this.lastTry.uci, { depth });
        }
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
        this.lastTry = {
          ...this.lastTry,
          status: "error",
          error: error.message || String(error),
        };
      } finally {
        this.analyzing = false;
        this._emit();
      }
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
