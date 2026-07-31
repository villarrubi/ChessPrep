"use strict";

const API = "/api/v1";
const state = {
  player: null,
  stats: null,
  games: [],
  pace: "global",
  source: "all",
  openingColor: "all",
  selectedEco: null,
  viewerGame: null,
  ply: 0,
  playTimer: null,
  pgnText: "",
  datasetId: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

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

function shortRange(range) {
  if (!range?.from || !range?.to) return "Sin fechas";
  const formatter = new Intl.DateTimeFormat("es-ES", { month: "short", year: "numeric" });
  const from = formatter.format(new Date(`${range.from}T12:00:00`));
  const to = formatter.format(new Date(`${range.to}T12:00:00`));
  return from === to ? from : `${from} — ${to}`;
}

function sourceLabel(source) {
  return ({ lichess: "Lichess", "chess.com": "Chess.com", combined: "Lichess + Chess.com", pgn_import: "PGN OTB", demo: "Muestra", upload: "PGN OTB" })[source] || source;
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

function setLoading(visible, text = "Preparando el tablero…") {
  $("#loading-text").textContent = text;
  $("#loading-layer").hidden = !visible;
}

function toast(title, message = "", type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 4200);
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
    state.selectedEco = null;
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
      if (combined.warnings.length) toast("Dossier creado con avisos", combined.warnings.join(" "));
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
    state.selectedEco = null;
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
  $("#openings-body").innerHTML = rows.slice(0, 8).map((item) => `
    <tr data-eco="${escapeHtml(item.eco)}" tabindex="0" aria-label="Filtrar partidas por ${escapeHtml(item.opening)}">
      <td class="opening-cell"><strong>${escapeHtml(item.opening)}</strong><span>${escapeHtml(item.eco)} · ${formatNumber(item.share_pct)}% de la muestra</span></td>
      <td><span class="color-pill ${item.color}"><i></i>${item.color === "white" ? "Blancas" : "Negras"}</span></td>
      <td><strong>${item.games}</strong></td>
      <td class="score-cell">${formatNumber(item.score_pct)}%</td>
      <td class="row-arrow">→</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No hay aperturas para este color.</td></tr>`;
  $$("#openings-body tr[data-eco]").forEach((row) => {
    const select = () => selectOpening(row.dataset.eco);
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
  $("#sample-note").querySelector("p").innerHTML = `<strong>${state.stats.sample_size} partidas · ritmo ${paceLabel(state.pace).toLowerCase()}</strong> ${shortRange(state.stats.date_range)}. ${state.stats.sources.map(sourceLabel).join(" + ")}.`;
}

function selectedGames() {
  const text = $("#game-search").value.trim().casefold?.() || $("#game-search").value.trim().toLocaleLowerCase();
  const color = $("#filter-color").value;
  const result = $("#filter-result").value;
  return state.games.filter((game) => {
    const haystack = `${game.white} ${game.black} ${game.event || ""} ${game.opening} ${game.eco || ""}`.toLocaleLowerCase();
    return (!text || haystack.includes(text)) &&
      (color === "all" || game.player_color === color) &&
      (result === "all" || outcome(game) === result) &&
      (!state.selectedEco || game.eco === state.selectedEco);
  });
}

function renderGames() {
  const games = selectedGames();
  $("#games-count").textContent = `${games.length} ${games.length === 1 ? "partida encontrada" : "partidas encontradas"}`;
  $("#games-list").hidden = games.length === 0;
  $("#games-empty").hidden = games.length > 0;
  $("#games-list").innerHTML = games.map((game) => {
    const result = outcome(game);
    const opponent = game.player_color === "white" ? game.black : game.white;
    const opponentElo = game.player_color === "white" ? game.black_elo : game.white_elo;
    return `
      <article class="game-row">
        <div class="game-players">
          <span class="game-result ${result}" title="${outcomeLabel(result)}">${({win:"V",draw:"T",loss:"D"})[result]}</span>
          <div><strong>${escapeHtml(opponent)}</strong><span>${game.player_color === "white" ? "♙ Blancas" : "♟ Negras"}${opponentElo ? ` · Rival ${opponentElo}` : ""} · ${escapeHtml(game.result)}</span></div>
        </div>
        <div class="game-detail game-opening"><span>Apertura</span><strong>${escapeHtml(game.eco || "—")} · ${escapeHtml(game.opening)}</strong></div>
        <div class="game-detail game-event"><span>Evento</span><strong>${escapeHtml(game.event || "Partida importada")}</strong></div>
        <div class="game-detail game-mode"><span>Ritmo</span><strong>${paceLabel(game.time_class)} · ${shortDate(game.date)}</strong></div>
        <button class="game-open" type="button" data-game-source="${escapeHtml(game.source)}" data-game-id="${escapeHtml(game.id)}" aria-label="Abrir partida contra ${escapeHtml(opponent)}">→</button>
      </article>`;
  }).join("");
  $$(".game-open").forEach((button) => button.addEventListener("click", () => openGame(button.dataset.gameSource, button.dataset.gameId)));
  const active = $("#active-filter");
  active.hidden = !state.selectedEco;
  if (state.selectedEco) active.innerHTML = `Apertura activa: <strong>${escapeHtml(state.selectedEco)}</strong><button type="button" aria-label="Quitar filtro de apertura">× Quitar</button>`;
  active.querySelector("button")?.addEventListener("click", () => { state.selectedEco = null; renderGames(); });
}

function selectOpening(eco) {
  state.selectedEco = eco;
  renderGames();
  $("#partidas").scrollIntoView({ behavior: "smooth", block: "start" });
  toast("Filtro aplicado", `Mostrando las partidas de la apertura ${eco}.`);
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
    state.viewerGame = await api(`/games/${encodeURIComponent(source)}/${encodeURIComponent(gameId)}`);
    state.ply = 0;
    renderViewerMeta();
    renderMoves();
    renderBoard();
    openDialog("viewer-dialog");
  } catch (error) { toast("No se pudo abrir la partida", error.message, "error"); }
  finally { setLoading(false); }
}

function renderViewerMeta() {
  const game = state.viewerGame;
  const opponent = game.player_color === "white" ? game.black : game.white;
  $("#viewer-title").textContent = `${game.target_player} — ${opponent}`;
  $("#viewer-tags").innerHTML = [game.eco, game.opening, game.result, game.game_type.toUpperCase(), shortDate(game.date)]
    .filter(Boolean).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const white = `${escapeHtml(game.white)}${game.white_elo ? ` <span>${game.white_elo}</span>` : ""}`;
  const black = `${escapeHtml(game.black)}${game.black_elo ? ` <span>${game.black_elo}</span>` : ""}`;
  if (game.player_color === "black") {
    $("#board-player-top").innerHTML = `♙ ${white}`;
    $("#board-player-bottom").innerHTML = `♟ ${black}`;
  } else {
    $("#board-player-top").innerHTML = `♟ ${black}`;
    $("#board-player-bottom").innerHTML = `♙ ${white}`;
  }
  $("#viewer-source").innerHTML = `<strong>Fuente: ${sourceLabel(game.source)}</strong><br>${escapeHtml(game.event || "Evento sin especificar")} · ${escapeHtml(game.site || "sin enlace externo")} · confianza ${escapeHtml(game.source_confidence)}.`;
}

function renderMoves() {
  const game = state.viewerGame;
  let html = "";
  for (let index = 0; index < game.moves.length; index += 2) {
    html += `<span class="move-number">${index / 2 + 1}.</span>`;
    html += `<button class="move ${state.ply === index + 1 ? "active" : ""}" data-ply="${index + 1}">${escapeHtml(game.moves[index])}</button>`;
    html += game.moves[index + 1]
      ? `<button class="move ${state.ply === index + 2 ? "active" : ""}" data-ply="${index + 2}">${escapeHtml(game.moves[index + 1])}</button>`
      : `<span></span>`;
  }
  $("#moves-list").innerHTML = html;
  $$(".move", $("#moves-list")).forEach((button) => button.addEventListener("click", () => setPly(Number(button.dataset.ply))));
  const active = $(".move.active", $("#moves-list"));
  active?.scrollIntoView({ block: "nearest" });
}

function renderBoard() {
  const game = state.viewerGame;
  if (!game) return;
  const position = parseFen(game.fens[state.ply]);
  const blackPerspective = game.player_color === "black";
  const ranks = blackPerspective ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const files = blackPerspective ? ["h","g","f","e","d","c","b","a"] : ["a","b","c","d","e","f","g","h"];
  const rows = blackPerspective ? [...position].reverse() : position;
  const ordered = rows.map((row) => blackPerspective ? [...row].reverse() : row);
  const last = state.ply ? game.moves_uci[state.ply - 1] : "";
  const highlighted = last ? [last.slice(0, 2), last.slice(2, 4)] : [];
  let html = "";
  ordered.forEach((row, rowIndex) => row.forEach((piece, colIndex) => {
    const squareName = `${files[colIndex]}${ranks[rowIndex]}`;
    const dark = (rowIndex + colIndex) % 2 === 1;
    const fileCoord = rowIndex === 7 ? `<span class="coord file">${files[colIndex]}</span>` : "";
    const rankCoord = colIndex === 0 ? `<span class="coord rank">${ranks[rowIndex]}</span>` : "";
    html += `<span class="board-square ${dark ? "dark" : ""} ${highlighted.includes(squareName) ? "last-move" : ""}" data-square="${squareName}">${fileCoord}${rankCoord}${PIECES[piece] || ""}</span>`;
  }));
  $("#chessboard").innerHTML = html;
  $("#move-count").textContent = `${state.ply} / ${game.moves.length}`;
  $("#move-label").textContent = state.ply ? `Después de ${game.moves[state.ply - 1]}` : "Posición inicial";
}

function setPly(value) {
  if (!state.viewerGame) return;
  state.ply = Math.max(0, Math.min(value, state.viewerGame.moves.length));
  renderBoard();
  renderMoves();
}

function handleViewerControl(action) {
  if (!state.viewerGame) return;
  if (action !== "play" && state.playTimer) stopPlaying();
  if (action === "first") setPly(0);
  if (action === "prev") setPly(state.ply - 1);
  if (action === "next") setPly(state.ply + 1);
  if (action === "last") setPly(state.viewerGame.moves.length);
  if (action === "play") state.playTimer ? stopPlaying() : startPlaying();
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

function openDialog(id) {
  const dialog = document.getElementById(id);
  dialog.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $(".dialog-close", dialog)?.focus(), 10);
}

function closeDialog(id) {
  document.getElementById(id).hidden = true;
  document.body.style.overflow = "";
  if (id === "viewer-dialog") stopPlaying();
}

async function readPgnFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pgn") && file.type !== "text/plain") {
    toast("Archivo no compatible", "Selecciona un archivo con extensión .pgn.", "error");
    return;
  }
  state.pgnText = await file.text();
  $("#selected-file").hidden = false;
  $("#selected-file").textContent = `✓ ${file.name} · ${(file.size / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} KB`;
  $("#submit-import").disabled = state.pgnText.trim().length < 8;
}

async function submitImport() {
  if (!state.pgnText) return;
  const target = $("#target-player").value.trim();
  closeDialog("import-dialog");
  setLoading(true, "Validando y ordenando las partidas…");
  try {
    const result = await api("/datasets", {
      method: "POST",
      body: JSON.stringify({
        pgn: state.pgnText,
        target_player: target || null,
        game_type: "otb",
        merge_with_dataset_id: state.datasetId,
      }),
    });
    state.pace = "global";
    $$("[data-pace]").forEach((button) => button.classList.toggle("active", button.dataset.pace === "global"));
    await loadPlayer(result.dataset.player, { scroll: true });
    const duplicateNote = result.duplicates ? ` · ${result.duplicates} duplicadas omitidas` : "";
    toast("PGN procesado", `${result.merged_games} partidas OTB añadidas · ${result.dataset.games.length} en el dossier${duplicateNote}.`);
    state.pgnText = "";
    $("#pgn-file").value = "";
    $("#selected-file").hidden = true;
    $("#submit-import").disabled = true;
  } catch (error) {
    setLoading(false);
    toast("No se pudo procesar el PGN", error.message, "error");
  }
}

function openImportDialog() {
  if (state.player && !$("#target-player").value.trim()) {
    $("#target-player").value = state.player.display_name;
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
    if (result.warnings.length) toast("Avisos de las fuentes", result.warnings.join(" "));
  } catch (error) {
    setLoading(false);
    toast("No se pudieron combinar los perfiles", error.message, "error");
  }
}

function bindEvents() {
  $("#player-search").addEventListener("submit", searchPlayer);
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
    $("#game-search").value = ""; $("#filter-color").value = "all"; $("#filter-result").value = "all"; state.selectedEco = null; renderGames();
  });
  ["open-import", "open-import-bottom"].forEach((id) => document.getElementById(id).addEventListener("click", openImportDialog));
  $("#open-combine").addEventListener("click", () => openDialog("combine-dialog"));
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.closeDialog)));
  $$(".dialog-backdrop").forEach((backdrop) => backdrop.addEventListener("mousedown", (event) => { if (event.target === backdrop) closeDialog(backdrop.id); }));
  $("#pgn-file").addEventListener("change", (event) => readPgnFile(event.target.files[0]));
  $("#submit-import").addEventListener("click", submitImport);
  $("#submit-combine").addEventListener("click", submitCombinedProfiles);
  const drop = $("#drop-zone");
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragging"); }));
  drop.addEventListener("drop", (event) => readPgnFile(event.dataTransfer.files[0]));
  $$("[data-move]").forEach((button) => button.addEventListener("click", () => handleViewerControl(button.dataset.move)));
  $("#menu-button").addEventListener("click", () => {
    const open = $(".main-nav").classList.toggle("open");
    $("#menu-button").setAttribute("aria-expanded", String(open));
  });
  $$(".main-nav a").forEach((link) => link.addEventListener("click", () => $(".main-nav").classList.remove("open")));
  document.addEventListener("keydown", (event) => {
    if (!$("#viewer-dialog").hidden) {
      if (event.key === "ArrowLeft") { event.preventDefault(); handleViewerControl("prev"); }
      if (event.key === "ArrowRight") { event.preventDefault(); handleViewerControl("next"); }
      if (event.key === "Home") { event.preventDefault(); handleViewerControl("first"); }
      if (event.key === "End") { event.preventDefault(); handleViewerControl("last"); }
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
