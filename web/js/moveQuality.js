"use strict";

(function (global) {
  const WIN_PERCENT_COEFFICIENT = 0.00368208;
  const JUDGMENT_LABELS = {
    best: "Óptima",
    excellent: "Excelente",
    good: "Buena",
    inaccuracy: "Imprecisión",
    mistake: "Error",
    blunder: "Fallo grave",
  };

  function scoreToCpWhite(score) {
    if (!score) return 0;
    if (typeof score.mate === "number") {
      const mate = score.mate;
      if (mate === 0) return 0;
      return mate > 0 ? 10000 - 10 * mate : -10000 - 10 * mate;
    }
    return Number(score.cp) || 0;
  }

  /** Scores must be from the side-to-move perspective (UCI). */
  function centipawnLoss(bestScore, playedScore) {
    const best = scoreToCpWhite(bestScore);
    const played = scoreToCpWhite(playedScore);
    return Math.max(0, best - played);
  }

  /** Convert an engine score into the expected score (0–100) for that side. */
  function winPercent(score) {
    const cp = scoreToCpWhite(score);
    return 50 + 50 * (2 / (1 + Math.exp(-WIN_PERCENT_COEFFICIENT * cp)) - 1);
  }

  /** Loss of expected score, in percentage points, caused by the move. */
  function winChanceLoss(bestScore, playedScore) {
    return Math.max(0, winPercent(bestScore) - winPercent(playedScore));
  }

  function classifyWinLoss(winLoss, {
    isBest = false,
    missedMate = false,
    allowedMate = false,
  } = {}) {
    if (missedMate || allowedMate) return "blunder";
    if (isBest) return "best";
    if (winLoss <= 2) return "excellent";
    if (winLoss <= 5) return "good";
    if (winLoss <= 10) return "inaccuracy";
    if (winLoss <= 20) return "mistake";
    return "blunder";
  }

  function judgmentGlyph(judgment) {
    return ({
      best: "",
      excellent: "!",
      good: "",
      inaccuracy: "?!",
      mistake: "?",
      blunder: "??",
    })[judgment] || "";
  }

  function judgmentLabel(judgment) {
    return JUDGMENT_LABELS[judgment] || judgment || "";
  }

  function moveAccuracy(winLoss) {
    const value = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1669;
    return Math.max(0, Math.min(100, value));
  }

  /**
   * Aggregate per-move accuracy with a harmonic mean so one serious error is
   * not hidden by a long sequence of easy moves. This is ChessPrep's own
   * transparent aggregation; the per-move conversion follows Lichess's model.
   */
  function accuracyFromWinLosses(winLosses) {
    if (!winLosses.length) return null;
    const accuracies = winLosses.map((loss) => Math.max(0.01, moveAccuracy(loss)));
    const harmonic = accuracies.length /
      accuracies.reduce((sum, accuracy) => sum + (1 / accuracy), 0);
    return Math.round(harmonic * 10) / 10;
  }

  function buildKeyMoments(plyEvals, { limit = 8 } = {}) {
    const severity = { blunder: 3, mistake: 2, inaccuracy: 1 };
    return plyEvals
      .filter((item) => item && severity[item.judgment])
      .sort((a, b) => (severity[b.judgment] - severity[a.judgment]) ||
        ((b.winLoss || 0) - (a.winLoss || 0)))
      .slice(0, limit)
      .map((item) => ({
        ply: item.ply,
        san: item.san,
        judgment: item.judgment,
        glyph: judgmentGlyph(item.judgment),
        cpl: item.cpl,
        winLoss: item.winLoss,
        reason: judgmentLabel(item.judgment),
        bestSan: item.bestSan || "",
      }));
  }

  function formatEval(score, { forWhite = true } = {}) {
    if (!score) return "—";
    if (typeof score.mate === "number") {
      const mate = forWhite ? score.mate : -score.mate;
      return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
    }
    const cp = forWhite ? (score.cp || 0) : -(score.cp || 0);
    const pawns = (cp / 100).toFixed(1);
    return cp > 0 ? `+${pawns}` : pawns;
  }

  /** Map white-pov cp to 0..1 bar fill (black at bottom visually when not flipped). */
  function evalBarRatio(score) {
    const cp = scoreToCpWhite(score);
    const clamped = Math.max(-800, Math.min(800, cp));
    return (clamped + 800) / 1600;
  }

  global.MoveQuality = {
    scoreToCpWhite,
    centipawnLoss,
    winPercent,
    winChanceLoss,
    classifyWinLoss,
    judgmentGlyph,
    judgmentLabel,
    moveAccuracy,
    accuracyFromWinLosses,
    buildKeyMoments,
    formatEval,
    evalBarRatio,
  };
})(window);
