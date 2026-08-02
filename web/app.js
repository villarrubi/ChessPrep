"use strict";

const API = "/api/v1";
const MAX_PGN_BYTES = 5_000_000;
const state = {
  player: null,
  stats: null,
  games: [],
  pace: "global",
  source: "all",
  openingColor: "all",
  openingFilter: null,
  viewerGame: null,
  ply: 0,
  playTimer: null,
  pgnText: "",
  fideProfile: null,
  info64Results: null,
  datasetId: null,
  analysisEnabled: false,
  analysis: null,
  engineDepth: loadEngineSetting("chessprep_engine_depth", STOCKFISH_DEFAULT_DEPTH, STOCKFISH_MIN_DEPTH, STOCKFISH_MAX_DEPTH),
  engineLines: loadEngineSetting("chessprep_engine_lines", STOCKFISH_DEFAULT_LINES, STOCKFISH_MIN_LINES, STOCKFISH_MAX_LINES),
  liveLines: [],
  selectedLine: 1,
  liveProbeId: 0,
};

const engine = new StockfishEngine();
const gameAnalysis = new GameAnalysisController(engine);
const explore = new ExploreMode(engine);

function loadEngineSetting(key, fallback, min, max) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return clampEngineSetting(raw, min, max);
  } catch {
    return fallback;
  }
}

function saveEngineSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

