"use strict";

(function (global) {
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

  function classifyCpl(cpl, { missedMate = false, allowedMate = false } = {}) {
    if (missedMate) return "blunder";
    if (allowedMate && cpl > 50) return "blunder";
    if (cpl <= 5) return "best";
    if (cpl <= 20) return "excellent";
    if (cpl <= 50) return "good";
    if (cpl <= 100) return "inaccuracy";
    if (cpl <= 200) return "mistake";
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

  function accuracyFromCpls(cpls) {
    if (!cpls.length) return null;
    const avg = cpls.reduce((sum, value) => sum + value, 0) / cpls.length;
    const accuracy = 100 * (0.8 ** (avg / 50));
    return Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10));
  }

  function buildKeyMoments(plyEvals, { limit = 8 } = {}) {
    const severity = { blunder: 3, mistake: 2, inaccuracy: 1 };
    return plyEvals
      .filter((item) => item && severity[item.judgment])
      .filter((item) => item.judgment !== "inaccuracy" || item.cpl >= 50)
      .sort((a, b) => (severity[b.judgment] - severity[a.judgment]) || (b.cpl - a.cpl))
      .slice(0, limit)
      .map((item) => ({
        ply: item.ply,
        san: item.san,
        judgment: item.judgment,
        glyph: judgmentGlyph(item.judgment),
        cpl: item.cpl,
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
    classifyCpl,
    judgmentGlyph,
    judgmentLabel,
    accuracyFromCpls,
    buildKeyMoments,
    formatEval,
    evalBarRatio,
  };
})(window);
