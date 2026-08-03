"use strict";

(function(global) {
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
  let gameAnalysis;
  let explore;

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
      gameAnalysis = new global.GameAnalysisController(engine);
      explore = new global.ExploreMode(engine);
      state.engineDepth = loadEngineSetting(
        "chessprep_engine_depth",
        global.STOCKFISH_DEFAULT_DEPTH,
        global.STOCKFISH_MIN_DEPTH,
        global.STOCKFISH_MAX_DEPTH,
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
      $("#explore-toggle").addEventListener("click", () => toggleExploreMode());
      $("#explore-undo").addEventListener("click", () => explore.undo());
      $("#explore-exit").addEventListener("click", () => exitExploreMode());
      $("#eval-curve").addEventListener("click", handleEvalCurveClick);
      ["analysis-depth", "analysis-lines"].forEach((id) => {
        const input = document.getElementById(id);
        input.addEventListener("change", () => {
          applyEngineSettingsFromInputs({
            restartGameAnalysis: id === "analysis-depth"
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
      if (!typing && (event.key === "e" || event.key === "E")) {
        event.preventDefault();
        toggleExploreMode();
      }
      if (event.key === "Escape" && explore.active) {
        event.preventDefault();
        exitExploreMode();
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
      depth: state.engineDepth,
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
    const opponent = game.player_color === "white" ? game.black : game.white;
    $("#viewer-title").textContent = `${game.target_player} — ${opponent}`;
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
    const last = (!explore.active && state.ply) ? game.moves_uci[state.ply - 1] : "";
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
      html +=
        `<span class="${classes}" data-square="${squareName}">${fileCoord}${rankCoord}${PIECES[piece] || ""}</span>`;
    }));
    $("#chessboard").innerHTML = html;
    if (explore.active) {
      $$(".board-square", $("#chessboard")).forEach((square) => {
        square.addEventListener("click", () => explore.handleSquareClick(square.dataset.square));
      });
    }
    $("#move-count").textContent = `${state.ply} / ${game.moves.length}`;
    if (explore.active) {
      $("#move-label").textContent = t("dynamic.exploreMode");
    } else {
      $("#move-label").textContent = state.ply ? t("dynamic.afterMove", {
        move: game.moves[state.ply - 1]
      }) : t("viewer.initial");
    }
    renderBoardArrow();
    renderEvalBar();
  }

  function setPly(value) {
    if (!state.viewerGame) return;
    if (explore.active) exitExploreMode();
    state.ply = Math.max(0, Math.min(value, state.viewerGame.moves.length));
    state.selectedLine = 1;
    renderBoard();
    renderMoves();
    renderAnalysisSummary();
    drawEvalCurve();
    if (state.analysisEnabled) probeLiveLines();
  }

  function handleViewerControl(action) {
    if (!state.viewerGame) return;
    if (explore.active && action !== "play") exitExploreMode();
    if (action !== "play" && state.playTimer) stopPlaying();
    if (action === "first") setPly(0);
    if (action === "prev") setPly(state.ply - 1);
    if (action === "next") setPly(state.ply + 1);
    if (action === "last") setPly(state.viewerGame.moves.length);
    if (action === "play") {
      if (explore.active) exitExploreMode();
      state.playTimer ? stopPlaying() : startPlaying();
    }
  }

  function startPlaying() {
    if (state.ply >= state.viewerGame.moves.length) setPly(0);
    $("[data-move='play']").textContent = "Ⅱ";
    state.playTimer = setInterval(() => {
      if (state.ply >= state.viewerGame.moves.length) return stopPlaying();
      setPly(state.ply + 1);
    }, 700);
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

  function syncEngineSettingInputs() {
    const depthInput = $("#analysis-depth");
    const linesInput = $("#analysis-lines");
    if (depthInput) depthInput.value = String(state.engineDepth);
    if (linesInput) linesInput.value = String(state.engineLines);
  }

  function renderAnalysisUi() {
    const enabled = state.analysisEnabled;
    const body = $("#analysis-body");
    const exploreBtn = $("#explore-toggle");
    const evalBar = $("#eval-bar");
    if (body) body.hidden = !enabled;
    if (exploreBtn) exploreBtn.hidden = !enabled;
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
        depth: state.engineDepth,
        count: state.engineLines,
        lines: t(state.engineLines === 1 ? "dynamic.line" : "dynamic.lines")
      });
      return;
    }
    el.textContent = t("dynamic.engineAnalysing", {
      done: analysis.done,
      total: analysis.total,
      depth: state.engineDepth
    });
  }

  function currentPlyEval() {
    if (explore.active && explore.lastTry?.status === "done") return explore.lastTry.score;
    return state.analysis?.evals?.[state.ply] || null;
  }

  function currentMoveJudgment() {
    if (explore.active && explore.lastTry) return explore.lastTry;
    if (!state.ply || !state.analysis?.plies) return null;
    return state.analysis.plies[state.ply - 1] || null;
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
    if (explore.active) {
      if (explore.lastTry?.status === "analyzing") moveLine = t("analysis.evaluatingMove");
      else if (explore.lastTry?.status === "done") {
        moveLine =
          `${t("analysis.yourMove")} <strong>${escapeHtml(explore.lastTry.san)}</strong>${explore.lastTry.glyph ? ` <span class="judgment ${escapeHtml(explore.lastTry.judgment)}">${escapeHtml(explore.lastTry.glyph)}</span>` : ""} · ${t("quality.best")} <strong>${escapeHtml(explore.lastTry.bestSan || "—")}</strong> · Δ ${explore.lastTry.cpl} cp · <span class="judgment ${escapeHtml(explore.lastTry.judgment)}">${escapeHtml(t(`quality.${explore.lastTry.judgment}`))}</span>`;
      } else if (explore.lastTry?.status === "error") {
        moveLine = escapeHtml(explore.lastTry.error || t("analysis.evaluateError"));
      } else {
        moveLine = t("analysis.chooseMove");
      }
    } else if (judgment) {
      moveLine =
        `${t("analysis.move")} <strong>${escapeHtml(judgment.san)}</strong>${judgment.glyph ? ` <span class="judgment ${escapeHtml(judgment.judgment)}">${escapeHtml(judgment.glyph)}</span>` : ""} · ${t("quality.best")} <strong>${escapeHtml(judgment.bestSan || "—")}</strong> · Δ ${judgment.cpl} cp · <span class="judgment ${escapeHtml(judgment.judgment)}">${escapeHtml(t(`quality.${judgment.judgment}`))}</span>`;
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

  function renderLiveLines() {
    const el = $("#analysis-lines-list");
    if (!el) return;
    if (!state.analysisEnabled) {
      el.innerHTML = "";
      return;
    }
    if (!state.liveLines.length) {
      el.innerHTML =
        `<div class="analysis-line-empty">${escapeHtml(t("dynamic.calculatingLines", { count: state.engineLines, lines: t(state.engineLines === 1 ? "dynamic.line" : "dynamic.lines"), depth: state.engineDepth }))}</div>`;
      return;
    }
    const side = (explore.active ? explore.fen() : state.viewerGame?.fens[state.ply] || "").split(" ")[1] || "w";
    el.innerHTML = state.liveLines.map((line) => {
      const whiteScore = toWhitePov(line.score, side);
      const evalText = MoveQuality.formatEval(whiteScore);
      const pvText = (line.sanPv?.length ? line.sanPv : line.pv).slice(0, 10).join(" ");
      const active = line.multipv === state.selectedLine ? "active" : "";
      return `<button type="button" class="analysis-line ${active}" data-multipv="${line.multipv}">` +
        `<span class="line-rank">${line.multipv}</span>` +
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
    if (!state.analysisEnabled || !state.viewerGame || explore.active) return;
    const probeId = ++state.liveProbeId;
    const fen = state.viewerGame.fens[state.ply];
    const depth = state.engineDepth;
    const multipv = state.engineLines;
    state.liveLines = [];
    renderLiveLines();
    try {
      await loadChessScript();
      const result = await engine.analyzeFen(fen, {
        depth,
        multipv
      });
      if (probeId !== state.liveProbeId || !state.analysisEnabled) return;
      state.liveLines = (result.lines || []).map((line) => ({
        ...line,
        sanPv: pvToSan(fen, line.pv),
        moveUci: line.pv?.[0] || "",
      }));
      if (!state.liveLines.some((line) => line.multipv === state.selectedLine)) {
        state.selectedLine = state.liveLines[0]?.multipv || 1;
      }
      renderLiveLines();
      renderBoardArrow();
      // Prefer live eval for the current position bar when available.
      if (state.liveLines[0]?.score) {
        const side = fen.split(" ")[1] || "w";
        if (state.analysis?.evals) {
          state.analysis.evals[state.ply] = toWhitePov(state.liveLines[0].score, side);
          renderEvalBar();
          renderAnalysisSummary();
        }
      }
    } catch (error) {
      if (probeId !== state.liveProbeId) return;
      if (error.message === "Análisis cancelado" || error.message === "Motor detenido") return;
      const el = $("#analysis-lines-list");
      if (el) el.innerHTML =
        `<div class="analysis-line-empty">${escapeHtml(error.message || t("dynamic.linesError"))}</div>`;
    }
  }

  function renderBoardArrow() {
    const svg = $("#board-arrows");
    if (!svg) return;
    if (!state.analysisEnabled || !state.viewerGame) {
      svg.innerHTML = "";
      return;
    }
    let uci = "";
    if (explore.active && explore.lastTry?.bestUci) uci = explore.lastTry.bestUci;
    else {
      const live = selectedLiveLine();
      if (live?.moveUci) uci = live.moveUci;
      else if (state.ply > 0) uci = state.analysis?.plies?.[state.ply - 1]?.bestUci || "";
      else uci = state.analysis?.plies?.[0]?.bestUci || "";
    }
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
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#f6f3ec";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#dcd8cd";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

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

    ctx.strokeStyle = "#1c3932";
    ctx.lineWidth = 1.5;
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

  async function setAnalysisEnabled(enabled) {
    state.analysisEnabled = enabled;
    $("#analysis-toggle").checked = enabled;
    if (!enabled) {
      state.liveProbeId += 1;
      gameAnalysis.stop();
      if (explore.active) exitExploreMode();
      state.liveLines = [];
      renderAnalysisUi();
      renderMoves();
      renderBoard();
      return;
    }
    if (!state.viewerGame) return;
    renderAnalysisUi();
    try {
      // Always start from a clean worker; some WASM builds can wedge mid-session.
      engine.terminate();
      probeLiveLines();
      await gameAnalysis.start(state.viewerGame, {
        depth: state.engineDepth,
        onUpdate: (analysis) => {
          if (!state.analysisEnabled || !state.viewerGame) return;
          if (analysis.key !== `${state.viewerGame.source}:${state.viewerGame.id}:d${state.engineDepth}`)
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
      });
    } catch (error) {
      engine.terminate();
      state.analysisEnabled = false;
      $("#analysis-toggle").checked = false;
      renderAnalysisUi();
      toast(t("toast.engineUnavailable"), error.message || String(error), "error");
    }
  }

  async function applyEngineSettingsFromInputs({
    restartGameAnalysis = false
  } = {}) {
    const nextDepth = clampEngineSetting(
      $("#analysis-depth")?.value,
      STOCKFISH_MIN_DEPTH,
      STOCKFISH_MAX_DEPTH,
    );
    const nextLines = clampEngineSetting(
      $("#analysis-lines")?.value,
      STOCKFISH_MIN_LINES,
      STOCKFISH_MAX_LINES,
    );
    const depthChanged = nextDepth !== state.engineDepth;
    const linesChanged = nextLines !== state.engineLines;
    state.engineDepth = nextDepth;
    state.engineLines = nextLines;
    saveEngineSetting("chessprep_engine_depth", nextDepth);
    saveEngineSetting("chessprep_engine_lines", nextLines);
    syncEngineSettingInputs();

    if (!state.analysisEnabled || !state.viewerGame) return;
    if (depthChanged && restartGameAnalysis) {
      gameAnalysis.stop();
      state.analysis = null;
      engine.terminate();
      setAnalysisEnabled(true);
      return;
    }
    if (depthChanged || linesChanged) {
      state.selectedLine = 1;
      probeLiveLines();
    }
  }

  function renderExploreBar() {
    const bar = $("#explore-bar");
    const feedback = $("#explore-feedback");
    const undo = $("#explore-undo");
    const toggle = $("#explore-toggle");
    if (!bar || !feedback || !undo || !toggle) return;
    bar.hidden = !explore.active;
    toggle.classList.toggle("active", explore.active);
    toggle.textContent = explore.active ? t("dynamic.exploring") : t("viewer.explore");
    undo.disabled = !explore.canUndo();
    if (!explore.active) {
      feedback.textContent = "";
      return;
    }
    if (explore.lastTry?.status === "analyzing") feedback.innerHTML = t("dynamic.evaluating");
    else if (explore.lastTry?.status === "done") {
      feedback.innerHTML =
        `<strong>${escapeHtml(explore.lastTry.san)}</strong> ${escapeHtml(t(`quality.${explore.lastTry.judgment}`))} · ${t("dynamic.optimal")} <strong>${escapeHtml(explore.lastTry.bestSan || "—")}</strong>`;
    } else if (explore.lastTry?.status === "error") {
      feedback.textContent = explore.lastTry.error || t("dynamic.engineError");
    } else {
      feedback.textContent = t("dynamic.clickPiece");
    }
  }

  async function enterExploreMode() {
    if (!state.viewerGame || !state.analysisEnabled) return;
    if (state.playTimer) stopPlaying();
    state.liveProbeId += 1;
    try {
      await explore.enter(state.viewerGame.fens[state.ply], state.ply, {
        getSettings: getEngineSettings,
        onChange: () => {
          renderBoard();
          renderExploreBar();
          renderAnalysisSummary();
          renderBoardArrow();
          renderEvalBar();
        },
      });
      renderBoard();
      renderExploreBar();
      renderAnalysisSummary();
      renderLiveLines();
    } catch (error) {
      toast(t("toast.exploreError"), error.message || String(error), "error");
    }
  }

  function exitExploreMode() {
    if (!explore.active) return;
    explore.exit();
    renderBoard();
    renderExploreBar();
    renderAnalysisSummary();
    renderBoardArrow();
    renderEvalBar();
    if (state.analysisEnabled) probeLiveLines();
  }

  async function toggleExploreMode() {
    if (!state.analysisEnabled) {
      await setAnalysisEnabled(true);
    }
    if (explore.active) exitExploreMode();
    else await enterExploreMode();
  }

  global.GameViewerController = GameViewerController;
})(window);
