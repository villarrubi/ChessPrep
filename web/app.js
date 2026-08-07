"use strict";

// Application composition root: shared infrastructure is created here and
// injected into feature controllers. Feature-specific DOM logic lives in web/js.
const API = "/api/v1";
const i18n = window.ChessPrepI18n;
const t = (key, variables) => i18n?.t(key, variables) ?? key;
const currentLocale = () => i18n?.getLocale() || "es-ES";
const countLabel = (count, singularKey = "count.game", pluralKey = "count.games") =>
  t(Number(count) === 1 ? singularKey : pluralKey);
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
  eloGameResult: null,
  eloInitialResult: null,
  datasetId: null,
  analysisEnabled: false,
  analysis: null,
  engineNodes: null,
  engineLines: null,
  liveLines: [],
  selectedLine: 1,
  liveProbeId: 0,
};

let viewerController;
let dossierController;
let eloCalculator;
let otbController;
let pgnController;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const PIECES = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
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
  return Number(value || 0).toLocaleString(currentLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function shortDate(date) {
  if (!date) return t("date.unknown");
  const parts = date.split("-");
  if (parts.length < 3) return date;
  return new Intl.DateTimeFormat(currentLocale(), {
      day: "numeric",
      month: "short",
      year: "numeric"
    })
    .format(new Date(`${date}T12:00:00`));
}

function shortRange(range) {
  if (!range?.from || !range?.to) return t("date.none");
  const formatter = new Intl.DateTimeFormat(currentLocale(), {
    month: "short",
    year: "numeric"
  });
  const from = formatter.format(new Date(`${range.from}T12:00:00`));
  const to = formatter.format(new Date(`${range.to}T12:00:00`));
  return from === to ? from : `${from} — ${to}`;
}

function sourceLabel(source) {
  return ({
    lichess: "Lichess",
    "chess.com": "Chess.com",
    combined: t("source.combined"),
    fide: t("source.fide"),
    pgn_import: t("source.pgn"),
    demo: t("source.demo"),
    upload: t("source.pgn")
  })[source] || source;
}

function paceLabel(pace) {
  return ({
    global: t("pace.global"),
    blitz: t("pace.blitz"),
    rapid: t("pace.rapid"),
    classical: t("pace.classical"),
    bullet: t("pace.bullet")
  })[pace] || t("pace.unknown");
}

function countryLabel(country) {
  if (!country) return t("country.public");
  try {
    return new Intl.DisplayNames([currentLocale()], {
      type: "region"
    }).of(country) || country;
  } catch {
    return country;
  }
}

function initials(name) {
  return String(name || t("player.default")).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function outcome(game) {
  if (game.result === "1/2-1/2") return "draw";
  const won = (game.player_color === "white" && game.result === "1-0") ||
    (game.player_color === "black" && game.result === "0-1");
  return won ? "win" : "loss";
}

function outcomeLabel(value) {
  return ({
    win: t("outcome.win"),
    draw: t("outcome.draw"),
    loss: t("outcome.loss")
  })[value] || t("outcome.none");
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || `Error ${response.status}`);
  }
  return payload;
}

function asCombineDonePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.type === "done" && payload.dataset) return payload;
  // Non-streaming backends return the final body without NDJSON wrappers.
  if (payload.dataset) {
    return {
      type: "done",
      dataset: payload.dataset,
      warnings: payload.warnings || [],
      duplicates: payload.duplicates || 0,
    };
  }
  return null;
}

async function apiNdjson(path, options = {}, onEvent = () => {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson, application/json",
      ...(options.headers || {})
    },
    ...options,
  });
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(payload?.detail || payload?.message || `Error ${response.status}`);
  }
  if (!response.body) {
    throw new Error(t("toast.combineError"));
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json") && !contentType.includes("ndjson")) {
    const payload = await response.json();
    const done = asCombineDonePayload(payload);
    if (!done) throw new Error(payload?.detail || t("toast.combineError"));
    onEvent(done);
    return done;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;

  const consumeEvent = (event) => {
    if (!event || typeof event !== "object") return;
    onEvent(event);
    if (event.type === "error") {
      throw new Error(event.detail || t("toast.combineError"));
    }
    const done = asCombineDonePayload(event);
    if (done) finalPayload = done;
  };

  while (true) {
    const {
      done,
      value
    } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {
      stream: true
    });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      consumeEvent(JSON.parse(trimmed));
    }
  }

  if (buffer.trim()) {
    consumeEvent(JSON.parse(buffer.trim()));
  }

  if (!finalPayload) {
    throw new Error(t("toast.combineError"));
  }
  return finalPayload;
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

function progressFromSteps(steps) {
  if (!steps?.length) return 0;
  let score = 0;
  for (const step of steps) {
    if (step.status === "ready" || step.status === "error") score += 1;
    else if (step.status === "loading") score += 0.42;
  }
  return Math.min(96, Math.round((score / steps.length) * 100));
}

function setLoading(visible, text = t("loading.default"), steps = null, progress = null) {
  $("#loading-text").textContent = text;
  renderLoadingSteps(steps);
  renderLoadingProgress(visible ? (progress ?? (steps?.length ? progressFromSteps(steps) : null)) : null);
  $("#loading-layer").hidden = !visible;
  if (visible) startLoaderPieces();
  else {
    stopLoaderPieces();
    renderLoadingSteps(null);
    renderLoadingProgress(null);
  }
}