function getEngineSettings() {
  return { depth: state.engineDepth, lines: state.engineLines };
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};
const LOADER_PIECES = ["♙", "♘", "♗", "♖", "♕", "♔"];
const LOADER_INTERVAL_MS = 450;
let loaderPieceIndex = 0;
let loaderTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value, decimals = 1) {
  return Number(value || 0).toLocaleString("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shortDate(date) {
  if (!date) return "Fecha desconocida";
  const parts = date.split("-");
  if (parts.length < 3) return date;
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${date}T12:00:00`));
}

function parseSpanishDate(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (!match) return null;
  const [, rawDay, rawMonth, rawYear] = match;
  const day = Number(rawDay);
  const month = Number(rawMonth);
  const year = Number(rawYear);
  if (year < 1900 || year > 2100) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function spanishDateFromIso(value) {
  const [year, month, day] = String(value || "").split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function isoFromLocalDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function readInfo64Date(id, label) {
  const field = document.getElementById(id);
  const raw = field.value.trim();
  if (!raw) {
    field.removeAttribute("aria-invalid");
    return null;
  }
  const parsed = parseSpanishDate(raw);
  if (!parsed) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
    toast(`Fecha ${label.toLowerCase()} no válida`, "Usa el formato dd/mm/aaaa; por ejemplo, 02/08/2026.", "error");
    return undefined;
  }
  field.removeAttribute("aria-invalid");
  field.value = spanishDateFromIso(parsed);
  return parsed;
}

function setInfo64Period(period) {
  const fromField = $("#info64-from");
  const toField = $("#info64-to");
  fromField.removeAttribute("aria-invalid");
  toField.removeAttribute("aria-invalid");
  if (period === "all") {
    fromField.value = "";
    toField.value = "";
  } else {
    const today = new Date();
    let start;
    if (period === "year") start = new Date(today.getFullYear(), 0, 1);
    else {
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      start.setFullYear(start.getFullYear() - (period === "3y" ? 3 : 1));
    }
    fromField.value = spanishDateFromIso(isoFromLocalDate(start));
    toField.value = spanishDateFromIso(isoFromLocalDate(today));
  }
  $$('[data-info64-period]').forEach((button) => button.classList.toggle("active", button.dataset.info64Period === period));
}

function shortRange(range) {
  if (!range?.from || !range?.to) return "Sin fechas";
  const formatter = new Intl.DateTimeFormat("es-ES", { month: "short", year: "numeric" });
  const from = formatter.format(new Date(`${range.from}T12:00:00`));
  const to = formatter.format(new Date(`${range.to}T12:00:00`));
  return from === to ? from : `${from} — ${to}`;
}

function sourceLabel(source) {
  return ({ lichess: "Lichess", "chess.com": "Chess.com", combined: "Fuentes combinadas", fide: "FIDE OTB", pgn_import: "PGN OTB", demo: "Muestra", upload: "PGN OTB" })[source] || source;
}

function paceLabel(pace) {
  return ({ global: "Global", blitz: "Blitz", rapid: "Rápida", classical: "Lenta", bullet: "Bullet" })[pace] || "Sin clasificar";
}

function countryLabel(country) {
  return ({ HU: "Hungría", ES: "España", US: "Estados Unidos", FR: "Francia", DE: "Alemania", GB: "Reino Unido" })[country] || country || "Fuente pública";
}

function initials(name) {
  return String(name || "Jugador").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function outcome(game) {
  if (game.result === "1/2-1/2") return "draw";
  const won = (game.player_color === "white" && game.result === "1-0") ||
    (game.player_color === "black" && game.result === "0-1");
  return won ? "win" : "loss";
}

function outcomeLabel(value) {
  return ({ win: "Victoria", draw: "Tablas", loss: "Derrota" })[value] || "Sin resultado";
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || `Error ${response.status}`);
  }
  return payload;
}

function advanceLoaderPiece() {
  const piece = $("#loader-piece");
  if (!piece) return;
  piece.textContent = LOADER_PIECES[loaderPieceIndex];
  loaderPieceIndex = (loaderPieceIndex + 1) % LOADER_PIECES.length;
  piece.classList.remove("sliding");
  void piece.offsetWidth;
  piece.classList.add("sliding");
}

function startLoaderPieces() {
  if (loaderTimer !== null) return;
  loaderPieceIndex = 0;
  advanceLoaderPiece();
  loaderTimer = window.setInterval(advanceLoaderPiece, LOADER_INTERVAL_MS);
}

function stopLoaderPieces() {
  if (loaderTimer === null) return;
  window.clearInterval(loaderTimer);
  loaderTimer = null;
}

function setLoading(visible, text = "Preparando el tablero…") {
  $("#loading-text").textContent = text;
  $("#loading-layer").hidden = !visible;
  if (visible) startLoaderPieces();
  else stopLoaderPieces();
}

function toast(title, message = "", type = "success", { persistent = false } = {}) {
  const node = document.createElement("div");
  const safeType = ["error", "warning"].includes(type) ? type : "success";
  node.className = `toast ${safeType}${persistent ? " persistent" : ""}`;
  node.setAttribute("role", safeType === "error" ? "alert" : "status");
  const copy = document.createElement("div");
  copy.className = "toast-copy";
  const heading = document.createElement("strong");
  heading.textContent = String(title ?? "");
  copy.append(heading, document.createTextNode(String(message ?? "")));
  node.append(copy);
  if (persistent) {
    const close = document.createElement("button");
    close.className = "toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Cerrar aviso");
    close.textContent = "×";
    close.addEventListener("click", () => node.remove());
    node.append(close);
  }
  $("#toast-region").append(node);
  if (!persistent) setTimeout(() => node.remove(), 4200);
}

function renderMiniBoard() {
  const board = $("#mini-board");
  const position = [
    "r", "", "b", "q", "", "r", "k", "",
    "p", "p", "", "n", "b", "p", "p", "p",
    "", "", "p", "p", "", "n", "", "",
    "", "", "", "", "p", "", "", "",
    "", "", "B", "P", "P", "", "", "",
    "", "", "N", "", "", "N", "", "",
    "P", "P", "P", "", "", "P", "P", "P",
    "R", "", "B", "Q", "", "R", "K", "",
  ];
  board.innerHTML = position.map((piece, index) =>
    `<span class="mini-square ${(Math.floor(index / 8) + index % 8) % 2 ? "dark" : ""}">${PIECES[piece] || ""}</span>`
  ).join("");
}

async function loadPlayer(player, { scroll = false } = {}) {
  setLoading(true, "Calculando el dossier del rival…");
  try {
    const [detail, stats, games] = await Promise.all([
      api(`/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}`),
      api(`/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/stats?mode=combined&pace=${state.pace}`),
      api(`/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/games?mode=combined&pace=${state.pace}&page_size=250`),
    ]);
    state.player = detail;
    state.stats = stats;
    state.games = games.items;
    state.datasetId = games.trace?.dataset_id || null;
    state.openingFilter = null;
    renderAll();
    if (scroll) $("#analisis").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast("No se pudo cargar el análisis", error.message, "error");
    throw error;
  } finally {
    setLoading(false);
  }
}

async function loadDemo(scroll = true) {
  try {
    const demo = await api("/demo");
    await loadPlayer(demo.player, { scroll });
  } catch (error) {
    toast("La muestra no está disponible", error.message, "error");
  }
}

async function searchPlayer(event) {
  event.preventDefault();
  const query = $("#player-query").value.trim();
  if (query.length < 2) {
    toast("Escribe un usuario", "Usa el nombre exacto de la cuenta en la plataforma elegida.", "error");
    return;
  }
  const selectedSource = state.source;
  const providerName = selectedSource === "all" ? "Lichess y Chess.com" : sourceLabel(selectedSource);
  setLoading(true, `Buscando al jugador en ${providerName}…`);
  try {
    let player;
    if (selectedSource === "all") {
      setLoading(true, "Combinando sus partidas de las dos plataformas…");
      const combined = await api("/players/combined?max_games=100", {
        method: "POST",
        body: JSON.stringify({ lichess_username: query, chesscom_username: query }),
      });
      player = combined.dataset.player;
      if (combined.warnings.length) {
        toast(
          "Dossier creado con avisos",
          combined.warnings.join(" "),
          "warning",
          { persistent: true },
        );
      }
    } else {
      const search = await api(`/players/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent(selectedSource)}`);
      if (!search.results.length) throw new Error(search.message || "No encontramos ese usuario exacto.");
      player = search.results.find((item) => item.source === selectedSource) || search.results[0];
      setLoading(true, `Recopilando sus partidas de ${sourceLabel(player.source)}…`);
      await api(`/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/refresh-games?max_games=100`, { method: "POST" });
    }
    await loadPlayer(player, { scroll: true });
    toast("Dossier actualizado", `${player.display_name}: ${state.games.length} partidas disponibles.`);
  } catch (error) {
    setLoading(false);
    toast("No se pudo completar la búsqueda", error.message, "error");
  }
}

function selectHeroSearchMode(mode) {
  if (!['online', 'otb'].includes(mode)) return;
  $$('[data-search-mode]').forEach((button) => {
    const active = button.dataset.searchMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#search-panel-online').hidden = mode !== 'online';
  $('#search-panel-otb').hidden = mode !== 'otb';
  setTimeout(() => (mode === 'otb' ? $('#hero-fide-id') : $('#player-query')).focus(), 0);
}

async function submitHeroOtbSearch(event) {
  event.preventDefault();
  const fideId = $('#hero-fide-id').value.trim();
  if (!/^\d{5,10}$/.test(fideId)) {
    toast('ID FIDE no válido', 'Escribe entre 5 y 10 cifras.', 'error');
    $('#hero-fide-id').focus();
    return;
  }
  $('#fide-id').value = fideId;
  resetFideProfile();
  openDialog('import-dialog');
  await verifyFidePlayer();
}

async function switchPace(pace) {
  if (!state.player || state.pace === pace) return;
  state.pace = pace;
  $$("[data-pace]").forEach((button) => button.classList.toggle("active", button.dataset.pace === pace));
  setLoading(true, `Filtrando ritmo ${paceLabel(pace).toLowerCase()}…`);
  try {
    const base = `/players/${encodeURIComponent(state.player.source)}/${encodeURIComponent(state.player.external_id)}`;
    const [stats, games] = await Promise.all([
      api(`${base}/stats?mode=combined&pace=${pace}`),
      api(`${base}/games?mode=combined&pace=${pace}&page_size=250`),
    ]);
    state.stats = stats;
    state.games = games.items;
    state.openingFilter = null;
    renderAll();
  } catch (error) {
    toast("No se pudo aplicar el ritmo", error.message, "error");
  } finally { setLoading(false); }
}

function renderAll() {
  renderPlayer();
  renderMetrics();
  renderOpenings();
  renderColors();
  renderGames();
}

function renderPlayer() {
  const player = state.player;
  const stats = state.stats;
  $("#player-avatar").textContent = initials(player.display_name);
  $("#player-name").textContent = player.display_name;
  $("#player-title").textContent = player.title || "PLAY";
  $("#player-meta").textContent = [player.rating, countryLabel(player.country), sourceLabel(player.source)].filter(Boolean).join(" · ");
  $("#trace-sample").textContent = `${stats.sample_size} ${stats.sample_size === 1 ? "partida" : "partidas"}`;
  $("#trace-range").textContent = shortRange(stats.date_range);
  $("#trace-sources").textContent = stats.sources.map(sourceLabel).join(" + ") || "Sin fuentes";
  $("#refresh-player").hidden = !["lichess", "chess.com"].includes(player.source);
}

function renderMetrics() {
  const stats = state.stats;
  const overall = stats.overall;
  $("#metric-score").innerHTML = `${formatNumber(overall.score_pct)}<small>%</small>`;
  $("#metric-record").textContent = `${overall.wins} victorias · ${overall.draws} tablas · ${overall.losses} derrotas`;
  $("#metric-score-bar").style.width = `${overall.score_pct}%`;
  const white = stats.by_color.find((row) => row.color === "white") || {};
  const black = stats.by_color.find((row) => row.color === "black") || {};
  renderColorMetric("white", white);
  renderColorMetric("black", black);
  const dots = $("#form-dots");
  dots.innerHTML = stats.recent_form.map((result) => {
    const letter = ({ win: "V", draw: "T", loss: "D" })[result.outcome] || "–";
    return `<span class="form-dot ${result.outcome}" title="${outcomeLabel(result.outcome)} ante ${escapeHtml(result.opponent)}">${letter}</span>`;
  }).join("");
  $("#recent-label").textContent = `Últimas ${stats.recent_form.length} partidas`;
  $("#metric-date").textContent = shortRange(stats.date_range);
}

function renderColorMetric(color, record) {
  $(`#metric-${color}`).innerHTML = `${formatNumber(record.score_pct || 0)}<small>%</small>`;
  $(`#metric-${color}-record`).textContent = `n = ${record.games || 0} ${(record.games || 0) === 1 ? "partida" : "partidas"}`;
  $(`#metric-${color}-form`).textContent = `${record.wins || 0}V · ${record.draws || 0}T · ${record.losses || 0}D`;
}

