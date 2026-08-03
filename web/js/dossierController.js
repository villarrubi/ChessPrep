"use strict";

(function(global) {
  // The controller exposes the feature boundary; rendering helpers stay private
  // to this module so the rest of the SPA cannot couple to its DOM details.
  let state;
  let api;
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

  class DossierController {
    constructor(dependencies) {
      state = dependencies.state;
      api = dependencies.api;
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
    }

    bindEvents() {
      $("#player-search").addEventListener("submit", searchPlayer);
      $$('[data-search-mode]').forEach((button) => {
        button.addEventListener("click", () => selectHeroSearchMode(button.dataset.searchMode));
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
          $$("[data-opening-color]").forEach((item) => item.classList.toggle("active", item === button));
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
          `/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/games?mode=combined&pace=${state.pace}&page_size=250`
          ),
      ]);
      state.player = detail;
      state.stats = stats;
      state.games = games.items;
      state.datasetId = games.trace?.dataset_id || null;
      state.openingFilter = null;
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
    const selectedSource = state.source;
    const providerName = selectedSource === "all" ? "Lichess + Chess.com" : sourceLabel(selectedSource);
    setLoading(true, t("loading.searchingPlayer", {
      provider: providerName
    }));
    try {
      let player;
      if (selectedSource === "all") {
        setLoading(true, t("loading.combiningPlatforms"));
        const combined = await api("/players/combined?max_games=100", {
          method: "POST",
          body: JSON.stringify({
            lichess_username: query,
            chesscom_username: query
          }),
        });
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
          `/players/${encodeURIComponent(player.source)}/${encodeURIComponent(player.external_id)}/refresh-games?max_games=100`, {
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
        api(`${base}/games?mode=combined&pace=${pace}&page_size=250`),
      ]);
      state.stats = stats;
      state.games = games.items;
      state.openingFilter = null;
      renderAll();
    } catch (error) {
      toast(t("toast.paceError"), error.message, "error");
    } finally {
      setLoading(false);
    }
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
    return state.games.filter((game) => {
      const haystack = `${game.white} ${game.black} ${game.event || ""} ${game.opening} ${game.eco || ""}`
        .toLocaleLowerCase();
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
      const filterLabel = `${state.openingFilter.eco || t("game.noEco")} · ${state.openingFilter.opening}`;
      active.innerHTML = t("dynamic.activeOpening", {
        opening: escapeHtml(filterLabel),
        removeAria: t("dynamic.removeOpening"),
        remove: t("pgn.remove")
      });
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

  async function refreshCurrentPlayer() {
    if (!["lichess", "chess.com"].includes(state.player?.source)) return;
    const button = $("#refresh-player");
    button.classList.add("spinning");
    try {
      await api(
        `/players/${encodeURIComponent(state.player.source)}/${encodeURIComponent(state.player.external_id)}/refresh-games?max_games=100`, {
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
    closeDialog("combine-dialog");
    setLoading(true, t("loading.combiningProfiles"));
    try {
      const result = await api("/players/combined?max_games=100", {
        method: "POST",
        body: JSON.stringify({
          lichess_username: lichess || null,
          chesscom_username: chesscom || null
        }),
      });
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

  function updateSearchPlaceholder() {
    const input = $("#player-query");
    if (!input) return;
    input.placeholder = state.source === "all" ?
      t("hero.onlinePlaceholderAll") :
      t(state.source === "lichess" ? "hero.onlinePlaceholderLichess" : "hero.onlinePlaceholderChesscom");
  }

  global.DossierController = DossierController;
})(window);
