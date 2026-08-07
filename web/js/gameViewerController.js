"use strict";

(function(global) {
  const PLAYBACK_INTERVAL_MS = 1100;

  // Stockfish, playback and board rendering form one cohesive viewer feature.
  // Its lower-level helpers remain private behind this controller facade.
  let state;
  let api;
  let setLoading;
  let toast;
  let openDialog;
  let t;
  let formatNumber;
  let shortDate;
  let sourceLabel;
  let escapeHtml;
  let $;
  let $$;
  let PIECES;
  let engine;
  let liveEngine;
  let exploreEngine;
  let gameAnalysis;
  let explore;
  let draggedSquare = null;
  let suppressBoardClick = false;

  class GameViewerController {
    constructor(dependencies) {
      state = dependencies.state;
      api = dependencies.api;
      setLoading = dependencies.setLoading;
      toast = dependencies.toast;
      openDialog = dependencies.openDialog;
      t = dependencies.t;
      formatNumber = dependencies.formatNumber;
      shortDate = dependencies.shortDate;
      sourceLabel = dependencies.sourceLabel;
      escapeHtml = dependencies.escapeHtml;
      $ = dependencies.$;
      $$ = dependencies.$$;
      PIECES = dependencies.pieces;
      engine = new global.StockfishEngine();
      // Live MultiPV lines use a dedicated worker so progressive game analysis
      // does not serialize behind (or starve) the interactive recommendation.
      liveEngine = new global.StockfishEngine();
      exploreEngine = new global.StockfishEngine();
      gameAnalysis = new global.GameAnalysisController(engine);
      explore = new global.ExploreMode(exploreEngine);
      state.engineNodes = loadEngineSetting(
        "chessprep_engine_nodes",
        global.STOCKFISH_DEFAULT_NODES,
        global.STOCKFISH_MIN_NODES,
        global.STOCKFISH_MAX_NODES,
      );
      state.engineLines = loadEngineSetting(
        "chessprep_engine_lines",
        global.STOCKFISH_DEFAULT_LINES,
        global.STOCKFISH_MIN_LINES,
        global.STOCKFISH_MAX_LINES,
      );
    }

    bindEvents() {
      $$("[data-move]").forEach((button) => {
        button.addEventListener("click", () => handleViewerControl(button.dataset.move));
      });
      $("#analysis-toggle").addEventListener("change", (event) => setAnalysisEnabled(event.target.checked));
      $("#explore-undo").addEventListener("click", undoManualMove);
      $("#explore-exit").addEventListener("click", resetManualVariation);
      $("#eval-curve").addEventListener("click", handleEvalCurveClick);
      ["analysis-strength", "analysis-lines"].forEach((id) => {
        const input = document.getElementById(id);
        input.addEventListener("change", () => {
          applyEngineSettingsFromInputs({
            restartGameAnalysis: id === "analysis-strength"
          });
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            input.blur();
          }
        });
      });
      syncEngineSettingInputs();
    }

    open(source, gameId) {
      return openGame(source, gameId);
    }

    close() {
      stopPlaying();
      resetViewerAnalysis({
        keepToggle: false
      });
    }

    refreshLanguage() {
      if (!state.viewerGame) return;
      renderViewerMeta();
      renderMoves();
      renderBoard();
      renderAnalysisUi();
    }

    handleKeydown(event) {
      if ($("#viewer-dialog").hidden) return false;
      const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleViewerControl("prev");
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleViewerControl("next");
      }
      if (event.key === "Home") {
        event.preventDefault();
        handleViewerControl("first");
      }
      if (event.key === "End") {
        event.preventDefault();
        handleViewerControl("last");
      }
      if (!typing && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        setAnalysisEnabled(!state.analysisEnabled);
      }
      if (event.key === "Escape" && explore.canUndo()) {
        event.preventDefault();
        resetManualVariation();
        return true;
      }
      return false;
    }
  }

  function loadEngineSetting(key, fallback, min, max) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : global.clampEngineSetting(raw, min, max);
    } catch {
      return fallback;
    }
  }

  function saveEngineSetting(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* Storage can be disabled. */ }
  }

  function getEngineSettings() {
    return {
      nodes: state.engineNodes,
      lines: state.engineLines
    };
  }

  async function openGame(source, gameId) {
    setLoading(true, t("loading.placingPieces"));
    try {
      resetViewerAnalysis({
        keepToggle: false
      });
      state.viewerGame = await api(`/games/${encodeURIComponent(source)}/${encodeURIComponent(gameId)}`);
      state.ply = 0;
      renderViewerMeta();
      renderMoves();
      try {
        await initializeInteractiveBoard();
      } catch (error) {
        toast(t("toast.exploreError"), error.message || String(error), "error");
      }
      renderBoard();
      renderAnalysisUi();
      openDialog("viewer-dialog");
    } catch (error) {
      toast(t("toast.openError"), error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function renderViewerMeta() {
    const game = state.viewerGame;
    // Keep the conventional score-sheet order regardless of which player was searched.
    $("#viewer-title").textContent = `${game.white} — ${game.black}`;
    const tags = $("#viewer-tags");
    tags.replaceChildren(...[game.eco, game.opening, game.result, game.game_type.toUpperCase(), shortDate(game.date)]
      .filter(Boolean)
      .map((tag) => {
        const span = document.createElement("span");
        span.textContent = String(tag);
        return span;
      }));
    const renderBoardPlayer = (element, piece, name, rating) => {
      element.replaceChildren(document.createTextNode(`${piece} ${String(name ?? "")}`));
      if (rating) {
        const ratingNode = document.createElement("span");
        ratingNode.textContent = String(rating);
        element.append(" ", ratingNode);
      }
    };
    if (game.player_color === "black") {
      renderBoardPlayer($("#board-player-top"), "♙", game.white, game.white_elo);
      renderBoardPlayer($("#board-player-bottom"), "♟", game.black, game.black_elo);
    } else {
      renderBoardPlayer($("#board-player-top"), "♟", game.black, game.black_elo);
      renderBoardPlayer($("#board-player-bottom"), "♙", game.white, game.white_elo);
    }
    const source = $("#viewer-source");
    const sourceHeading = document.createElement("strong");
    sourceHeading.textContent = t("dynamic.source", {
      source: sourceLabel(game.source)
    });
    source.replaceChildren(
      sourceHeading,
      document.createElement("br"),
      document.createTextNode(
        `${game.event || t("game.unspecifiedEvent")} · ${game.site || t("game.noExternalLink")} · ${t("game.confidence")} ${game.source_confidence}.`
        ),
    );
  }

  function moveGlyphHtml(ply) {
    const item = state.analysis?.plies?.[ply - 1];
    if (!item?.glyph) return "";
    return `<span class="move-glyph ${escapeHtml(item.judgment)}" title="${escapeHtml(t(`quality.${item.judgment}`))} (${item.cpl} cp)">${escapeHtml(item.glyph)}</span>`;
  }

  function renderMoves() {
    const game = state.viewerGame;
    let html = "";
    for (let index = 0; index < game.moves.length; index += 2) {
      html += `<span class="move-number">${index / 2 + 1}.</span>`;
      html +=
        `<button class="move ${state.ply === index + 1 ? "active" : ""}" data-ply="${index + 1}">${escapeHtml(game.moves[index])}${moveGlyphHtml(index + 1)}</button>`;
      html += game.moves[index + 1] ?
        `<button class="move ${state.ply === index + 2 ? "active" : ""}" data-ply="${index + 2}">${escapeHtml(game.moves[index + 1])}${moveGlyphHtml(index + 2)}</button>` :
        `<span></span>`;
    }
    $("#moves-list").innerHTML = html;
    $$(".move", $("#moves-list")).forEach((button) => button.addEventListener("click", () => setPly(Number(button
      .dataset.ply))));
    const active = $(".move.active", $("#moves-list"));
    active?.scrollIntoView({
      block: "nearest"
    });
  }

  function currentBoardFen() {
    if (explore.active) return explore.fen();
    return state.viewerGame?.fens[state.ply] || "";
  }

  function parseFen(fen) {
    const board = [];
    for (const row of fen.split(" ")[0].split("/")) {
      const cells = [];
      for (const char of row) {
        if (/\d/.test(char)) cells.push(...Array(Number(char)).fill(""));
        else cells.push(char);
      }
      board.push(cells);
    }
    return board;
  }

  function renderBoard() {
    const game = state.viewerGame;
    if (!game) return;
    const fen = currentBoardFen();
    const position = parseFen(fen);
    const blackPerspective = game.player_color === "black";
    const ranks = blackPerspective ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
    const files = blackPerspective ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g",
      "h"
    ];
    const rows = blackPerspective ? [...position].reverse() : position;
    const ordered = rows.map((row) => blackPerspective ? [...row].reverse() : row);
    const last = (!explore.canUndo() && state.ply) ? game.moves_uci[state.ply - 1] : "";
    const highlighted = last ? [last.slice(0, 2), last.slice(2, 4)] : [];
    const selected = explore.active ? explore.selectedSquare : null;
    const legal = explore.active ? explore.legalTargets : [];
    let html = "";
    ordered.forEach((row, rowIndex) => row.forEach((piece, colIndex) => {
      const squareName = `${files[colIndex]}${ranks[rowIndex]}`;
      const dark = (rowIndex + colIndex) % 2 === 1;
      const classes = [
        "board-square",
        dark ? "dark" : "",
        highlighted.includes(squareName) ? "last-move" : "",
        selected === squareName ? "selected" : "",
        legal.includes(squareName) ? "legal-target" : "",
        explore.active ? "explore-clickable" : "",
      ].filter(Boolean).join(" ");
      const fileCoord = rowIndex === 7 ? `<span class="coord file">${files[colIndex]}</span>` : "";
      const rankCoord = colIndex === 0 ? `<span class="coord rank">${ranks[rowIndex]}</span>` : "";
      const draggable = explore.active && piece && explore.canMoveFrom(squareName) ? ' draggable="true"' : "";
      const pieceNode = piece ? `<span class="board-piece"${draggable}>${PIECES[piece] || ""}</span>` : "";
      html +=
        `<span class="${classes}" data-square="${squareName}">${fileCoord}${rankCoord}${pieceNode}</span>`;
    }));
    $("#chessboard").innerHTML = html;
    if (explore.active) bindExploreBoardEvents();
    $("#move-count").textContent = `${state.ply} / ${game.moves.length}`;
    if (explore.canUndo()) {
      $("#move-label").textContent = t("dynamic.exploreMode");
    } else {
      $("#move-label").textContent = state.ply ? t("dynamic.afterMove", {
        move: game.moves[state.ply - 1]
      }) : t("viewer.initial");
    }
    renderBoardArrow();
    renderEvalBar();
  }

  function bindExploreBoardEvents() {
    const board = $("#chessboard");
    $$(".board-square", board).forEach((square) => {
      square.addEventListener("click", () => {
        if (suppressBoardClick) return;
        explore.handleSquareClick(square.dataset.square);
      });
      square.addEventListener("dragstart", (event) => {
        const from = square.dataset.square;
        const targets = explore.legalMovesFrom(from);
        if (!targets.length) {
          event.preventDefault();
          return;
        }
        draggedSquare = from;
        suppressBoardClick = true;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", from);
        event.target.closest(".board-piece")?.classList.add("dragging");
        square.classList.add("selected");
        targets.forEach((target) => {
          board.querySelector(`[data-square="${target}"]`)?.classList.add("legal-target", "drag-target");
        });
      });
      square.addEventListener("dragover", (event) => {
        if (!draggedSquare || !explore.legalMovesFrom(draggedSquare).includes(square.dataset.square)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        square.classList.add("drag-over");
      });
      square.addEventListener("dragleave", () => square.classList.remove("drag-over"));
      square.addEventListener("drop", (event) => {
        const from = event.dataTransfer.getData("text/plain") || draggedSquare;
        const to = square.dataset.square;
        if (!from || !explore.legalMovesFrom(from).includes(to)) return;
        event.preventDefault();
        clearBoardDragState();
        explore.movePiece(from, to);
      });
      square.addEventListener("dragend", () => {
        clearBoardDragState();
        window.setTimeout(() => { suppressBoardClick = false; }, 120);
      });
    });
  }

  function clearBoardDragState() {
    draggedSquare = null;
    $$(".board-square", $("#chessboard")).forEach((square) => {
      square.classList.remove("drag-target", "drag-over", "selected", "legal-target");
    });
    $$(".board-piece.dragging", $("#chessboard")).forEach((piece) => piece.classList.remove("dragging"));
  }

  function setPly(value) {
    if (!state.viewerGame) return;
    state.ply = Math.max(0, Math.min(value, state.viewerGame.moves.length));
    state.selectedLine = 1;
    state.liveProbeId += 1;
    state.liveLines = [];
    if (explore.active) explore.setPosition(state.viewerGame.fens[state.ply], state.ply);
    renderBoard();
    renderMoves();
    renderAnalysisSummary();
    drawEvalCurve();
    if (state.analysisEnabled) probeLiveLines();
  }

  function handleViewerControl(action) {
    if (!state.viewerGame) return;
    if (action !== "play" && state.playTimer) stopPlaying();
    if (action === "first") setPly(0);
    if (action === "prev") setPly(state.ply - 1);
    if (action === "next") setPly(state.ply + 1);
    if (action === "last") setPly(state.viewerGame.moves.length);
    if (action === "play") {
      state.playTimer ? stopPlaying() : startPlaying();
    }
  }

  function startPlaying() {
    if (state.ply >= state.viewerGame.moves.length) setPly(0);
    $("[data-move='play']").textContent = "Ⅱ";
    state.playTimer = setInterval(() => {
      if (state.ply >= state.viewerGame.moves.length) return stopPlaying();
      setPly(state.ply + 1);
    }, PLAYBACK_INTERVAL_MS);
  }

  function stopPlaying() {
    clearInterval(state.playTimer);
    state.playTimer = null;
    $("[data-move='play']").textContent = "▶";
  }

  function resetViewerAnalysis({
    keepToggle = false
  } = {}) {
    gameAnalysis.clearActive();
    state.liveProbeId += 1;
    try { liveEngine?.stop(); } catch { /* ignore */ }
    try { liveEngine?.terminate(); } catch { /* ignore */ }
    if (explore.active) explore.exit();
    state.analysis = null;
    state.liveLines = [];
    state.selectedLine = 1;
    if (!keepToggle) {
      state.analysisEnabled = false;
      const toggle = $("#analysis-toggle");
      if (toggle) toggle.checked = false;
    }
    $("#viewer-dialog")?.classList.remove("analysis-on");
    renderAnalysisUi();
  }

  function currentStrengthId() {
    return global.stockfishStrengthForNodes(state.engineNodes);
  }

  function strengthLabel(strengthId = currentStrengthId()) {
    const key = {
      fast: "viewer.strengthFast",
      normal: "viewer.strengthNormal",
      deep: "viewer.strengthDeep",
    }[strengthId] || "viewer.strengthNormal";
    return t(key);
  }

  function syncEngineSettingInputs() {
    const strengthInput = $("#analysis-strength");
    const linesInput = $("#analysis-lines");
    if (strengthInput) strengthInput.value = currentStrengthId();
    if (linesInput) linesInput.value = String(state.engineLines);
  }

  function renderAnalysisUi() {
    const enabled = state.analysisEnabled;
    const body = $("#analysis-body");
    const evalBar = $("#eval-bar");
    if (body) body.hidden = !enabled;
    if (evalBar) {
      evalBar.hidden = !enabled;
      evalBar.setAttribute("aria-hidden", enabled ? "false" : "true");
    }
    $("#viewer-dialog")?.classList.toggle("analysis-on", enabled);
    syncEngineSettingInputs();
    renderAnalysisStatus();
    renderAnalysisSummary();
    renderLiveLines();
    renderKeyMoments();
    drawEvalCurve();
    renderExploreBar();
    renderEvalBar();
    renderBoardArrow();
  }

  function renderAnalysisStatus() {
    const el = $("#analysis-status");
    if (!el) return;
    if (!state.analysisEnabled) {
      el.textContent = "";
      return;
    }
    const analysis = state.analysis;
    if (!analysis) {
      el.textContent = t("dynamic.enginePreparing");
      return;
    }
    if (analysis.status === "error") {
      el.textContent = analysis.error || t("dynamic.engineError");
      return;
    }
    if (analysis.status === "complete") {
      el.textContent = t("dynamic.engineReady", {
        strength: strengthLabel(),
        count: state.engineLines,
        lines: t(state.engineLines === 1 ? "dynamic.line" : "dynamic.lines")
      });
      return;
    }
    el.textContent = t("dynamic.engineAnalysing", {
      done: analysis.done,
      total: analysis.total,
      strength: strengthLabel()
    });
  }

  function currentPlyEval() {
    if (explore.canUndo()) {
      const tries = explore.tries || [];
      for (let i = tries.length - 1; i >= 0; i -= 1) {
        if (tries[i].status === "done") return tries[i].score;
      }
      return null;
    }
    return state.analysis?.evals?.[state.ply] || null;
  }

  function currentMoveJudgment() {
    if (explore.canUndo()) return explore.lastTry || null;
    if (!state.ply || !state.analysis?.plies) return null;
    return state.analysis.plies[state.ply - 1] || null;
  }

  function qualityLossText(judgment) {
    if (!judgment) return "";
    const cp = `${Math.round(Number(judgment.cpl) || 0)} cp`;
    if (!Number.isFinite(Number(judgment.winLoss))) return cp;
    return `${t("analysis.winLoss")} ${formatNumber(judgment.winLoss)} pp · ${cp}`;
  }

  function formatManualTrySummary(entry) {
    if (!entry) return t("analysis.chooseMove");
    if (entry.status === "pending" || entry.status === "analyzing") {
      return `${t("analysis.yourMove")} <strong>${escapeHtml(entry.san)}</strong> · ${t("analysis.evaluatingMove")}`;
    }
    if (entry.status === "error") {
      return escapeHtml(entry.error || t("analysis.evaluateError"));
    }
    if (entry.status !== "done") return t("analysis.chooseMove");
    return (
      `${t("analysis.yourMove")} <strong>${escapeHtml(entry.san)}</strong>` +
      `${entry.glyph ? ` <span class="judgment ${escapeHtml(entry.judgment)}">${escapeHtml(entry.glyph)}</span>` : ""}` +
      ` · ${t("quality.best")} <strong>${escapeHtml(entry.bestSan || "—")}</strong>` +
      ` · ${escapeHtml(qualityLossText(entry))}` +
      ` · <span class="judgment ${escapeHtml(entry.judgment)}">${escapeHtml(t(`quality.${entry.judgment}`))}</span>`
    );
  }

  function formatManualTryLine(entry, index) {
    const plyLabel = index + 1;
    if (entry.status === "pending" || entry.status === "analyzing") {
      return `<div class="manual-try analyzing">` +
        `<span class="manual-try-ply">${plyLabel}</span>` +
        `<span class="manual-try-san">${escapeHtml(entry.san)}</span>` +
        `<span class="manual-try-detail">${escapeHtml(t("analysis.evaluatingMove"))}</span>` +
        `</div>`;
    }
    if (entry.status === "error") {
      return `<div class="manual-try error">` +
        `<span class="manual-try-ply">${plyLabel}</span>` +
        `<span class="manual-try-san">${escapeHtml(entry.san)}</span>` +
        `<span class="manual-try-detail">${escapeHtml(entry.error || t("analysis.evaluateError"))}</span>` +
        `</div>`;
    }
    return `<div class="manual-try ${escapeHtml(entry.judgment || "")}">` +
      `<span class="manual-try-ply">${plyLabel}</span>` +
      `<span class="manual-try-san">${escapeHtml(entry.san)}${entry.glyph ? ` <span class="judgment ${escapeHtml(entry.judgment)}">${escapeHtml(entry.glyph)}</span>` : ""}</span>` +
      `<span class="manual-try-detail">` +
      `<span class="judgment ${escapeHtml(entry.judgment)}">${escapeHtml(t(`quality.${entry.judgment}`))}</span>` +
      ` · ${t("quality.best")} <strong>${escapeHtml(entry.bestSan || "—")}</strong>` +
      ` · ${escapeHtml(qualityLossText(entry))}` +
      `</span>` +
      `</div>`;
  }

  function formatManualTryCompact(entry) {
    if (!entry) return "";
    if (entry.status === "pending" || entry.status === "analyzing") {
      return `<strong>${escapeHtml(entry.san)}</strong>…`;
    }
    if (entry.status === "error") {
      return `<strong>${escapeHtml(entry.san)}</strong> ${escapeHtml(t("analysis.evaluateError"))}`;
    }
    const glyph = entry.glyph
      ? ` <span class="judgment ${escapeHtml(entry.judgment)}">${escapeHtml(entry.glyph)}</span>`
      : "";
    return `<strong>${escapeHtml(entry.san)}</strong>${glyph} <span class="judgment ${escapeHtml(entry.judgment)}">${escapeHtml(t(`quality.${entry.judgment}`))}</span>`;
  }

  function renderAnalysisSummary() {
    const el = $("#analysis-summary");
    if (!el || !state.analysisEnabled) return;
    const game = state.viewerGame;
    if (!game) {
      el.innerHTML = "";
      return;
    }

    const score = currentPlyEval();
    const evalText = MoveQuality.formatEval(score);
    const judgment = currentMoveJudgment();
    const accuracyParts = [];
    if (state.analysis?.whiteAccuracy != null) accuracyParts.push(
      `${t("filter.white")} ${formatNumber(state.analysis.whiteAccuracy)}%`);
    if (state.analysis?.blackAccuracy != null) accuracyParts.push(
      `${t("filter.black")} ${formatNumber(state.analysis.blackAccuracy)}%`);

    let moveLine = t("viewer.initial");
    if (explore.canUndo()) {
      moveLine = formatManualTrySummary(explore.lastTry);
    } else if (judgment) {
      moveLine =
        `${t("analysis.move")} <strong>${escapeHtml(judgment.san)}</strong>${judgment.glyph ? ` <span class="judgment ${escapeHtml(judgment.judgment)}">${escapeHtml(judgment.glyph)}</span>` : ""} · ${t("quality.best")} <strong>${escapeHtml(judgment.bestSan || "—")}</strong> · ${escapeHtml(qualityLossText(judgment))} · <span class="judgment ${escapeHtml(judgment.judgment)}">${escapeHtml(t(`quality.${judgment.judgment}`))}</span>`;
    } else if (state.ply > 0 && state.analysis && state.analysis.done < state.ply) {
      moveLine = t("analysis.pendingMove");
    }

    el.innerHTML = [
      `<div><strong>${t("analysis.eval")}</strong> ${escapeHtml(evalText)}${accuracyParts.length ? ` · ${t("analysis.accuracy")} ${accuracyParts.join(" · ")}` : ""}</div>`,
      `<div>${moveLine}</div>`,
    ].join("");
  }

  function renderKeyMoments() {
    const el = $("#key-moments");
    if (!el) return;
    if (!state.analysisEnabled || !state.analysis?.keyMoments?.length) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = state.analysis.keyMoments.map((moment) => (
      `<button type="button" class="key-moment ${escapeHtml(moment.judgment)}" data-ply="${moment.ply}" title="${escapeHtml(t(`quality.${moment.judgment}`))}">` +
      `<span class="glyph">${escapeHtml(moment.glyph || "")}</span>${escapeHtml(moment.san)}` +
      `</button>`
    )).join("");
    $$(".key-moment", el).forEach((button) => {
      button.addEventListener("click", () => setPly(Number(button.dataset.ply)));
    });
  }

  function renderEvalBar() {
    const bar = $("#eval-bar");
    const fill = $("#eval-bar-fill");
    const label = $("#eval-bar-label");
    if (!bar || !fill || !label || bar.hidden) return;
    const score = currentPlyEval() || {
      cp: 0
    };
    const ratio = MoveQuality.evalBarRatio(score);
    const flipped = state.viewerGame?.player_color === "black";
    const displayRatio = flipped ? 1 - ratio : ratio;
    fill.style.height = `${Math.round(displayRatio * 100)}%`;
    label.textContent = MoveQuality.formatEval(score);
    bar.classList.toggle("white-ahead", MoveQuality.scoreToCpWhite(score) >= 0);
  }

  function squareCenter(square, blackPerspective) {
    const file = square.charCodeAt(0) - 97;
    const rank = Number(square[1]) - 1;
    const x = blackPerspective ? 7 - file : file;
    const y = blackPerspective ? rank : 7 - rank;
    return {
      x: x + 0.5,
      y: y + 0.5
    };
  }

  function selectedLiveLine() {
    return state.liveLines.find((line) => line.multipv === state.selectedLine) || state.liveLines[0] || null;
  }

  function scoreNumStm(score) {
    // Higher is better for the side to move (UCI scores are already STM-relative).
    if (typeof score?.mate === "number") {
      return score.mate > 0 ? 100000 - score.mate : -100000 - score.mate;
    }
    return score?.cp ?? 0;
  }

  function formatLiveLines(fen, result, requestedLines) {
    const source = (result?.lines || [])
      .filter((line) => line?.pv?.[0])
      .slice()
      // Rank by STM score from the same MultiPV search so the UI never mixes
      // evals from separate searches (which produced unordered alternatives).
      .sort((a, b) => scoreNumStm(b.score) - scoreNumStm(a.score))
      .slice(0, requestedLines);

    return source.map((line, index) => ({
      ...line,
      multipv: index + 1,
      sanPv: pvToSan(fen, line.pv),
      moveUci: line.pv?.[0] || "",
    }));
  }

  function commitLiveLines(fen, lines) {
    state.liveLines = lines;
    if (!state.liveLines.some((line) => line.multipv === state.selectedLine)) {
      state.selectedLine = 1;
    }
    renderLiveLines();
    renderBoardArrow();
    if (state.liveLines[0]?.score && state.analysis?.evals) {
      const side = fen.split(" ")[1] || "w";
      state.analysis.evals[state.ply] = toWhitePov(state.liveLines[0].score, side);
      renderEvalBar();
      renderAnalysisSummary();
    }
  }

  function renderLiveLines() {
    const el = $("#analysis-lines-list");
    if (!el) return;
    if (!state.analysisEnabled) {
      el.innerHTML = "";
      return;
    }
    if (explore.canUndo()) {
      const tries = explore.tries || [];
      if (!tries.length) {
        el.innerHTML = `<div class="analysis-line-empty">${escapeHtml(t("analysis.manualHint"))}</div>`;
        return;
      }
      el.innerHTML = tries.map((entry, index) => formatManualTryLine(entry, index)).join("");
      return;
    }
    if (!state.liveLines.length) {
      el.innerHTML =
        `<div class="analysis-line-empty">${escapeHtml(t("dynamic.calculatingLines", { count: state.engineLines, lines: t(state.engineLines === 1 ? "dynamic.line" : "dynamic.lines"), strength: strengthLabel() }))}</div>`;
      return;
    }
    const side = (state.viewerGame?.fens[state.ply] || "").split(" ")[1] || "w";
    el.innerHTML = state.liveLines.map((line) => {
      const whiteScore = toWhitePov(line.score, side);
      const evalText = MoveQuality.formatEval(whiteScore);
      const pvText = (line.sanPv?.length ? line.sanPv : line.pv).slice(0, 10).join(" ");
      const active = line.multipv === state.selectedLine ? "active" : "";
      const isBest = line.multipv === 1;
      const lineLabel = isBest
        ? t("analysis.bestLine")
        : t("analysis.alternativeLine", { number: line.multipv });
      return `<button type="button" class="analysis-line ${active}" data-multipv="${line.multipv}" aria-label="${escapeHtml(lineLabel)}" title="${escapeHtml(lineLabel)}">` +
        `<span class="line-rank">${isBest ? "★" : line.multipv}</span>` +
        `<span class="line-eval">${escapeHtml(evalText)}</span>` +
        `<span class="line-pv">${escapeHtml(pvText)}</span>` +
        `</button>`;
    }).join("");
    $$(".analysis-line", el).forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedLine = Number(button.dataset.multipv) || 1;
        renderLiveLines();
        renderBoardArrow();
      });
    });
  }

  async function probeLiveLines() {
    if (!state.analysisEnabled || !state.viewerGame || explore.canUndo()) return;
    const probeId = ++state.liveProbeId;
    const fen = state.viewerGame.fens[state.ply];
    const nodes = state.engineNodes;
    const multipv = state.engineLines;
    state.liveLines = [];
    renderLiveLines();
    try {
      await loadChessScript();
      // One MultiPV search: avoids the old dual-search cost and keeps every
      // displayed line's eval from the same node budget / depth snapshot.
      const result = await liveEngine.analyzeFen(fen, { nodes, multipv });
      if (probeId !== state.liveProbeId || !state.analysisEnabled) return;
      commitLiveLines(fen, formatLiveLines(fen, result, multipv));
    } catch (error) {
      if (probeId !== state.liveProbeId) return;
      if (error.message === "Análisis cancelado" || error.message === "Motor detenido") return;
      const el = $("#analysis-lines-list");
      if (el && !state.liveLines.length) el.innerHTML =
        `<div class="analysis-line-empty">${escapeHtml(error.message || t("dynamic.linesError"))}</div>`;
    }
  }

  function renderBoardArrow() {
    const svg = $("#board-arrows");
    if (!svg) return;
    if (!state.analysisEnabled || !state.viewerGame || explore.canUndo()) {
      svg.innerHTML = "";
      return;
    }
    let uci = "";
    const live = selectedLiveLine();
    if (live?.moveUci) uci = live.moveUci;
    if (!uci || uci.length < 4) {
      svg.innerHTML = "";
      return;
    }
    const blackPerspective = state.viewerGame.player_color === "black";
    const from = squareCenter(uci.slice(0, 2), blackPerspective);
    const to = squareCenter(uci.slice(2, 4), blackPerspective);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Tip near destination; shaft stops at the arrowhead base so it doesn't poke through.
    const tipX = to.x - ux * 0.12;
    const tipY = to.y - uy * 0.12;
    const headLen = Math.min(0.42, Math.max(0.28, len * 0.28));
    const headWidth = 0.18;
    const baseX = tipX - ux * headLen;
    const baseY = tipY - uy * headLen;
    const leftX = baseX - uy * headWidth;
    const leftY = baseY + ux * headWidth;
    const rightX = baseX + uy * headWidth;
    const rightY = baseY - ux * headWidth;
    svg.innerHTML = `
    <line x1="${from.x}" y1="${from.y}" x2="${baseX}" y2="${baseY}"></line>
    <polygon points="${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}"></polygon>
  `;
  }

  function drawEvalCurve() {
    const canvas = $("#eval-curve");
    if (!canvas || !state.analysisEnabled) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const middle = height / 2;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#faf7ef";
    ctx.fillRect(0, 0, width, middle);
    ctx.fillStyle = "#dce5e1";
    ctx.fillRect(0, middle, width, middle);
    ctx.strokeStyle = "rgba(16, 35, 31, .28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, middle);
    ctx.lineTo(width, middle);
    ctx.stroke();

    ctx.save();
    ctx.font = 'bold 12px "Segoe UI Symbol", serif';
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(108, 89, 49, .62)";
    ctx.fillText("♙", 6, 11);
    ctx.fillStyle = "rgba(16, 35, 31, .7)";
    ctx.fillText("♟", 6, height - 11);
    ctx.restore();

    const evals = state.analysis?.evals;
    if (!evals?.length) return;
    const points = evals.map((score, index) => {
      if (!score) return null;
      const cp = Math.max(-800, Math.min(800, MoveQuality.scoreToCpWhite(score)));
      const x = evals.length === 1 ? 0 : (index / (evals.length - 1)) * (width - 2) + 1;
      const y = (1 - (cp + 800) / 1600) * (height - 4) + 2;
      return {
        x,
        y,
        index
      };
    }).filter(Boolean);
    if (points.length < 2) return;

    const fillEvaluationArea = (color, top, bottom) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, width, bottom - top);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(points[0].x, middle);
      points.forEach((point) => ctx.lineTo(point.x, point.y));
      ctx.lineTo(points[points.length - 1].x, middle);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    };
    fillEvaluationArea("rgba(211, 169, 73, .34)", 0, middle);
    fillEvaluationArea("rgba(16, 35, 31, .24)", middle, height);

    ctx.strokeStyle = "#1c3932";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    if (state.ply < evals.length) {
      const x = evals.length === 1 ? width / 2 : (state.ply / (evals.length - 1)) * (width - 2) + 1;
      ctx.strokeStyle = "#d9673e";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const current = points.find((point) => point.index === state.ply);
      if (current) {
        ctx.beginPath();
        ctx.arc(current.x, current.y, 3.6, 0, Math.PI * 2);
        ctx.fillStyle = current.y <= middle ? "#faf7ef" : "#10231f";
        ctx.fill();
        ctx.strokeStyle = "#d9673e";
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
  }

  function handleEvalCurveClick(event) {
    if (!state.viewerGame || !state.analysis?.evals?.length) return;
    const canvas = $("#eval-curve");
    const rect = canvas.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const ply = Math.round(ratio * (state.viewerGame.moves.length));
    setPly(ply);
  }

  function setAnalysisEnabled(enabled) {
    state.analysisEnabled = enabled;
    $("#analysis-toggle").checked = enabled;
    if (!enabled) {
      state.liveProbeId += 1;
      try { liveEngine.stop(); } catch { /* ignore */ }
      gameAnalysis.stop();
      if (explore.canUndo()) resetManualVariation();
      state.liveLines = [];
      renderAnalysisUi();
      renderMoves();
      renderBoard();
      return;
    }
    if (!state.viewerGame) return;
    renderAnalysisUi();
    // Progressive game quality uses `engine`; live lines use `liveEngine` so
    // recommendations stay responsive while the full game is still analysing.
    engine.terminate();
    void probeLiveLines();
    void gameAnalysis.start(state.viewerGame, {
        nodes: state.engineNodes,
        onUpdate: (analysis) => {
          if (!state.analysisEnabled || !state.viewerGame) return;
          if (analysis.key !== `${state.viewerGame.source}:${state.viewerGame.id}:n${state.engineNodes}`)
            return;
          state.analysis = analysis;
          renderAnalysisStatus();
          renderAnalysisSummary();
          renderKeyMoments();
          drawEvalCurve();
          renderEvalBar();
          renderBoardArrow();
          renderMoves();
          if (analysis.status === "error") {
            toast(t("toast.analysisError"), analysis.error || t("dynamic.engineError"), "error");
          }
        },
      }).catch((error) => {
      engine.terminate();
      if (!state.analysisEnabled) return;
      state.analysisEnabled = false;
      $("#analysis-toggle").checked = false;
      renderAnalysisUi();
      toast(t("toast.engineUnavailable"), error.message || String(error), "error");
      });
  }

  async function applyEngineSettingsFromInputs({
    restartGameAnalysis = false
  } = {}) {
    const strengthId = $("#analysis-strength")?.value || global.STOCKFISH_DEFAULT_STRENGTH;
    const nextNodes = global.stockfishNodesForStrength(strengthId);
    const nextLines = clampEngineSetting(
      $("#analysis-lines")?.value,
      STOCKFISH_MIN_LINES,
      STOCKFISH_MAX_LINES,
    );
    const nodesChanged = nextNodes !== state.engineNodes;
    const linesChanged = nextLines !== state.engineLines;
    state.engineNodes = nextNodes;
    state.engineLines = nextLines;
    saveEngineSetting("chessprep_engine_nodes", nextNodes);
    saveEngineSetting("chessprep_engine_lines", nextLines);
    syncEngineSettingInputs();

    if (!state.analysisEnabled || !state.viewerGame) return;
    if (explore.canUndo()) return;
    if (nodesChanged && restartGameAnalysis) {
      gameAnalysis.stop();
      state.analysis = null;
      engine.terminate();
      setAnalysisEnabled(true);
      return;
    }
    if (nodesChanged || linesChanged) {
      state.selectedLine = 1;
      probeLiveLines();
    }
  }

  function renderExploreBar() {
    const bar = $("#explore-bar");
    const feedback = $("#explore-feedback");
    const undo = $("#explore-undo");
    if (!bar || !feedback || !undo) return;
    bar.hidden = !explore.canUndo();
    undo.disabled = !explore.canUndo();
    if (!explore.canUndo()) {
      feedback.textContent = "";
      return;
    }
    const tries = explore.tries || [];
    if (!tries.length) {
      feedback.textContent = t("dynamic.clickPiece");
      return;
    }
    feedback.innerHTML = tries.map((entry) => formatManualTryCompact(entry)).join(" · ");
  }

  function renderInteractiveBoardState() {
    renderBoard();
    renderExploreBar();
    renderAnalysisSummary();
    renderLiveLines();
    renderBoardArrow();
    renderEvalBar();
  }

  function handleManualMove() {
    if (state.playTimer) stopPlaying();
    state.liveProbeId += 1;
    state.liveLines = [];
    state.selectedLine = 1;
    if (!state.analysisEnabled) setAnalysisEnabled(true);
  }

  async function initializeInteractiveBoard() {
    if (!state.viewerGame) return;
    await explore.enter(state.viewerGame.fens[state.ply], state.ply, {
      getSettings: getEngineSettings,
      onMove: handleManualMove,
      onChange: renderInteractiveBoardState,
    });
  }

  function resetManualVariation() {
    if (!state.viewerGame || !explore.active) return;
    state.liveProbeId += 1;
    state.liveLines = [];
    state.selectedLine = 1;
    explore.setPosition(state.viewerGame.fens[state.ply], state.ply);
    if (state.analysisEnabled) void probeLiveLines();
  }

  function undoManualMove() {
    if (!explore.canUndo()) return;
    explore.undo();
    if (!explore.canUndo() && state.analysisEnabled) {
      state.liveProbeId += 1;
      state.liveLines = [];
      void probeLiveLines();
    }
  }

  global.GameViewerController = GameViewerController;
})(window);