function renderOpenings() {
  const rows = state.stats.openings.filter((item) => state.openingColor === "all" || item.color === state.openingColor);
  const visibleRows = rows.slice(0, 8);
  $("#openings-body").innerHTML = visibleRows.map((item, index) => `
    <tr data-opening-index="${index}" tabindex="0" aria-label="Filtrar partidas por ${escapeHtml(item.opening)}">
      <td class="opening-cell"><strong>${escapeHtml(item.opening)}</strong><span>${escapeHtml(item.eco || "—")} · ${formatNumber(item.share_pct)}% de la muestra</span></td>
      <td><span class="color-pill ${item.color}"><i></i>${item.color === "white" ? "Blancas" : "Negras"}</span></td>
      <td><strong>${item.games}</strong></td>
      <td class="score-cell">${formatNumber(item.score_pct)}%</td>
      <td class="row-arrow">→</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No hay aperturas para este color.</td></tr>`;
  $$("#openings-body tr[data-opening-index]").forEach((row) => {
    const opening = visibleRows[Number(row.dataset.openingIndex)];
    const select = () => selectOpening(opening);
    row.addEventListener("click", select);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") select(); });
  });
}

function renderColors() {
  $("#color-breakdown").innerHTML = state.stats.by_color.map((row) => `
    <div class="color-row">
      <div class="color-row-head"><strong>${row.color === "white" ? "Con blancas" : "Con negras"}</strong><span>n = ${row.games} · score ${formatNumber(row.score_pct)}%</span></div>
      <div class="wdl-bar" aria-label="${row.win_pct}% victorias, ${row.draw_pct}% tablas, ${row.loss_pct}% derrotas">
        <i class="win" style="width:${row.win_pct}%"></i><i class="draw" style="width:${row.draw_pct}%"></i><i class="loss" style="width:${row.loss_pct}%"></i>
      </div>
      <div class="wdl-numbers"><span>${row.wins}V</span><span>${row.draws}T</span><span>${row.losses}D</span></div>
    </div>
  `).join("");
  $("#sample-note").querySelector("p").innerHTML = `<strong>${state.stats.sample_size} partidas · ritmo ${paceLabel(state.pace).toLowerCase()}</strong> ${escapeHtml(shortRange(state.stats.date_range))}. ${state.stats.sources.map((source) => escapeHtml(sourceLabel(source))).join(" + ")}.`;
}

function selectedGames() {
  const text = $("#game-search").value.trim().casefold?.() || $("#game-search").value.trim().toLocaleLowerCase();
  const color = $("#filter-color").value;
  const result = $("#filter-result").value;
  const openingFilter = state.openingFilter;
  return state.games.filter((game) => {
    const haystack = `${game.white} ${game.black} ${game.event || ""} ${game.opening} ${game.eco || ""}`.toLocaleLowerCase();
    const matchesOpening = !openingFilter || (
      game.eco === openingFilter.eco &&
      game.opening === openingFilter.opening &&
      game.player_color === openingFilter.color
    );
    return (!text || haystack.includes(text)) &&
      (color === "all" || game.player_color === color) &&
      (result === "all" || outcome(game) === result) &&
      matchesOpening;
  }).sort((left, right) => (right.date || "").localeCompare(left.date || ""));
}

function renderGames() {
  const games = selectedGames();
  $("#games-count").textContent = `${games.length} ${games.length === 1 ? "partida encontrada" : "partidas encontradas"}`;
  $("#games-list").hidden = games.length === 0;
  $("#games-empty").hidden = games.length > 0;
  $("#games-list").innerHTML = games.map((game) => {
    const result = outcome(game);
    const resultLetter = ({ win: "V", draw: "T", loss: "D" })[result] || "–";
    const opponent = game.player_color === "white" ? game.black : game.white;
    const opponentElo = game.player_color === "white" ? game.black_elo : game.white_elo;
    return `
      <article class="game-row">
        <div class="game-players">
          <span class="game-result ${result}" title="${outcomeLabel(result)}" aria-label="${outcomeLabel(result)}"><b aria-hidden="true">${resultLetter}</b></span>
          <div><strong>${escapeHtml(opponent)}</strong><span class="game-player-meta"><i class="game-color-icon ${game.player_color}" aria-hidden="true"></i>${game.player_color === "white" ? "Blancas" : "Negras"}${opponentElo ? ` · Rival ${opponentElo}` : ""} · ${escapeHtml(game.result)}</span></div>
        </div>
        <div class="game-detail game-opening"><span>Apertura</span><strong>${escapeHtml(game.eco || "—")} · ${escapeHtml(game.opening)}</strong></div>
        <div class="game-detail game-event"><span>Evento</span><strong>${escapeHtml(game.event || "Partida importada")}</strong></div>
        <div class="game-detail game-mode"><span>Ritmo</span><strong>${paceLabel(game.time_class)} · ${shortDate(game.date)}</strong></div>
        <button class="game-open" type="button" data-game-source="${escapeHtml(game.source)}" data-game-id="${escapeHtml(game.id)}" aria-label="Abrir partida contra ${escapeHtml(opponent)}">→</button>
      </article>`;
  }).join("");
  $$(".game-open").forEach((button) => button.addEventListener("click", () => openGame(button.dataset.gameSource, button.dataset.gameId)));
  const active = $("#active-filter");
  active.hidden = !state.openingFilter;
  if (state.openingFilter) {
    const filterLabel = `${state.openingFilter.eco || "Sin ECO"} · ${state.openingFilter.opening}`;
    active.innerHTML = `Apertura activa: <strong>${escapeHtml(filterLabel)}</strong><button type="button" aria-label="Quitar filtro de apertura">× Quitar</button>`;
  }
  active.querySelector("button")?.addEventListener("click", () => { state.openingFilter = null; renderGames(); });
}

function selectOpening(opening) {
  state.openingFilter = {
    eco: opening.eco || null,
    opening: opening.opening,
    color: opening.color,
  };
  renderGames();
  $("#partidas").scrollIntoView({ behavior: "smooth", block: "start" });
  const ecoLabel = opening.eco || "sin código ECO";
  toast("Filtro aplicado", `Mostrando ${opening.games} partidas de ${ecoLabel}.`);
}

async function refreshCurrentPlayer() {
  if (!["lichess", "chess.com"].includes(state.player?.source)) return;
  const button = $("#refresh-player");
  button.classList.add("spinning");
  try {
    await api(`/players/${encodeURIComponent(state.player.source)}/${encodeURIComponent(state.player.external_id)}/refresh-games?max_games=100`, { method: "POST" });
    await loadPlayer(state.player);
    toast("Partidas actualizadas", "El dossier se ha recalculado con la fuente pública.");
  } catch (error) { toast("No se pudo actualizar", error.message, "error"); }
  finally { button.classList.remove("spinning"); }
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

async function openGame(source, gameId) {
  setLoading(true, "Colocando las piezas…");
  try {
    resetViewerAnalysis({ keepToggle: false });
    state.viewerGame = await api(`/games/${encodeURIComponent(source)}/${encodeURIComponent(gameId)}`);
    state.ply = 0;
    renderViewerMeta();
    renderMoves();
    renderBoard();
    renderAnalysisUi();
    openDialog("viewer-dialog");
  } catch (error) { toast("No se pudo abrir la partida", error.message, "error"); }
  finally { setLoading(false); }
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
  sourceHeading.textContent = `Fuente: ${sourceLabel(game.source)}`;
  source.replaceChildren(
    sourceHeading,
    document.createElement("br"),
    document.createTextNode(`${game.event || "Evento sin especificar"} · ${game.site || "sin enlace externo"} · confianza ${game.source_confidence}.`),
  );
}

function moveGlyphHtml(ply) {
  const item = state.analysis?.plies?.[ply - 1];
  if (!item?.glyph) return "";
  return `<span class="move-glyph ${escapeHtml(item.judgment)}" title="${escapeHtml(item.label)} (${item.cpl} cp)">${escapeHtml(item.glyph)}</span>`;
}

function renderMoves() {
  const game = state.viewerGame;
  let html = "";
  for (let index = 0; index < game.moves.length; index += 2) {
    html += `<span class="move-number">${index / 2 + 1}.</span>`;
    html += `<button class="move ${state.ply === index + 1 ? "active" : ""}" data-ply="${index + 1}">${escapeHtml(game.moves[index])}${moveGlyphHtml(index + 1)}</button>`;
    html += game.moves[index + 1]
      ? `<button class="move ${state.ply === index + 2 ? "active" : ""}" data-ply="${index + 2}">${escapeHtml(game.moves[index + 1])}${moveGlyphHtml(index + 2)}</button>`
      : `<span></span>`;
  }
  $("#moves-list").innerHTML = html;
  $$(".move", $("#moves-list")).forEach((button) => button.addEventListener("click", () => setPly(Number(button.dataset.ply))));
  const active = $(".move.active", $("#moves-list"));
  active?.scrollIntoView({ block: "nearest" });
}

function currentBoardFen() {
  if (explore.active) return explore.fen();
  return state.viewerGame?.fens[state.ply] || "";
}

function renderBoard() {
  const game = state.viewerGame;
  if (!game) return;
  const fen = currentBoardFen();
  const position = parseFen(fen);
  const blackPerspective = game.player_color === "black";
  const ranks = blackPerspective ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const files = blackPerspective ? ["h","g","f","e","d","c","b","a"] : ["a","b","c","d","e","f","g","h"];
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
    html += `<span class="${classes}" data-square="${squareName}">${fileCoord}${rankCoord}${PIECES[piece] || ""}</span>`;
  }));
  $("#chessboard").innerHTML = html;
  if (explore.active) {
    $$(".board-square", $("#chessboard")).forEach((square) => {
      square.addEventListener("click", () => explore.handleSquareClick(square.dataset.square));
    });
  }
  $("#move-count").textContent = `${state.ply} / ${game.moves.length}`;
  if (explore.active) {
    $("#move-label").textContent = "Modo explorar";
  } else {
    $("#move-label").textContent = state.ply ? `Después de ${game.moves[state.ply - 1]}` : "Posición inicial";
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

function resetViewerAnalysis({ keepToggle = false } = {}) {
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
    el.textContent = "Preparando motor…";
    return;
  }
  if (analysis.status === "error") {
    el.textContent = analysis.error || "Error del motor";
    return;
  }
  if (analysis.status === "complete") {
    el.textContent = `Listo · d${state.engineDepth} · ${state.engineLines} línea${state.engineLines === 1 ? "" : "s"}`;
    return;
  }
  el.textContent = `Analizando ${analysis.done}/${analysis.total} · d${state.engineDepth}…`;
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
  if (state.analysis?.whiteAccuracy != null) accuracyParts.push(`Blancas ${formatNumber(state.analysis.whiteAccuracy)}%`);
  if (state.analysis?.blackAccuracy != null) accuracyParts.push(`Negras ${formatNumber(state.analysis.blackAccuracy)}%`);

  let moveLine = "Posición inicial";
  if (explore.active) {
    if (explore.lastTry?.status === "analyzing") moveLine = "Evaluando tu jugada…";
    else if (explore.lastTry?.status === "done") {
      moveLine = `Tu jugada <strong>${escapeHtml(explore.lastTry.san)}</strong>${explore.lastTry.glyph ? ` <span class="judgment ${escapeHtml(explore.lastTry.judgment)}">${escapeHtml(explore.lastTry.glyph)}</span>` : ""} · Óptima <strong>${escapeHtml(explore.lastTry.bestSan || "—")}</strong> · Δ ${explore.lastTry.cpl} cp · <span class="judgment ${escapeHtml(explore.lastTry.judgment)}">${escapeHtml(explore.lastTry.label)}</span>`;
    } else if (explore.lastTry?.status === "error") {
      moveLine = escapeHtml(explore.lastTry.error || "No se pudo evaluar");
    } else {
      moveLine = "Elige una pieza y una casilla destino";
    }
  } else if (judgment) {
    moveLine = `Jugada <strong>${escapeHtml(judgment.san)}</strong>${judgment.glyph ? ` <span class="judgment ${escapeHtml(judgment.judgment)}">${escapeHtml(judgment.glyph)}</span>` : ""} · Óptima <strong>${escapeHtml(judgment.bestSan || "—")}</strong> · Δ ${judgment.cpl} cp · <span class="judgment ${escapeHtml(judgment.judgment)}">${escapeHtml(judgment.label)}</span>`;
  } else if (state.ply > 0 && state.analysis && state.analysis.done < state.ply) {
    moveLine = "Esta jugada aún se está analizando…";
  }

  el.innerHTML = [
    `<div><strong>Eval</strong> ${escapeHtml(evalText)}${accuracyParts.length ? ` · Precisión ${accuracyParts.join(" · ")}` : ""}</div>`,
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
    `<button type="button" class="key-moment ${escapeHtml(moment.judgment)}" data-ply="${moment.ply}" title="${escapeHtml(moment.reason)}">` +
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
  const score = currentPlyEval() || { cp: 0 };
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
  return { x: x + 0.5, y: y + 0.5 };
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
    el.innerHTML = `<div class="analysis-line-empty">Calculando ${state.engineLines} línea${state.engineLines === 1 ? "" : "s"} a profundidad ${state.engineDepth}…</div>`;
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
    const result = await engine.analyzeFen(fen, { depth, multipv });
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
    if (el) el.innerHTML = `<div class="analysis-line-empty">${escapeHtml(error.message || "No se pudieron calcular las líneas")}</div>`;
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
    return { x, y, index };
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
        if (analysis.key !== `${state.viewerGame.source}:${state.viewerGame.id}:d${state.engineDepth}`) return;
        state.analysis = analysis;
        renderAnalysisStatus();
        renderAnalysisSummary();
        renderKeyMoments();
        drawEvalCurve();
        renderEvalBar();
        renderBoardArrow();
        renderMoves();
        if (analysis.status === "error") {
          toast("No se pudo analizar la partida", analysis.error || "Error del motor", "error");
        }
      },
    });
  } catch (error) {
    engine.terminate();
    state.analysisEnabled = false;
    $("#analysis-toggle").checked = false;
    renderAnalysisUi();
    toast("Motor no disponible", error.message || String(error), "error");
  }
}

