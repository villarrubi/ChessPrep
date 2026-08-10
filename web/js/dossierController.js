"use strict";

(function(global) {
  // The controller exposes the feature boundary; rendering helpers stay private
  // to this module so the rest of the SPA cannot couple to its DOM details.
  let state;
  let api;
  let apiNdjson;
  let setLoading;
  let toast;
  let openDialog;
  let closeDialog;
  let openGame;
  let t;
  let currentLocale;
  let countLabel;
  let formatNumber;
  let shortRange;
  let sourceLabel;
  let paceLabel;
  let countryLabel;
  let initials;
  let outcome;
  let outcomeLabel;
  let shortDate;
  let escapeHtml;
  let $;
  let $$;
  let PIECES;
  let playerEngineProfile;

  class DossierController {
    constructor(dependencies) {
      state = dependencies.state;
      api = dependencies.api;
      apiNdjson = dependencies.apiNdjson;
      setLoading = dependencies.setLoading;
      toast = dependencies.toast;
      openDialog = dependencies.openDialog;
      closeDialog = dependencies.closeDialog;
      openGame = dependencies.openGame;
      t = dependencies.t;
      currentLocale = dependencies.currentLocale;
      countLabel = dependencies.countLabel;
      formatNumber = dependencies.formatNumber;
      shortRange = dependencies.shortRange;
      sourceLabel = dependencies.sourceLabel;
      paceLabel = dependencies.paceLabel;
      countryLabel = dependencies.countryLabel;
      initials = dependencies.initials;
      outcome = dependencies.outcome;
      outcomeLabel = dependencies.outcomeLabel;
      shortDate = dependencies.shortDate;
      escapeHtml = dependencies.escapeHtml;
      $ = dependencies.$;
      $$ = dependencies.$$;
      PIECES = dependencies.pieces;
      playerEngineProfile = new global.PlayerEngineProfileController({
        loadGame: (game) => api(`/games/${encodeURIComponent(game.source)}/${encodeURIComponent(game.id)}`),
      });
    }

    bindEvents() {
      $("#player-search").addEventListener("submit", searchPlayer);
      $$('[data-search-mode]').forEach((button) => {
        button.addEventListener("click", () => selectHeroSearchMode(button.dataset.searchMode));
      });
      $$('[data-repertoire-view]').forEach((button) => {
        button.addEventListener("click", () => {
          state.repertoireView = button.dataset.repertoireView;
          renderRepertoire();
        });
      });
      bindRovingTabs('[data-search-mode]');
      bindRovingTabs('[data-repertoire-view]');
      $$('[data-decision-color]').forEach((button) => {
        button.addEventListener("click", () => {
          state.decisionColor = button.dataset.decisionColor;
          state.decisionPath = [];
          renderDecisionMap();
        });
      });
      $("#load-demo").addEventListener("click", () => loadDemo(true));
      $("#refresh-player").addEventListener("click", refreshCurrentPlayer);
      $$("[data-pace]").forEach((button) => {
        button.addEventListener("click", () => switchPace(button.dataset.pace));
      });
      $$("[data-source]").forEach((button) => {
        button.addEventListener("click", () => {
          state.source = button.dataset.source;
          $$("[data-source]").forEach((item) => item.classList.toggle("active", item === button));
          updateSearchPlaceholder();
        });
      });
      $$("[data-opening-color]").forEach((button) => {
        button.addEventListener("click", () => {
          state.openingColor = button.dataset.openingColor;
          syncOpeningColorControls();
          renderOpenings();
        });
      });
      ["game-search", "filter-color", "filter-result"].forEach((id) => {
        document.getElementById(id).addEventListener(id === "game-search" ? "input" : "change", renderGames);
      });
      $("#clear-filters").addEventListener("click", () => {
        $("#game-search").value = "";
        $("#filter-color").value = "all";
        $("#filter-result").value = "all";
        state.openingFilter = null;
        renderGames();
      });
      $("#open-combine").addEventListener("click", () => openDialog("combine-dialog"));
      $("#submit-combine").addEventListener("click", submitCombinedProfiles);
      $("#profile-engine-toggle").addEventListener("click", togglePlayerEngineProfile);
      $("#profile-engine-loading-toggle").addEventListener("click", togglePlayerEngineProfile);
    }

    loadPlayer(player, options) {
      return loadPlayer(player, options);
    }

    renderInitial() {
      renderMiniBoard();
      updateSearchPlaceholder();
    }

    refreshLanguage() {
      updateSearchPlaceholder();
      if (state.player && state.stats) renderAll();
    }
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

  async function loadPlayer(player, {
    scroll = false
  } = {}) {
    setLoading(true, t("loading.calculatingDossier"));
    try {
      const [detail, stats, games] = await Promise.all([
        api(`/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}`),
        api(
          `/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/stats?mode=combined&pace=${state.pace}`
          ),
        api(
          `/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/games?mode=combined&pace=${state.pace}&page_size=500`
          ),
      ]);
      state.player = detail;
      state.stats = stats;
      state.games = games.items;
      state.datasetId = games.trace?.dataset_id || null;
      state.openingFilter = null;
      state.decisionPath = [];
      $("#analisis").hidden = false;
      $("#partidas").hidden = false;
      renderAll();
      if (scroll) $("#analisis").scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    } catch (error) {
      toast(t("toast.loadError"), error.message, "error");
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function loadDemo(scroll = true) {
    try {
      const demo = await api("/demo");
      await loadPlayer(demo.player, {
        scroll
      });
      toast(
        t("toast.demoLoaded"),
        t("toast.demoMessage"),
        "warning", {
          persistent: true
        },
      );
    } catch (error) {
      toast(t("toast.demoUnavailable"), error.message, "error");
    }
  }

  async function searchPlayer(event) {
    event.preventDefault();
    const query = $("#player-query").value.trim();
    if (query.length < 2) {
      toast(t("toast.enterUser"), t("toast.enterUserMessage"), "error");
      return;
    }
    const sampleQuery = onlineSampleQuery();
    if (!sampleQuery) return;
    const selectedSource = state.source;
    const providerName = selectedSource === "all" ? "Lichess + Chess.com" : sourceLabel(selectedSource);
    setLoading(true, t("loading.searchingPlayer", {
      provider: providerName
    }));
    try {
      let player;
      if (selectedSource === "all") {
        const combined = await combineProfiles({
          lichess_username: query,
          chesscom_username: query,
        }, t("loading.combiningPlatforms"), sampleQuery);
        player = combined.dataset.player;
        if (combined.warnings.length) {
          toast(
            t("toast.dossierWarnings"),
            combined.warnings.join(" "),
            "warning", {
              persistent: true
            },
          );
        }
      } else {
        const search = await api(
          `/players/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent(selectedSource)}`);
        if (!search.results.length) throw new Error(search.message || t("toast.userNotFound"));
        player = search.results.find((item) => item.source === selectedSource) || search.results[0];
        setLoading(true, t("loading.collectingGames", {
          source: sourceLabel(player.source)
        }));
        await api(
          `/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/refresh-games?${sampleQuery}`, {
            method: "POST"
          });
      }
      await loadPlayer(player, {
        scroll: true
      });
      toast(t("toast.updated"), t("toast.availableGames", {
        player: player.display_name,
        count: state.games.length
      }));
    } catch (error) {
      setLoading(false);
      toast(t("toast.searchError"), error.message, "error");
    }
  }

  function selectHeroSearchMode(mode) {
    if (!['online', 'otb'].includes(mode)) return;
    $$('[data-search-mode]').forEach((button) => {
      const active = button.dataset.searchMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $('#search-panel-online').hidden = mode !== 'online';
    $('#search-panel-otb').hidden = mode !== 'otb';
    setTimeout(() => (mode === 'otb' ? $('#hero-fide-id') : $('#player-query')).focus(), 0);
  }

  async function switchPace(pace) {
    if (!state.player || state.pace === pace) return;
    state.pace = pace;
    $$("[data-pace]").forEach((button) => button.classList.toggle("active", button.dataset.pace === pace));
    setLoading(true, t("loading.filteringPace", {
      pace: paceLabel(pace).toLocaleLowerCase(currentLocale())
    }));
    try {
      const base =
        `/players/${encodeURIComponent(state.player.source)}/${encodeURIComponent(state.player.external_id)}`;
      const [stats, games] = await Promise.all([
        api(`${base}/stats?mode=combined&pace=${pace}`),
        api(`${base}/games?mode=combined&pace=${pace}&page_size=500`),
      ]);
      state.stats = stats;
      state.games = games.items;
      state.openingFilter = null;
      state.decisionPath = [];
      renderAll();
    } catch (error) {
      toast(t("toast.paceError"), error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function renderAll() {
    const sampleKey = [
      state.datasetId || state.player?.external_id || "sample",
      state.pace,
      ...state.games.map((game) => `${game.source}:${game.id}`),
    ].join("|");
    playerEngineProfile.setSample(state.games, sampleKey);
    renderPlayer();
    renderMetrics();
    renderRepertoire();
    renderColors();
    renderGames();
  }

  function renderPlayer() {
    const player = state.player;
    const stats = state.stats;
    $("#player-avatar").textContent = initials(player.display_name);
    $("#player-name").textContent = player.display_name;
    $("#player-title").textContent = player.title || "PLAY";
    $("#player-meta").textContent = [player.rating, countryLabel(player.country), sourceLabel(player.source)].filter(
      Boolean).join(" · ");
    $("#trace-sample").textContent = `${stats.sample_size} ${countLabel(stats.sample_size)}`;
    $("#trace-range").textContent = shortRange(stats.date_range);
    $("#trace-sources").textContent = stats.sources.map(sourceLabel).join(" + ") || t("source.none");
    $("#refresh-player").hidden = !["lichess", "chess.com"].includes(player.source);
  }

  function renderMetrics() {
    const stats = state.stats;
    const overall = stats.overall;
    $("#metric-score").innerHTML = `${formatNumber(overall.score_pct)}<small>%</small>`;
    $("#metric-record").textContent =
      `${overall.wins} ${t("record.wins")} · ${overall.draws} ${t("record.draws")} · ${overall.losses} ${t("record.losses")}`;
    $("#metric-score-bar").style.width = `${overall.score_pct}%`;
    const white = stats.by_color.find((row) => row.color === "white") || {};
    const black = stats.by_color.find((row) => row.color === "black") || {};
    renderColorMetric("white", white);
    renderColorMetric("black", black);
    const dots = $("#form-dots");
    dots.innerHTML = stats.recent_form.map((result) => {
      const letter = ({
        win: t("record.winShort"),
        draw: t("record.drawShort"),
        loss: t("record.lossShort")
      })[result.outcome] || "–";
      return `<span class="form-dot ${result.outcome}" title="${outcomeLabel(result.outcome)} ${t("dynamic.against")} ${escapeHtml(result.opponent)}">${letter}</span>`;
    }).join("");
    $("#recent-label").textContent = t("dynamic.lastGames", {
      count: stats.recent_form.length
    });
    $("#metric-date").textContent = shortRange(stats.date_range);
  }

  function renderColorMetric(color, record) {
    $(`#metric-${color}`).innerHTML = `${formatNumber(record.score_pct || 0)}<small>%</small>`;
    $(`#metric-${color}-record`).textContent = `n = ${record.games || 0} ${countLabel(record.games || 0)}`;
    $(`#metric-${color}-form`).textContent =
      `${record.wins || 0}${t("record.winShort")} · ${record.draws || 0}${t("record.drawShort")} · ${record.losses || 0}${t("record.lossShort")}`;
  }

  function renderOpenings() {
    syncOpeningColorControls();
    const rows = state.stats.openings.filter((item) => state.openingColor === "all" || item.color === state
      .openingColor);
    const visibleRows = rows.slice(0, 8);
    $("#openings-body").innerHTML = visibleRows.map((item, index) => `
    <tr data-opening-index="${index}" tabindex="0" aria-label="${escapeHtml(t("dynamic.filterOpeningAria", { opening: item.opening }))}">
      <td class="opening-cell"><strong>${escapeHtml(item.opening)}</strong><span>${escapeHtml(item.eco || "—")} · ${t("openings.share", { share: formatNumber(item.share_pct) })}</span></td>
      <td><span class="color-pill ${item.color}"><i></i>${item.color === "white" ? t("filter.white") : t("filter.black")}</span></td>
      <td><strong>${item.games}</strong></td>
      <td class="score-cell">${formatNumber(item.score_pct)}%</td>
      <td class="row-arrow">→</td>
    </tr>
  `).join("") || `<tr><td colspan="5">${escapeHtml(t("openings.none"))}</td></tr>`;
    $$("#openings-body tr[data-opening-index]").forEach((row) => {
      const opening = visibleRows[Number(row.dataset.openingIndex)];
      const select = () => selectOpening(opening);
      row.addEventListener("click", select);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") select();
      });
    });
  }

  function renderRepertoire() {
    const validViews = new Set(["decisions", "openings", "analysis"]);
    if (!validViews.has(state.repertoireView)) state.repertoireView = "decisions";
    $("#decision-map-view").hidden = state.repertoireView !== "decisions";
    $("#openings-table-view").hidden = state.repertoireView !== "openings";
    $("#player-analysis-view").hidden = state.repertoireView !== "analysis";
    const titleKey = {
      decisions: "repertoire.decisionMap",
      openings: "openings.title",
      analysis: "profile.title",
    }[state.repertoireView];
    $("#repertoire-title").textContent = t(titleKey);
    $$('[data-repertoire-view]').forEach((button) => {
      const active = button.dataset.repertoireView === state.repertoireView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $("#player-analysis-view").closest(".analysis-grid")?.classList.toggle(
      "analysis-focus",
      state.repertoireView === "analysis",
    );
    if (state.repertoireView === "decisions") renderDecisionMap();
    else if (state.repertoireView === "openings") renderOpenings();
    else renderPlayerProfile();
  }

  function profileConfidenceClass(level) {
    return ({ alta: "high", media: "medium", baja: "low" })[level] || "low";
  }

  function renderProfileFindings(selector, findings) {
    $(selector).innerHTML = (findings || []).map((finding) => `
      <article class="profile-finding-item">
        <div class="profile-finding-title"><h5>${escapeHtml(finding.title)}</h5>${finding.confidence ? `<span>${escapeHtml(finding.confidence)}</span>` : ""}</div>
        <p>${escapeHtml(finding.text)}</p>
        ${(finding.evidence_game_ids || []).length ? `<button type="button" class="profile-evidence-games" data-profile-game-ids="${escapeHtml(finding.evidence_game_ids.join(","))}" data-profile-label="${escapeHtml(finding.title)}">${escapeHtml(t("profile.viewGames"))}</button>` : ""}
      </article>
    `).join("");
    $$(".profile-evidence-games", $(selector)).forEach((button) => {
      button.addEventListener("click", () => selectProfileGames(
        button.dataset.profileGameIds.split(",").filter(Boolean),
        button.dataset.profileLabel,
      ));
    });
  }

  function renderPlayerProfile() {
    const profile = state.stats?.player_profile;
    if (!profile) {
      $("#player-analysis-view").innerHTML = `<div class="decision-empty"><strong>${escapeHtml(t("profile.emptyTitle"))}</strong><span>${escapeHtml(t("profile.emptyText"))}</span></div>`;
      return;
    }

    const confidence = $("#profile-confidence");
    confidence.className = `profile-confidence ${profileConfidenceClass(profile.confidence?.level)}`;
    confidence.textContent = t("profile.confidence", {
      level: profile.confidence?.level || t("profile.low"),
      usable: profile.confidence?.usable_games || 0,
      sample: profile.confidence?.sample_games || 0,
    });
    confidence.title = profile.confidence?.text || "";
    $("#profile-headline").textContent = profile.headline;
    $("#profile-descriptors").innerHTML = (profile.descriptors || [])
      .filter((descriptor) => !/^\d/.test(descriptor))
      .map((descriptor) => `<span>${escapeHtml(descriptor)}</span>`).join("");
    $("#profile-narrative").innerHTML = (profile.narrative || [])
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
    $("#profile-sample-context").innerHTML = [
      `${state.stats.sample_size} ${countLabel(state.stats.sample_size)}`,
      paceLabel(state.pace),
      shortRange(state.stats.date_range),
      state.stats.sources.map(sourceLabel).join(" + "),
    ].filter(Boolean).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
    renderProfileTakeaways(profile, playerEngineProfile.getSnapshot());
    renderProfileOpenings(profile);

    renderPreparationPlan(profile.preparation_plan || [], playerEngineProfile.getSnapshot().report.plan || []);
    renderEngineProfile(playerEngineProfile.getSnapshot());
  }

  function firstOpeningChoices(color, actor) {
    const map = state.stats?.opening_decisions?.[color];
    if (!map?.games) return [];
    const firstActor = color === "white" ? "player" : "opponent";
    const edges = actor === firstActor ? (map.roots || []) : (map.roots || []).flatMap((root) =>
      map.nodes?.[root.node_id]?.children || []);
    const grouped = new Map();
    edges.forEach((edge) => {
      const node = map.nodes?.[edge.node_id];
      if (!node || node.actor !== actor) return;
      const move = edge.moves?.[0]?.move || node.moves?.[0]?.move || "";
      const key = `${move}|${node.opening || node.eco || node.id}`;
      const current = grouped.get(key) || {
        move,
        opening: node.opening || node.eco || "Continuación sin clasificar",
        games: 0,
      };
      current.games += Number(edge.games) || 0;
      grouped.set(key, current);
    });
    return [...grouped.values()]
      .sort((a, b) => b.games - a.games || a.opening.localeCompare(b.opening))
      .slice(0, 3)
      .map((item) => ({ ...item, share: Math.round(item.games / map.games * 100) }));
  }

  function renderOpeningChoiceList(items) {
    return items.length ? `<ul>${items.map((item) => `
      <li><strong>${escapeHtml(item.move || item.opening)}</strong><span>${escapeHtml(item.opening)}</span><small>${item.games} ${escapeHtml(countLabel(item.games))} · ${item.share}%</small></li>
    `).join("")}</ul>` : `<p class="profile-opening-empty">No hay suficientes jugadas clasificadas.</p>`;
  }

  function renderProfileOpenings(profile) {
    const openingsByColor = Object.fromEntries((profile.openings || []).map((item) => [item.color, item]));
    $("#profile-openings").innerHTML = ["white", "black"].map((color) => {
      const colorLabel = color === "white" ? t("filter.white") : t("filter.black");
      const ownLabel = color === "white" ? "El jugador empieza con" : "El jugador responde con";
      const rivalLabel = color === "white" ? "Los rivales responden con" : "Los rivales le plantean";
      const ownChoices = firstOpeningChoices(color, "player");
      const rivalChoices = firstOpeningChoices(color, "opponent");
      const sample = openingsByColor[color];
      const resultingOpenings = (sample?.top_openings || []).map((item) => `
        <li><strong>${escapeHtml(item.eco || "—")}</strong><span>${escapeHtml(item.opening)}</span><small>${item.games} ${escapeHtml(countLabel(item.games))} · ${formatNumber(item.share_pct)}%</small></li>
      `).join("") || `<li class="profile-opening-empty">${escapeHtml(t("openings.none"))}</li>`;
      const bookMoves = (Number(sample?.average_book_ply) || 0) / 2;
      const bookReading = !sample?.games ? "" : bookMoves >= 9 ?
        "Las partidas suelen alcanzar ramas ECO relativamente profundas antes de desviarse." : bookMoves < 5 ?
        "Las partidas se separan pronto de las ramas ECO reconocidas; eso puede ser una elección propia, una respuesta rival o una transposición." :
        "Las partidas siguen un recorrido ECO intermedio antes de entrar en posiciones menos clasificadas.";
      return `<article class="profile-opening-card profile-opening-agency">
        <div class="profile-opening-head"><span class="color-pill ${color}"><i></i>${escapeHtml(colorLabel)}</span><strong>${sample?.games || 0} ${escapeHtml(countLabel(sample?.games || 0))}</strong></div>
        <section class="profile-opening-side player-choice"><span>${escapeHtml(ownLabel)}</span>${renderOpeningChoiceList(ownChoices)}</section>
        <section class="profile-opening-side opponent-choice"><span>${escapeHtml(rivalLabel)}</span>${renderOpeningChoiceList(rivalChoices)}</section>
        <section class="profile-opening-side resulting-choice"><span>Posiciones que acaban apareciendo</span><p class="profile-opening-reading">${escapeHtml(bookReading)}</p><ul>${resultingOpenings}</ul></section>
      </article>`;
    }).join("");
  }

  function renderProfileTakeaways(profile, snapshot) {
    const choices = (snapshot.report.styleChoices || []).filter((choice) => choice.opportunities >= 8);
    const pronouncedChoices = choices.filter((choice) => choice.percentage >= 65 || choice.percentage <= 35);
    const styleReady = snapshot.status === "complete";
    const strongestChoice = [...pronouncedChoices].sort((a, b) =>
      (Math.abs(b.percentage - 50) * Math.sqrt(b.opportunities)) -
      (Math.abs(a.percentage - 50) * Math.sqrt(a.opportunities)))[0];

    if (styleReady) {
      $("#profile-headline").textContent = snapshot.report.styleHeadline;
      $("#profile-narrative").innerHTML = (snapshot.report.styleNarrative || []).slice(0, 2)
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
      $("#profile-takeaway-style").textContent = snapshot.report.styleHeadline;
      $("#profile-takeaway-style-detail").textContent = strongestChoice ?
        strongestChoice.summary : "No aparece una tendencia lo bastante repetida como para convertirla en una etiqueta.";
    } else {
      $("#profile-headline").textContent = profile.headline;
      const introduction = profile.analysed_games ? [t("profile.preAnalysisNarrative")] : (profile.narrative || []);
      $("#profile-narrative").innerHTML = introduction
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
      $("#profile-takeaway-style").textContent = t("profile.stylePending");
      $("#profile-takeaway-style-detail").textContent = t("profile.stylePendingDetail");
    }

    const whiteChoice = firstOpeningChoices("white", "player")[0];
    const blackChoice = firstOpeningChoices("black", "player")[0];
    $("#profile-takeaway-opening").textContent = [
      whiteChoice ? `Con blancas: ${whiteChoice.move || whiteChoice.opening}` : "",
      blackChoice ? `Con negras: ${blackChoice.move || blackChoice.opening}` : "",
    ].filter(Boolean).join(" · ") || t("openings.none");
    $("#profile-takeaway-opening-detail").textContent = "Más abajo se separan sus elecciones de las respuestas de sus rivales.";

    const favourable = snapshot.report.strengths?.[0] || profile.patterns?.[0];
    $("#profile-takeaway-strength").textContent = favourable?.title || t("profile.noClearPattern");
    $("#profile-takeaway-strength-detail").textContent = favourable ?
      (snapshot.report.strengths?.[0] ? t("profile.enginePatternDetail") : t("profile.samplePatternDetail")) : "";

    const target = snapshot.report.watchouts?.[0] || profile.questions?.[0];
    $("#profile-takeaway-target").textContent = target?.title || t("profile.noClearTarget");
    $("#profile-takeaway-target-detail").textContent = target ?
      (snapshot.report.watchouts?.[0] ? t("profile.engineTargetDetail") : t("profile.sampleTargetDetail")) : "";
  }

  function renderPreparationPlan(observed, objective) {
    const combined = (objective.length ? [...objective, ...observed] : observed).slice(0, 5);
    $("#profile-preparation-plan").innerHTML = combined.map((item, index) => `
      <article class="profile-plan-item">
        <span class="profile-plan-number">${String(index + 1).padStart(2, "0")}</span>
        <div><h5>${escapeHtml(item.title)}</h5><p>${escapeHtml(item.text)}</p></div>
      </article>
    `).join("") || `<p class="profile-plan-empty">${escapeHtml(t("profile.planEmpty"))}</p>`;
  }

  function renderEngineProfile(snapshot) {
    const progress = snapshot.status === "complete" ? 100 : snapshot.progress;
    const progressNode = $("#profile-engine-progress");
    progressNode.setAttribute("aria-valuenow", String(progress));
    progressNode.setAttribute("aria-busy", String(snapshot.running));
    $("#profile-engine-progress-bar").style.width = `${progress}%`;
    const statusMessages = {
      idle: t("profile.engineIdle"),
      running: t("profile.engineRunning", {
        gamesDone: snapshot.gamesDone,
        gamesTotal: snapshot.gamesTotal,
        movesDone: snapshot.movesDone,
        movesTotal: snapshot.movesTotal,
      }),
      paused: t("profile.enginePaused", { movesDone: snapshot.movesDone, movesTotal: snapshot.movesTotal }),
      complete: t("profile.engineComplete", { games: snapshot.gamesDone, moves: snapshot.movesDone }),
      error: t("profile.engineError", { error: snapshot.error }),
    };
    $("#profile-engine-status").textContent = statusMessages[snapshot.status] || statusMessages.idle;
    const toggle = $("#profile-engine-toggle");
    toggle.disabled = snapshot.gamesTotal === 0;
    toggle.hidden = snapshot.status === "complete";
    toggle.textContent = t("profile.startEngine");

    const loadingStates = new Set(["running", "paused", "error"]);
    const showLoading = loadingStates.has(snapshot.status);
    $("#profile-analysis-loading").hidden = !showLoading;
    $("#profile-analysis-content").hidden = showLoading;
    const loadingToggle = $("#profile-engine-loading-toggle");
    const pausing = snapshot.status === "paused" && snapshot.running;
    loadingToggle.disabled = pausing;
    loadingToggle.textContent = pausing ? "Pausando…" : snapshot.status === "paused" ?
      t("profile.resume") : snapshot.running ? t("profile.pause") : "Reintentar análisis";

    const complete = snapshot.status === "complete";
    $("#profile-engine-results").hidden = !complete;
    if (!complete) return;

    const visibleChoices = (snapshot.report.styleChoices || [])
      .filter((choice) => choice.opportunities >= 8 && (choice.percentage >= 65 || choice.percentage <= 35))
      .sort((a, b) => Math.abs(b.percentage - 50) - Math.abs(a.percentage - 50))
      .slice(0, 4);
    $("#profile-style-choices").innerHTML = visibleChoices.length ? visibleChoices.map((choice) => {
      const direction = choice.percentage >= 65 ? "preferred" : choice.percentage <= 35 ? "avoided" : "balanced";
      const plainStatus = direction === "preferred" ? t("profile.usuallyChooses") :
        direction === "avoided" ? t("profile.usuallyAvoids") : t("profile.noFixedPreference");
      return `<article class="profile-style-choice ${direction}">
        <span class="profile-style-marker" aria-hidden="true">${direction === "preferred" ? "→" : direction === "avoided" ? "↘" : "↔"}</span>
        <div class="profile-style-choice-copy"><small>${escapeHtml(plainStatus)}</small><h6>${escapeHtml(choice.name)}</h6><p>${escapeHtml(choice.summary)}</p></div>
      </article>`;
    }).join("") : `<div class="profile-style-empty"><span aria-hidden="true">↔</span><div><strong>Se adapta a la posición</strong><p>No aparece una inclinación dominante hacia forzar, simplificar o jugar con calma cuando dispone de varias alternativas buenas.</p></div></div>`;

    const usablePhases = snapshot.report.phases.filter((phase) => phase.moves >= 5 && phase.stability != null);
    const bestStability = Math.max(...usablePhases.map((phase) => phase.stability), -Infinity);
    const worstStability = Math.min(...usablePhases.map((phase) => phase.stability), Infinity);
    $("#profile-engine-phases").innerHTML = snapshot.report.phases.map((phase) => {
      const phaseLabel = phase.moves < 5 || phase.stability == null ? "Muestra insuficiente" :
        phase.stability === bestStability && bestStability - worstStability >= 4 ? "Fase más estable" :
        phase.stability === worstStability && bestStability - worstStability >= 4 ? "Fase a revisar" :
        "Rendimiento estable";
      return `<article class="${phaseLabel === "Fase a revisar" ? "watchout" : phaseLabel === "Fase más estable" ? "strength" : ""}">
        <span>${escapeHtml(enginePhaseName(phase.id))}</span>
        <strong>${escapeHtml(phaseLabel)}</strong>
        <small>${phase.stability == null ? "Sin datos" : `${formatNumber(phase.stability)}% de decisiones estables · ${phase.moves} analizadas`}</small>
      </article>`;
    }).join("");

    const findings = $("#profile-engine-findings");
    const hasFindings = snapshot.report.strengths.length || snapshot.report.watchouts.length;
    findings.hidden = !hasFindings;
    findings.innerHTML = hasFindings ? `
      <section><h5>${escapeHtml(t("profile.engineStrengths"))}</h5>${renderEngineFindings(snapshot.report.strengths)}</section>
      <section><h5>${escapeHtml(t("profile.engineWatchouts"))}</h5>${renderEngineFindings(snapshot.report.watchouts)}</section>
    ` : "";
    const profile = state.stats?.player_profile;
    if (profile) {
      renderProfileTakeaways(profile, snapshot);
      renderPreparationPlan(profile.preparation_plan || [], snapshot.report.plan || []);
    }
  }

  function renderEngineFindings(findings) {
    return findings.map((finding) => `
      <article class="profile-engine-finding">
        <h6>${escapeHtml(finding.title)}</h6>
        <p>${escapeHtml(finding.summary || finding.text)}</p>
      </article>
    `).join("") || `<p class="profile-engine-empty">${escapeHtml(t("profile.engineNeedsEvidence"))}</p>`;
  }

  function renderEvidencePosition(evidence) {
    if (!evidence?.source || !evidence?.gameId) return "";
    return `<button type="button" class="profile-position-button" data-profile-source="${escapeHtml(evidence.source)}" data-profile-game-id="${escapeHtml(evidence.gameId)}" data-profile-ply="${Number(evidence.ply) || 0}">${escapeHtml(t("profile.viewPosition"))}</button>`;
  }

  function bindEvidencePositions(root) {
    $$(".profile-position-button", root).forEach((button) => {
      button.addEventListener("click", () => openGame(
        button.dataset.profileSource,
        button.dataset.profileGameId,
        { ply: Number(button.dataset.profilePly) || 0 },
      ));
    });
  }

  function enginePhaseName(id) {
    return ({ opening: t("profile.opening"), middlegame: t("profile.middlegame"), endgame: t("profile.endgame") })[id] || id;
  }

  function togglePlayerEngineProfile() {
    const snapshot = playerEngineProfile.getSnapshot();
    if (snapshot.running) playerEngineProfile.pause();
    else playerEngineProfile.start({ onUpdate: renderEngineProfile });
  }

  function selectProfileGames(gameIds, label) {
    state.openingFilter = {
      game_ids: gameIds,
      opening: label,
      color: "all",
    };
    renderGames();
    $("#partidas").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindRovingTabs(selector) {
    const tabs = $$(selector);
    tabs.forEach((tab, index) => {
      tab.addEventListener("keydown", (event) => {
        let target = null;
        if (["ArrowRight", "ArrowDown"].includes(event.key)) target = tabs[(index + 1) % tabs.length];
        else if (["ArrowLeft", "ArrowUp"].includes(event.key)) target = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (event.key === "Home") target = tabs[0];
        else if (event.key === "End") target = tabs[tabs.length - 1];
        if (!target) return;
        event.preventDefault();
        target.click();
        target.focus();
      });
    });
  }

  function decisionMapForSelectedColor() {
    const maps = state.stats?.opening_decisions || {};
    let selected = maps[state.decisionColor];
    if (!selected?.games) {
      const fallback = state.decisionColor === "white" ? "black" : "white";
      if (maps[fallback]?.games) {
        state.decisionColor = fallback;
        state.decisionPath = [];
        selected = maps[fallback];
      }
    }
    return selected || {
      games: 0,
      game_ids: [],
      classified_games: 0,
      roots: [],
      nodes: {},
    };
  }

  function compactOpeningName(opening, parentOpening = "") {
    if (!opening) return "";
    if (parentOpening && opening.startsWith(`${parentOpening}: `)) {
      return opening.slice(parentOpening.length + 2);
    }
    return opening;
  }

  function syncDecisionColorControls() {
    $$('[data-decision-color]').forEach((button) => {
      const active = button.dataset.decisionColor === state.decisionColor;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function syncOpeningColorControls() {
    $$("[data-opening-color]").forEach((button) => {
      const active = button.dataset.openingColor === state.openingColor;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function validDecisionPath(map) {
    const validPath = [];
    for (const nodeId of state.decisionPath || []) {
      if (!map.nodes?.[nodeId] || validPath.includes(nodeId)) break;
      validPath.push(nodeId);
    }
    return validPath;
  }

  function renderDecisionCoverage(map) {
    const coverage = map.games ? Math.round(map.classified_games / map.games * 100) : 0;
    $("#decision-coverage").textContent = t("repertoire.coverage", {
      classified: map.classified_games,
      games: map.games,
      coverage,
    });
  }

  function edgeForDecisionPath(map, path, index) {
    const edges = index ? map.nodes[path[index - 1]]?.children : map.roots;
    return (edges || []).find((edge) => edge.node_id === path[index]) || null;
  }

  function moveForDecisionPath(map, path, index) {
    const edge = edgeForDecisionPath(map, path, index);
    const node = map.nodes[path[index]];
    return edge?.moves?.[0]?.move || node?.moves?.[0]?.move || "";
  }

  function decisionBreadcrumbLabel(map, path, index) {
    const node = map.nodes[path[index]];
    const parent = index ? map.nodes[path[index - 1]] : null;
    return moveForDecisionPath(map, path, index) ||
      compactOpeningName(node.opening, parent?.opening || "") ||
      t("repertoire.unnamedPosition");
  }

  function renderDecisionBreadcrumbs(map, path) {
    const rootLabel = t(
      state.decisionColor === "white" ? "metrics.white" : "metrics.black"
    );
    const backButton = $("#decision-back");
    const backLabel = t("repertoire.back");
    backButton.disabled = path.length === 0;
    backButton.title = backLabel;
    backButton.setAttribute("aria-label", backLabel);
    $("#decision-back-label").textContent = backLabel;
    backButton.onclick = () => {
      if (!path.length) return;
      const previousPath = path.slice(0, -1);
      state.decisionPath = previousPath;
      renderDecisionMap();
      (previousPath.length ? $("#decision-back") : $('[data-decision-depth="0"]'))?.focus();
    };
    $("#decision-breadcrumbs").innerHTML = [
      `<button type="button" data-decision-depth="0" ${path.length ? "" : 'aria-current="page"'}>${escapeHtml(rootLabel)}</button>`,
      ...path.map((_nodeId, index) =>
        `<span aria-hidden="true">›</span><button type="button" data-decision-depth="${index + 1}" ${index === path.length - 1 ? 'aria-current="page"' : ""}>${escapeHtml(decisionBreadcrumbLabel(map, path, index))}</button>`
      ),
    ].join("");
    $$('[data-decision-depth]').forEach((button) => {
      button.addEventListener("click", () => {
        state.decisionPath = path.slice(0, Number(button.dataset.decisionDepth));
        renderDecisionMap();
      });
    });
  }

  function renderCurrentDecision(map, current, path) {
    const currentRecord = current || map;
    const currentActor = current?.actor || (state.decisionColor === "white" ? "player" : "opponent");
    const currentMove = current ? moveForDecisionPath(map, path, path.length - 1) : "";
    const currentTitle = current ?
      currentMove || current.opening || t("repertoire.unnamedPosition") : t(
      state.decisionColor === "white" ? "repertoire.whiteStart" : "repertoire.blackStart"
    );
    const currentMeta = current ?
      [current.opening !== currentTitle && current.opening, current.eco].filter(Boolean).join(" · ") :
      t("repertoire.rootHelp");
    const transposition = current?.transposition_routes > 1 ?
      `<span class="decision-transposition">↔ ${escapeHtml(t("repertoire.transpositions", { count: current.transposition_routes }))}</span>` : "";
    $("#decision-current").innerHTML = `
      <div class="decision-current-copy">
        <span class="actor-pill ${currentActor}">${escapeHtml(t(currentActor === "player" ? "repertoire.you" : "repertoire.opponent"))}</span>
        <div><h4>${escapeHtml(currentTitle)}</h4><p>${escapeHtml(currentMeta)}</p>${transposition}</div>
      </div>
      <div class="decision-current-stats">
        <span><strong>${currentRecord.games}</strong>${escapeHtml(countLabel(currentRecord.games))}</span>
        <span><strong>${formatNumber(currentRecord.score_pct)}%</strong>${escapeHtml(t("openings.score"))}</span>
        <button type="button" id="decision-current-games">${escapeHtml(t("repertoire.viewGames"))}</button>
      </div>`;
    $("#decision-current-games").addEventListener("click", () => selectDecisionGames({
      game_ids: currentRecord.game_ids,
      games: currentRecord.games,
      opening: [currentMove, current?.opening].filter(Boolean).join(" · ") || currentTitle,
      color: state.decisionColor,
    }));
  }

  function decisionChoiceDetails(map, current, edge, path) {
    const node = map.nodes[edge.node_id];
    const move = edge.moves?.[0]?.move || node.moves?.[0]?.move || "";
    const opening = compactOpeningName(node.opening, current?.opening || "") ||
      node.opening || t("repertoire.unnamedPosition");
    return {
      node,
      move,
      title: move || opening,
      meta: [node.opening || opening, node.eco].filter(Boolean).join(" · "),
      hasChildren: node.children?.some((child) => !path.includes(child.node_id)),
      filterLabel: [move, node.opening || opening].filter(Boolean).join(" · "),
    };
  }

  function renderDecisionChoices(map, current, children, path) {
    const remainder = current?.other_continuations || map.unclassified_branch;
    const showRemainder = Boolean(remainder?.games) && (children.length > 0 || !current);
    if (!children.length && !showRemainder) {
      $("#decision-choices").innerHTML = `<div class="decision-end"><span>✓</span><div><strong>${escapeHtml(t("repertoire.endTitle"))}</strong><p>${escapeHtml(t("repertoire.endText"))}</p></div></div>`;
      return;
    }

    const actors = new Set(children.map((edge) => map.nodes[edge.node_id]?.actor));
    const choicesTitle = actors.size === 1 ?
      t(actors.has("player") ? "repertoire.yourChoices" : "repertoire.opponentChoices") :
      t("repertoire.nextChoices");
    $("#decision-choices").innerHTML = `
      <div class="decision-choices-heading"><strong>${escapeHtml(choicesTitle)}</strong><span>${escapeHtml(t("repertoire.contextShare"))}</span></div>
      ${children.map((edge, index) => {
        const choice = decisionChoiceDetails(map, current, edge, path);
        return `<article class="decision-choice">
          <button class="decision-choice-main" type="button" data-decision-index="${index}" aria-label="${escapeHtml(t("repertoire.continueAria", { opening: choice.title }))}">
            <span class="actor-marker ${choice.node.actor}">${escapeHtml(t(choice.node.actor === "player" ? "repertoire.you" : "repertoire.opponent"))}</span>
            <span class="decision-choice-copy"><strong>${escapeHtml(choice.title)}</strong><small>${escapeHtml(choice.meta)}</small></span>
            <span class="decision-choice-numbers"><strong>${formatNumber(edge.share_pct)}%</strong><small>${escapeHtml(t("repertoire.frequency"))} · ${edge.games} ${escapeHtml(countLabel(edge.games))}</small><small>${escapeHtml(t("openings.score"))} · ${formatNumber(edge.score_pct)}%</small></span>
            <span class="decision-chevron" aria-hidden="true">${choice.hasChildren ? "→" : "·"}</span>
            <i class="decision-share-bar" style="width:${Math.min(100, edge.share_pct)}%"></i>
          </button>
          <button class="decision-choice-games" type="button" data-decision-games-index="${index}">${escapeHtml(t("repertoire.viewGames"))}</button>
        </article>`;
      }).join("")}
      ${showRemainder ? `<article class="decision-choice decision-choice-residual">
        <div class="decision-choice-main decision-choice-static">
          <span class="actor-marker neutral" aria-hidden="true">…</span>
          <span class="decision-choice-copy"><strong>${escapeHtml(t(current ? "repertoire.otherContinuations" : "repertoire.unclassifiedGames"))}</strong><small>${escapeHtml(t("repertoire.otherContinuationsMeta"))}</small></span>
          <span class="decision-choice-numbers"><strong>${formatNumber(remainder.share_pct)}%</strong><small>${escapeHtml(t("repertoire.frequency"))} · ${remainder.games} ${escapeHtml(countLabel(remainder.games))}</small><small>${escapeHtml(t("openings.score"))} · ${formatNumber(remainder.score_pct)}%</small></span>
          <span class="decision-chevron" aria-hidden="true">·</span>
          <i class="decision-share-bar neutral" style="width:${Math.min(100, remainder.share_pct)}%"></i>
        </div>
        <button class="decision-choice-games" type="button" id="decision-other-games">${escapeHtml(t("repertoire.viewGames"))}</button>
      </article>` : ""}`;
    $$('[data-decision-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const edge = children[Number(button.dataset.decisionIndex)];
        state.decisionPath = [...path, edge.node_id];
        renderDecisionMap();
      });
    });
    $$('[data-decision-games-index]').forEach((button) => {
      button.addEventListener("click", () => {
        const edge = children[Number(button.dataset.decisionGamesIndex)];
        const choice = decisionChoiceDetails(map, current, edge, path);
        selectDecisionGames({
          game_ids: edge.game_ids,
          games: edge.games,
          opening: choice.filterLabel,
          color: state.decisionColor,
        });
      });
    });
    $("#decision-other-games")?.addEventListener("click", () => selectDecisionGames({
      game_ids: remainder.game_ids,
      games: remainder.games,
      opening: t(current ? "repertoire.otherContinuations" : "repertoire.unclassifiedGames"),
      color: state.decisionColor,
    }));
  }

  function renderDecisionMap() {
    const map = decisionMapForSelectedColor();
    const path = validDecisionPath(map);
    state.decisionPath = path;
    const current = path.length ? map.nodes[path.at(-1)] : null;
    const children = (current ? current.children : map.roots)
      .filter((edge) => !path.includes(edge.node_id));

    syncDecisionColorControls();
    renderDecisionCoverage(map);
    renderDecisionBreadcrumbs(map, path);
    if (!map.games) {
      $("#decision-current").innerHTML = `<div class="decision-empty"><strong>${escapeHtml(t("repertoire.emptyTitle"))}</strong><span>${escapeHtml(t("repertoire.emptyText"))}</span></div>`;
      $("#decision-choices").innerHTML = "";
      return;
    }
    renderCurrentDecision(map, current, path);
    renderDecisionChoices(map, current, children, path);
  }

  function renderColors() {
    $("#color-breakdown").innerHTML = state.stats.by_color.map((row) => `
    <div class="color-row">
      <div class="color-row-head"><strong>${row.color === "white" ? t("metrics.white") : t("metrics.black")}</strong><span>n = ${row.games} · ${t("openings.score").toLocaleLowerCase(currentLocale())} ${formatNumber(row.score_pct)}%</span></div>
      <div class="wdl-bar" aria-label="${row.win_pct}% ${t("record.wins")}, ${row.draw_pct}% ${t("record.draws")}, ${row.loss_pct}% ${t("record.losses")}">
        <i class="win" style="width:${row.win_pct}%"></i><i class="draw" style="width:${row.draw_pct}%"></i><i class="loss" style="width:${row.loss_pct}%"></i>
      </div>
      <div class="wdl-numbers"><span>${row.wins}${t("record.winShort")}</span><span>${row.draws}${t("record.drawShort")}</span><span>${row.losses}${t("record.lossShort")}</span></div>
    </div>
  `).join("");
    $("#sample-note").querySelector("p").innerHTML =
      `<strong>${escapeHtml(t("dynamic.samplePace", { count: state.stats.sample_size, pace: paceLabel(state.pace).toLocaleLowerCase(currentLocale()) }))}</strong> ${escapeHtml(shortRange(state.stats.date_range))}. ${state.stats.sources.map((source) => escapeHtml(sourceLabel(source))).join(" + ")}.`;
  }

  function selectedGames() {
    const text = $("#game-search").value.trim().casefold?.() || $("#game-search").value.trim().toLocaleLowerCase();
    const color = $("#filter-color").value;
    const result = $("#filter-result").value;
    const openingFilter = state.openingFilter;
    const decisionGameIds = openingFilter?.game_ids ? new Set(openingFilter.game_ids) : null;
    return state.games.filter((game) => {
      const haystack = `${game.white} ${game.black} ${game.event || ""} ${game.opening} ${game.eco || ""}`
        .toLocaleLowerCase();
      const matchesOpening = !openingFilter || (decisionGameIds ?
        decisionGameIds.has(game.id) :
        game.eco === openingFilter.eco &&
          game.opening === openingFilter.opening &&
          game.player_color === openingFilter.color);
      return (!text || haystack.includes(text)) &&
        (color === "all" || game.player_color === color) &&
        (result === "all" || outcome(game) === result) &&
        matchesOpening;
    }).sort((left, right) => (right.date || "").localeCompare(left.date || ""));
  }

  function renderGames() {
    const games = selectedGames();
    $("#games-count").textContent = `${games.length} ${t(games.length === 1 ? "count.foundOne" : "count.foundMany")}`;
    $("#games-list").hidden = games.length === 0;
    $("#games-empty").hidden = games.length > 0;
    $("#games-list").innerHTML = games.map((game) => {
      const result = outcome(game);
      const resultLetter = ({
        win: t("record.winShort"),
        draw: t("record.drawShort"),
        loss: t("record.lossShort")
      })[result] || "–";
      const opponent = game.player_color === "white" ? game.black : game.white;
      const opponentElo = game.player_color === "white" ? game.black_elo : game.white_elo;
      return `
      <article class="game-row">
        <div class="game-players">
          <span class="game-result ${result}" title="${outcomeLabel(result)}" aria-label="${outcomeLabel(result)}"><b aria-hidden="true">${resultLetter}</b></span>
          <div><strong>${escapeHtml(opponent)}</strong><span class="game-player-meta"><i class="game-color-icon ${game.player_color}" aria-hidden="true"></i>${game.player_color === "white" ? t("filter.white") : t("filter.black")}${opponentElo ? ` · ${t("game.opponent")} ${opponentElo}` : ""} · ${escapeHtml(game.result)}</span></div>
        </div>
        <div class="game-detail game-opening"><span>${t("game.opening")}</span><strong>${escapeHtml(game.eco || "—")} · ${escapeHtml(game.opening)}</strong></div>
        <div class="game-detail game-event"><span>${t("game.event")}</span><strong>${escapeHtml(game.event || t("game.imported"))}</strong></div>
        <div class="game-detail game-mode"><span>${t("game.pace")}</span><strong>${paceLabel(game.time_class)} · ${shortDate(game.date)}</strong></div>
        <button class="game-open" type="button" data-game-source="${escapeHtml(game.source)}" data-game-id="${escapeHtml(game.id)}" aria-label="${escapeHtml(t("dynamic.openGameAria", { opponent }))}">→</button>
      </article>`;
    }).join("");
    $$(".game-open").forEach((button) => button.addEventListener("click", () => openGame(button.dataset.gameSource,
      button.dataset.gameId)));
    const active = $("#active-filter");
    active.hidden = !state.openingFilter;
    if (state.openingFilter) {
      const filterLabel = state.openingFilter.game_ids ?
        state.openingFilter.opening :
        `${state.openingFilter.eco || t("game.noEco")} · ${state.openingFilter.opening}`;
      active.innerHTML = t(
        state.openingFilter.game_ids ? "dynamic.activeDecision" : "dynamic.activeOpening",
        {
          opening: escapeHtml(filterLabel),
          decision: escapeHtml(filterLabel),
          removeAria: t("dynamic.removeOpening"),
          remove: t("pgn.remove")
        }
      );
    }
    active.querySelector("button")?.addEventListener("click", () => {
      state.openingFilter = null;
      renderGames();
    });
  }

  function selectOpening(opening) {
    state.openingFilter = {
      eco: opening.eco || null,
      opening: opening.opening,
      color: opening.color,
    };
    renderGames();
    $("#partidas").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    const ecoLabel = opening.eco || t("game.withoutEco");
    toast(t("toast.filterApplied"), t("toast.showingOpening", {
      count: opening.games,
      opening: ecoLabel
    }));
  }

  function selectDecisionGames(decision) {
    state.openingFilter = {
      game_ids: decision.game_ids || [],
      opening: decision.opening,
      color: decision.color,
    };
    renderGames();
    $("#partidas").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
    toast(t("toast.filterApplied"), t("toast.showingDecision", {
      count: decision.games,
      decision: decision.opening,
    }));
  }

  async function refreshCurrentPlayer() {
    if (!["lichess", "chess.com"].includes(state.player?.source)) return;
    const sampleQuery = onlineSampleQuery();
    if (!sampleQuery) return;
    const button = $("#refresh-player");
    button.classList.add("spinning");
    try {
      await api(
        `/players/${encodeURIComponent(state.player.source)}/${encodeURIComponent(state.player.external_id)}/refresh-games?${sampleQuery}`, {
          method: "POST"
        });
      await loadPlayer(state.player);
      toast(t("toast.gamesUpdated"), t("toast.gamesUpdatedMessage"));
    } catch (error) {
      toast(t("toast.updateError"), error.message, "error");
    } finally {
      button.classList.remove("spinning");
    }
  }

  async function submitCombinedProfiles() {
    const lichess = $("#combine-lichess").value.trim();
    const chesscom = $("#combine-chesscom").value.trim();
    if (!lichess && !chesscom) {
      toast(t("toast.missingUsers"), t("toast.missingUsersMessage"), "error");
      return;
    }
    const sampleQuery = onlineSampleQuery();
    if (!sampleQuery) return;
    closeDialog("combine-dialog");
    try {
      const result = await combineProfiles({
        lichess_username: lichess || null,
        chesscom_username: chesscom || null,
      }, t("loading.combiningProfiles"), sampleQuery);
      state.pace = "global";
      $$("[data-pace]").forEach((button) => button.classList.toggle("active", button.dataset.pace === "global"));
      await loadPlayer(result.dataset.player, {
        scroll: true
      });
      const sources = result.dataset.sources.map(sourceLabel).join(" + ");
      toast(t("toast.combined"), t("toast.combinedMessage", {
        count: result.dataset.games.length,
        sources
      }));
      if (result.warnings.length) {
        toast(
          t("toast.sourceWarnings"),
          result.warnings.join(" "),
          "warning", {
            persistent: true
          },
        );
      }
    } catch (error) {
      setLoading(false);
      toast(t("toast.combineError"), error.message, "error");
    }
  }

  function createCombineSteps(platforms) {
    const steps = (platforms || []).map((source) => ({
      id: source,
      status: "pending",
      label: t("loading.platformPending", {
        source: sourceLabel(source)
      }),
    }));
    steps.push({
      id: "merge",
      status: "pending",
      label: t("loading.mergePending"),
    });
    return steps;
  }

  function cloneCombineSteps(steps) {
    return (steps || []).map((step) => ({
      ...step
    }));
  }

  function paintCombineProgress(title, steps, progress = null) {
    setLoading(true, title, cloneCombineSteps(steps), progress);
  }

  function gamesBySource(dataset) {
    const counts = {};
    for (const game of dataset?.games || []) {
      const source = game?.source;
      if (!source) continue;
      counts[source] = (counts[source] || 0) + 1;
    }
    return counts;
  }

  function finalizeCombineSteps(steps, event) {
    const counts = gamesBySource(event?.dataset);
    const total = Array.isArray(event?.dataset?.games) ? event.dataset.games.length : 0;
    return (steps || []).map((step) => {
      if (step.id === "merge") {
        return {
          ...step,
          status: "ready",
          label: t("loading.mergeReady", {
            count: total,
          }),
        };
      }
      if (step.status === "error") return {
        ...step
      };
      return {
        ...step,
        status: "ready",
        label: t("loading.platformReady", {
          source: sourceLabel(step.id),
          count: counts[step.id] ?? "…",
        }),
      };
    });
  }

  function applyCombineEvent(steps, event) {
    if (!event || !steps?.length) return steps;
    if (event.type === "done") {
      return finalizeCombineSteps(steps, event);
    }
    if (event.type === "start" && Array.isArray(event.platforms)) {
      return createCombineSteps(event.platforms);
    }
    if (event.type === "platform") {
      const step = steps.find((item) => item.id === event.source);
      if (!step) return steps;
      if (event.status === "loading") {
        step.status = "loading";
        step.label = t("loading.platformLoading", {
          source: sourceLabel(event.source)
        });
      } else if (event.status === "ready") {
        step.status = "ready";
        step.label = t("loading.platformReady", {
          source: sourceLabel(event.source),
          count: event.games ?? 0,
        });
      } else if (event.status === "error") {
        step.status = "error";
        step.label = t("loading.platformError", {
          source: sourceLabel(event.source)
        });
      }
      return steps;
    }
    if (event.type === "merge") {
      const step = steps.find((item) => item.id === "merge");
      if (!step) return steps;
      if (event.status === "loading") {
        step.status = "loading";
        step.label = t("loading.mergeLoading");
      } else if (event.status === "ready") {
        step.status = "ready";
        step.label = t("loading.mergeReady", {
          count: event.games ?? 0
        });
      }
    }
    return steps;
  }

  function startStagedCombineProgress(steps, title, shouldPause) {
    const platformIds = steps.filter((step) => step.id !== "merge").map((step) => step.id);
    const timers = [];
    let bar = 8;
    let stopped = false;

    const paint = (progress) => {
      if (stopped || shouldPause()) return;
      paintCombineProgress(title, steps, progress ?? bar);
    };

    const markPlatformLoading = (source) => {
      const step = steps.find((item) => item.id === source);
      if (!step || step.status === "ready" || step.status === "error") return;
      step.status = "loading";
      step.label = t("loading.platformLoading", {
        source: sourceLabel(source)
      });
    };

    const markPlatformReady = (source) => {
      const step = steps.find((item) => item.id === source);
      if (!step || step.status === "ready" || step.status === "error") return;
      step.status = "ready";
      step.label = t("loading.platformReady", {
        source: sourceLabel(source),
        count: "…",
      });
    };

    if (platformIds[0]) {
      markPlatformLoading(platformIds[0]);
      paint(10);
    }

    // Spend almost all staged time on platform fetches. Merge is only a short
    // final beat when the response arrives (see combineProfilesStream).
    platformIds.forEach((source, index) => {
      const isLast = index === platformIds.length - 1;
      if (isLast) return;
      const at = 1400 + index * 1800;
      timers.push(window.setTimeout(() => {
        if (stopped || shouldPause()) return;
        markPlatformReady(source);
        const next = platformIds[index + 1];
        if (next) markPlatformLoading(next);
        bar = Math.min(72, 24 + (index + 1) * 30);
        paint(bar);
      }, at));
    });

    const creep = window.setInterval(() => {
      if (stopped || shouldPause()) return;
      bar = Math.min(86, bar + 1.5);
      paint(bar);
    }, 500);
    timers.push(creep);

    return {
      stop() {
        stopped = true;
        timers.forEach((id) => {
          window.clearTimeout(id);
          window.clearInterval(id);
        });
      },
    };
  }

  function markMergeLoading(steps) {
    const merge = steps.find((item) => item.id === "merge");
    if (!merge || merge.status === "ready" || merge.status === "error") return steps;
    merge.status = "loading";
    merge.label = t("loading.mergeLoading");
    for (const step of steps) {
      if (step.id === "merge" || step.status === "ready" || step.status === "error") continue;
      step.status = "ready";
      step.label = t("loading.platformReady", {
        source: sourceLabel(step.id),
        count: "…",
      });
    }
    return steps;
  }

  function onlineSampleQuery() {
    const selectedLimit = Number.parseInt($("#online-game-limit")?.value || "100", 10);
    const maxGames = [50, 100, 200].includes(selectedLimit) ? selectedLimit : 100;
    const dateFrom = $("#online-date-from")?.value || "";
    const dateTo = $("#online-date-to")?.value || "";
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast(t("toast.invalidRange"), t("toast.invalidRangeMessage"), "error");
      return null;
    }
    const params = new URLSearchParams({
      max_games: String(maxGames),
    });
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    return params.toString();
  }

  async function combineProfiles(payload, title, sampleQuery) {
    let steps = createCombineSteps([
      ...(payload.lichess_username ? ["lichess"] : []),
      ...(payload.chesscom_username ? ["chess.com"] : []),
    ]);
    const staged = startStagedCombineProgress(steps, title, () => false);
    paintCombineProgress(title, steps, 10);
    try {
      const result = await api(`/players/combined?${sampleQuery}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      staged.stop();
      steps = markMergeLoading(cloneCombineSteps(steps));
      paintCombineProgress(title, steps, 94);
      steps = finalizeCombineSteps(steps, {
        dataset: result.dataset,
      });
      paintCombineProgress(title, steps, 100);
      return result;
    } finally {
      staged.stop();
    }
  }

  function updateSearchPlaceholder() {
    const input = $("#player-query");
    if (!input) return;
    input.placeholder = state.source === "all" ?
      t("hero.onlinePlaceholderAll") :
      t(state.source === "lichess" ? "hero.onlinePlaceholderLichess" : "hero.onlinePlaceholderChesscom");
  }

  global.DossierController = DossierController;
})(window);