function renderLoadingProgress(progress) {
  const wrap = $("#loading-progress");
  const bar = $("#loading-progress-bar");
  if (!wrap || !bar) return;
  if (progress == null || Number.isNaN(progress)) {
    wrap.hidden = true;
    bar.style.width = "0%";
    return;
  }
  wrap.hidden = false;
  bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function renderLoadingSteps(steps) {
  const list = $("#loading-steps");
  if (!list) return;
  if (!steps?.length) {
    list.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.hidden = false;
  list.innerHTML = steps.map((step) => {
    const status = step.status || "pending";
    const mark = status === "ready" ? "✓" : status === "error" ? "!" : status === "loading" ? "" : "·";
    return `<li data-status="${escapeHtml(status)}"><span class="step-mark" aria-hidden="true">${mark}</span><span>${escapeHtml(step.label || "")}</span></li>`;
  }).join("");
}

function toast(title, message = "", type = "success", {
  persistent = false
} = {}) {
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
    close.setAttribute("aria-label", t("common.noticeClose"));
    close.textContent = "×";
    close.addEventListener("click", () => node.remove());
    node.append(close);
  }
  $("#toast-region").append(node);
  if (!persistent) setTimeout(() => node.remove(), 4200);
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
  if (id === "viewer-dialog") viewerController.close();
}

function refreshLocalizedInterface() {
  dossierController.refreshLanguage();
  pgnController.updateReady();
  eloCalculator.refreshLanguage();
  otbController.refreshLanguage();
  viewerController.refreshLanguage();
}

function closeLanguageMenu({
  restoreFocus = false
} = {}) {
  const menu = $("#language-menu");
  const button = $("#language-button");
  if (!menu || !button || menu.hidden) return;
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
  if (restoreFocus) button.focus();
}

function toggleLanguageMenu() {
  const menu = $("#language-menu");
  const button = $("#language-button");
  const open = menu.hidden;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
  if (open) $("[data-language].active", menu)?.focus();
}

function bindEvents() {
  eloCalculator.bindEvents();
  $("#language-button").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLanguageMenu();
  });
  $("#language-menu").addEventListener("click", (event) => event.stopPropagation());
  $$('[data-language]').forEach((button) => button.addEventListener("click", () => {
    i18n.setLanguage(button.dataset.language);
    closeLanguageMenu({
      restoreFocus: true
    });
  }));
  document.addEventListener("click", () => closeLanguageMenu());
  document.addEventListener("chessprep:languagechange", refreshLocalizedInterface);
  dossierController.bindEvents();
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset
    .closeDialog)));
  $$(".dialog-backdrop").forEach((backdrop) => backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeDialog(backdrop.id);
  }));
  otbController.bindEvents();
  pgnController.bindEvents();
  viewerController.bindEvents();
  document.addEventListener("keydown", (event) => {
    if (viewerController.handleKeydown(event)) return;
    if (event.key === "Escape") {
      if (!$("#language-menu").hidden) closeLanguageMenu({
        restoreFocus: true
      });
      else if (!$("#viewer-dialog").hidden) closeDialog("viewer-dialog");
      else if (!$("#import-dialog").hidden) closeDialog("import-dialog");
      else if (!$("#elo-dialog").hidden) closeDialog("elo-dialog");
      else if (!$("#combine-dialog").hidden) closeDialog("combine-dialog");
    }
  });
}

function init() {
  i18n.apply();
  viewerController = new GameViewerController({
    state,
    api,
    setLoading,
    toast,
    openDialog,
    t,
    formatNumber,
    shortDate,
    sourceLabel,
    escapeHtml,
    pieces: PIECES,
    $,
    $$,
  });
  dossierController = new DossierController({
    state,
    api,
    apiNdjson,
    setLoading,
    toast,
    openDialog,
    closeDialog,
    openGame: (source, gameId) => viewerController.open(source, gameId),
    t,
    currentLocale,
    countLabel,
    formatNumber,
    shortRange,
    sourceLabel,
    paceLabel,
    countryLabel,
    initials,
    outcome,
    outcomeLabel,
    shortDate,
    escapeHtml,
    pieces: PIECES,
    $,
    $$,
  });
  pgnController = new PgnImportController({
    state,
    api,
    toast,
    setLoading,
    loadPlayer: (player, options) => dossierController.loadPlayer(player, options),
    t,
    currentLocale,
    $,
    $$,
  });
  otbController = new OtbController({
    state,
    api,
    toast,
    openDialog,
    t,
    currentLocale,
    formatNumber,
    shortDate,
    escapeHtml,
    outcomeLabel,
    $,
    $$,
  });
  eloCalculator = new EloCalculatorController({
    state,
    api,
    toast,
    openDialog,
    t,
    currentLocale,
    formatNumber,
    escapeHtml,
    outcomeLabel,
    $,
    $$,
  });
  dossierController.renderInitial();
  bindEvents();
  pgnController.updateReady();
}

document.addEventListener("DOMContentLoaded", init);