async function applyEngineSettingsFromInputs({ restartGameAnalysis = false } = {}) {
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
  toggle.textContent = explore.active ? "Explorando" : "Explorar";
  undo.disabled = !explore.canUndo();
  if (!explore.active) {
    feedback.textContent = "";
    return;
  }
  if (explore.lastTry?.status === "analyzing") feedback.innerHTML = "Evaluando…";
  else if (explore.lastTry?.status === "done") {
    feedback.innerHTML = `<strong>${escapeHtml(explore.lastTry.san)}</strong> ${escapeHtml(explore.lastTry.label)} · óptima <strong>${escapeHtml(explore.lastTry.bestSan || "—")}</strong>`;
  } else if (explore.lastTry?.status === "error") {
    feedback.textContent = explore.lastTry.error || "Error";
  } else {
    feedback.textContent = "Haz clic en una pieza y luego en su destino";
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
    toast("No se pudo abrir el modo explorar", error.message || String(error), "error");
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

function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $(".dialog-close", dialog)?.focus(), 10);
}

function closeDialog(id) {
  document.getElementById(id).hidden = true;
  document.body.style.overflow = "";
  if (id === "viewer-dialog") {
    stopPlaying();
    resetViewerAnalysis({ keepToggle: false });
  }
}

async function readPgnFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pgn") && file.type !== "text/plain") {
    toast("Archivo no compatible", "Selecciona un archivo con extensión .pgn.", "error");
    return;
  }
  if (file.size > MAX_PGN_BYTES) {
    state.pgnText = "";
    $("#selected-file").hidden = true;
    updateImportReady();
    toast("Archivo demasiado grande", "El PGN no puede superar los 5 MB.", "error");
    return;
  }
  state.pgnText = await file.text();
  $("#selected-file").hidden = false;
  $("#selected-file").textContent = `✓ ${file.name} · ${(file.size / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} KB`;
  updateImportReady();
}

function updateImportReady() {
  const currentId = $("#fide-id").value.trim();
  $("#submit-import").disabled = !(
    state.pgnText.trim().length >= 8 &&
    state.fideProfile?.fide_id === currentId
  );
}

function safeInfo64Url(value, fallback = "https://info64.org/search-player") {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "info64.org" &&
      (!url.port || url.port === "443") && !url.username && !url.password
      ? url.href
      : fallback;
  } catch {
    return fallback;
  }
}

function resetInfo64Results() {
  state.info64Results = null;
  $("#info64-panel").hidden = true;
  $("#info64-results").hidden = true;
  $("#info64-summary").replaceChildren();
  $("#info64-list").replaceChildren();
  $("#info64-warnings").replaceChildren();
  $("#info64-opponent-filter").value = "";
  $("#info64-federation-filter").value = "all";
}

function resetFideProfile() {
  state.fideProfile = null;
  $("#fide-profile").hidden = true;
  resetInfo64Results();
  updateImportReady();
}

function normalizeInfo64Opponent(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

function filterInfo64Results(results) {
  const federation = $("#info64-federation-filter").value;
  const opponentQuery = normalizeInfo64Opponent($("#info64-opponent-filter").value);
  return results.filter((result) => {
    const matchesFederation = federation === "all" ||
      (federation === "federated" && Boolean(result.opponent_fide_id)) ||
      (federation === "non-federated" && !result.opponent_fide_id);
    const opponentText = normalizeInfo64Opponent(
      `${result.opponent_name} ${result.opponent_fide_id || ""}`
    );
    return matchesFederation && (!opponentQuery || opponentText.includes(opponentQuery));
  });
}

function summarizeInfo64Results(results) {
  const wins = results.filter((result) => result.outcome === "win").length;
  const draws = results.filter((result) => result.outcome === "draw").length;
  const losses = results.filter((result) => result.outcome === "loss").length;
  return {
    games: results.length,
    wins,
    draws,
    losses,
    score_percentage: results.length
      ? 100 * results.reduce((total, result) => total + Number(result.score || 0), 0) / results.length
      : 0,
    opponents: new Set(results.map((result) => result.opponent_fide_id || result.opponent_name.toLocaleLowerCase("es"))).size,
    tournaments: new Set(results.map((result) => result.tournament_url)).size,
  };
}

function renderInfo64Results(payload) {
  const results = filterInfo64Results(payload.results);
  const summary = summarizeInfo64Results(results);
  const opponentFilter = $("#info64-federation-filter").value;
  const opponentQuery = $("#info64-opponent-filter").value.trim();
  const filterLabels = [];
  if (opponentFilter !== "all") {
    filterLabels.push(({ federated: "federados", "non-federated": "no federados" })[opponentFilter]);
  }
  if (opponentQuery) filterLabels.push(`que coinciden con “${opponentQuery}”`);
  const filterDescription = filterLabels.length ? ` con el filtro ${filterLabels.join(" y ")}` : "";
  state.info64Results = payload;
  $("#info64-results").hidden = false;
  $("#info64-source-link").href = safeInfo64Url(payload.source_url);
  $("#info64-summary").innerHTML = [
    ["Resultados", summary.games],
    ["Puntuación", `${formatNumber(summary.score_percentage)}%`],
    ["Victorias", summary.wins],
    ["Tablas", summary.draws],
    ["Derrotas", summary.losses],
  ].map(([label, value]) => `<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
  $("#info64-match-note").textContent = payload.tournaments_scanned
    ? `${payload.tournaments_matched} de ${payload.tournaments_scanned} participaciones coincidieron exactamente con el ID FIDE ${payload.player.fide_id}. Se muestran ${results.length} resultados${filterDescription}.`
    : `Info64 no devolvió participaciones para ${payload.player.name} con este intervalo.`;

  const warnings = $("#info64-warnings");
  warnings.hidden = !payload.warnings.length;
  warnings.innerHTML = payload.warnings
    .map((warning) => `<p><span aria-hidden="true">!</span>${escapeHtml(warning)}</p>`)
    .join("");

  const list = $("#info64-list");
  const empty = $("#info64-empty");
  list.hidden = results.length === 0;
  empty.hidden = results.length > 0;
  $("#info64-empty p").textContent = opponentQuery
    ? `Ningún rival coincide con “${opponentQuery}” dentro de la muestra cargada.`
    : "Info64 puede no contener ese torneo o no asociar la participación a un ID FIDE.";
  list.innerHTML = results.map((result) => {
    const resultClass = ["win", "draw", "loss"].includes(result.outcome) ? result.outcome : "draw";
    const color = result.color === "white" ? "Blancas" : result.color === "black" ? "Negras" : "Color sin indicar";
    const round = [result.round ? `Ronda ${result.round}` : null, result.board ? `Mesa ${result.board}` : null].filter(Boolean).join(" · ");
    const dateLabel = result.date
      ? `${result.date_precision === "tournament" ? "≈ " : ""}${shortDate(result.date)}${result.time ? ` · ${result.time}` : ""}`
      : "Fecha desconocida";
    const rating = result.opponent_rating ? ` · ${result.opponent_rating}` : "";
    const fideLink = result.opponent_fide_id
      ? `<a class="info64-fide-link" href="https://ratings.fide.com/profile/${encodeURIComponent(result.opponent_fide_id)}" target="_blank" rel="noopener noreferrer">FIDE ${escapeHtml(result.opponent_fide_id)} ↗</a>`
      : "<span>Sin ID FIDE publicado</span>";
    const walkover = result.walkover ? " · incomparecencia" : "";
    return `<article class="info64-row">
      <div class="info64-outcome ${resultClass}"><strong>${escapeHtml(result.score)}</strong><span>${escapeHtml(outcomeLabel(result.outcome))}</span></div>
      <div class="info64-opponent"><span>Rival${rating}</span><strong>${escapeHtml(result.opponent_name)}</strong><div>${fideLink}</div></div>
      <div class="info64-tournament"><span>${escapeHtml(round || "Ronda sin indicar")}</span><a href="${escapeHtml(safeInfo64Url(result.player_url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.tournament)} ↗</a></div>
      <div class="info64-when"><span>${escapeHtml(color)}${escapeHtml(walkover)}</span><strong>${escapeHtml(dateLabel)}</strong></div>
    </article>`;
  }).join("");
  return summary;
}

async function searchInfo64Results() {
  const fideId = $("#fide-id").value.trim();
  if (!state.fideProfile || state.fideProfile.fide_id !== fideId) {
    toast("Verifica primero al jugador", "El ID FIDE debe corresponder a una ficha oficial.", "error");
    return;
  }
  const from = readInfo64Date("info64-from", "Desde");
  if (from === undefined) return;
  const to = readInfo64Date("info64-to", "Hasta");
  if (to === undefined) return;
  if (from && to && from > to) {
    toast("Intervalo no válido", "La fecha inicial no puede ser posterior a la fecha final.", "error");
    return;
  }
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const button = $("#search-info64");
  button.disabled = true;
  button.textContent = "Consultando Info64…";
  try {
    const query = params.toString();
    const suffix = query ? `?${query}` : "";
    const payload = await api(`/fide/players/${encodeURIComponent(fideId)}/info64-results${suffix}`);
    if (state.fideProfile?.fide_id !== fideId) return;
    const visibleSummary = renderInfo64Results(payload);
    const message = visibleSummary.games
      ? `${visibleSummary.games} resultados visibles de ${visibleSummary.tournaments} torneos.`
      : "No se encontraron resultados asociados exactamente a ese ID FIDE.";
    toast(visibleSummary.games ? "Resultados OTB encontrados" : "Sin resultados OTB", message);
  } catch (error) {
    toast("No se pudo consultar Info64", error.message, "error", { persistent: true });
  } finally {
    button.disabled = false;
    button.innerHTML = "Buscar en Info64 <span>→</span>";
  }
}

async function verifyFidePlayer() {
  const fideId = $("#fide-id").value.trim();
  if (!/^\d{5,10}$/.test(fideId)) {
    resetFideProfile();
    toast("ID FIDE no válido", "Escribe entre 5 y 10 cifras.", "error");
    return;
  }
  const button = $("#verify-fide");
  button.disabled = true;
  button.textContent = "Comprobando…";
  resetFideProfile();
  try {
    const player = await api(`/fide/players/${encodeURIComponent(fideId)}`);
    if ($("#fide-id").value.trim() !== fideId) return;
    state.fideProfile = player;
    $("#fide-profile-name").textContent = player.name;
    $("#fide-profile-meta").textContent = [player.title, player.federation, `ID ${player.fide_id}`].filter(Boolean).join(" · ");
    const ratings = [
      ["Lenta", player.standard_rating],
      ["Rápida", player.rapid_rating],
      ["Blitz", player.blitz_rating],
    ].filter(([, rating]) => rating);
    $("#fide-profile-ratings").innerHTML = ratings
      .map(([label, rating]) => `<span>${escapeHtml(label)} ${escapeHtml(rating)}</span>`)
      .join("");
    $("#fide-profile").hidden = false;
    $("#info64-panel").hidden = false;
    updateImportReady();
    toast("Jugador FIDE verificado", player.name);
  } catch (error) {
    resetFideProfile();
    toast("No se pudo verificar el ID FIDE", error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Buscar jugador";
  }
}

async function submitImport() {
  if (!state.pgnText || !state.fideProfile) return;
  closeDialog("import-dialog");
  setLoading(true, "Verificando identidad y ordenando las partidas…");
  try {
    const result = await api("/datasets", {
      method: "POST",
      body: JSON.stringify({
        pgn: state.pgnText,
        game_type: "otb",
        merge_with_dataset_id: state.datasetId,
        fide_id: state.fideProfile.fide_id,
      }),
    });
    state.pace = "global";
    $$("[data-pace]").forEach((button) => button.classList.toggle("active", button.dataset.pace === "global"));
    await loadPlayer(result.dataset.player, { scroll: true });
    const duplicateNote = result.duplicates ? ` · ${result.duplicates} duplicadas omitidas` : "";
    const rejectedNote = result.rejected_games ? ` · ${result.rejected_games} no pertenecían al jugador` : "";
    toast("PGN FIDE procesado", `${result.merged_games} partidas OTB añadidas · ${result.dataset.games.length} en el dossier${duplicateNote}${rejectedNote}.`);
    state.pgnText = "";
    state.fideProfile = null;
    state.info64Results = null;
    $("#pgn-file").value = "";
    $("#fide-id").value = "";
    $("#selected-file").hidden = true;
    $("#fide-profile").hidden = true;
    $("#info64-panel").hidden = true;
    $("#info64-results").hidden = true;
    $("#submit-import").disabled = true;
  } catch (error) {
    setLoading(false);
    toast("No se pudo procesar el PGN", error.message, "error");
  }
}

function openImportDialog() {
  if (state.player?.fide_id && !$("#fide-id").value.trim()) {
    $("#fide-id").value = state.player.fide_id;
    resetFideProfile();
  }
  openDialog("import-dialog");
}

async function submitCombinedProfiles() {
  const lichess = $("#combine-lichess").value.trim();
  const chesscom = $("#combine-chesscom").value.trim();
  if (!lichess && !chesscom) {
    toast("Faltan los usuarios", "Indica al menos un alias de Lichess o Chess.com.", "error");
    return;
  }
  closeDialog("combine-dialog");
  setLoading(true, "Uniendo los perfiles y deduplicando partidas…");
  try {
    const result = await api("/players/combined?max_games=100", {
      method: "POST",
      body: JSON.stringify({ lichess_username: lichess || null, chesscom_username: chesscom || null }),
    });
    state.pace = "global";
    $$("[data-pace]").forEach((button) => button.classList.toggle("active", button.dataset.pace === "global"));
    await loadPlayer(result.dataset.player, { scroll: true });
    const sources = result.dataset.sources.map(sourceLabel).join(" + ");
    toast("Dossier combinado", `${result.dataset.games.length} partidas de ${sources}.`);
    if (result.warnings.length) {
      toast(
        "Avisos de las fuentes",
        result.warnings.join(" "),
        "warning",
        { persistent: true },
      );
    }
  } catch (error) {
    setLoading(false);
    toast("No se pudieron combinar los perfiles", error.message, "error");
  }
}

function bindEvents() {
  $("#player-search").addEventListener("submit", searchPlayer);
  $("#hero-otb-search").addEventListener("submit", submitHeroOtbSearch);
  $$('[data-search-mode]').forEach((button) => button.addEventListener('click', () => selectHeroSearchMode(button.dataset.searchMode)));
  $("#load-demo").addEventListener("click", () => loadDemo(true));
  $("#refresh-player").addEventListener("click", refreshCurrentPlayer);
  $$("[data-pace]").forEach((button) => button.addEventListener("click", () => switchPace(button.dataset.pace)));
  $$("[data-source]").forEach((button) => button.addEventListener("click", () => {
    state.source = button.dataset.source;
    $$("[data-source]").forEach((item) => item.classList.toggle("active", item === button));
    $("#player-query").placeholder = state.source === "all"
      ? "Usuario común en ambas plataformas…"
      : `Usuario exacto de ${sourceLabel(state.source)}…`;
  }));
  $$("[data-opening-color]").forEach((button) => button.addEventListener("click", () => {
    state.openingColor = button.dataset.openingColor;
    $$("[data-opening-color]").forEach((item) => item.classList.toggle("active", item === button));
    renderOpenings();
  }));
  ["game-search", "filter-color", "filter-result"].forEach((id) => document.getElementById(id).addEventListener(id === "game-search" ? "input" : "change", renderGames));
  $("#clear-filters").addEventListener("click", () => {
    $("#game-search").value = ""; $("#filter-color").value = "all"; $("#filter-result").value = "all"; state.openingFilter = null; renderGames();
  });
  $("#open-import-bottom").addEventListener("click", () => {
    $("#manual-import").open = true;
    openImportDialog();
  });
  $("#open-combine").addEventListener("click", () => openDialog("combine-dialog"));
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
  $$(".dialog-backdrop").forEach((backdrop) => backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) closeDialog(backdrop.id); }));
  $("#pgn-file").addEventListener("change", (event) => readPgnFile(event.target.files[0]));
  $("#fide-id").addEventListener("input", resetFideProfile);
  $("#fide-id").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); verifyFidePlayer(); }
  });
  $("#verify-fide").addEventListener("click", verifyFidePlayer);
  $("#search-info64").addEventListener("click", searchInfo64Results);
  $("#info64-federation-filter").addEventListener("change", () => {
    if (state.info64Results) renderInfo64Results(state.info64Results);
  });
  $("#info64-opponent-filter").addEventListener("input", () => {
    if (state.info64Results) renderInfo64Results(state.info64Results);
  });
  $("#info64-clear-filters").addEventListener("click", () => {
    $("#info64-opponent-filter").value = "";
    $("#info64-federation-filter").value = "all";
    if (state.info64Results) renderInfo64Results(state.info64Results);
  });
  ["info64-from", "info64-to"].forEach((id) => {
    const field = document.getElementById(id);
    field.addEventListener("input", () => {
      field.removeAttribute("aria-invalid");
      $$('[data-info64-period]').forEach((button) => button.classList.remove("active"));
    });
    field.addEventListener("blur", () => {
      const parsed = parseSpanishDate(field.value);
      if (parsed) field.value = spanishDateFromIso(parsed);
    });
  });
  $$('[data-info64-period]').forEach((button) => button.addEventListener("click", () => setInfo64Period(button.dataset.info64Period)));
  $("#submit-import").addEventListener("click", submitImport);
  $("#submit-combine").addEventListener("click", submitCombinedProfiles);
  const drop = $("#drop-zone");
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", (event) => readPgnFile(event.dataTransfer.files[0]));
  $$("[data-move]").forEach((button) => button.addEventListener("click", () => handleViewerControl(button.dataset.move)));
  $("#analysis-toggle").addEventListener("change", (event) => setAnalysisEnabled(event.target.checked));
  $("#explore-toggle").addEventListener("click", () => toggleExploreMode());
  $("#explore-undo").addEventListener("click", () => explore.undo());
  $("#explore-exit").addEventListener("click", () => exitExploreMode());
  $("#eval-curve").addEventListener("click", handleEvalCurveClick);
  ["analysis-depth", "analysis-lines"].forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener("change", () => applyEngineSettingsFromInputs({ restartGameAnalysis: id === "analysis-depth" }));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });
  syncEngineSettingInputs();
  document.addEventListener("keydown", (event) => {
    if (!$("#viewer-dialog").hidden) {
      const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (event.key === "ArrowLeft") { event.preventDefault(); handleViewerControl("prev"); }
      if (event.key === "ArrowRight") { event.preventDefault(); handleViewerControl("next"); }
      if (event.key === "Home") { event.preventDefault(); handleViewerControl("first"); }
      if (event.key === "End") { event.preventDefault(); handleViewerControl("last"); }
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
        return;
      }
    }
    if (event.key === "Escape") {
      if (!$("#viewer-dialog").hidden) closeDialog("viewer-dialog");
      else if (!$("#import-dialog").hidden) closeDialog("import-dialog");
    }
  });
}

async function init() {
  renderMiniBoard();
  bindEvents();
  await loadDemo(false);
}

document.addEventListener("DOMContentLoaded", init);
