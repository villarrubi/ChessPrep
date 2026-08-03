"use strict";

(function(global) {
  class OtbController {
    constructor({
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
      $$
    }) {
      this.state = state;
      this.api = api;
      this.toast = toast;
      this.openDialog = openDialog;
      this.t = t;
      this.currentLocale = currentLocale;
      this.formatNumber = formatNumber;
      this.shortDate = shortDate;
      this.escapeHtml = escapeHtml;
      this.outcomeLabel = outcomeLabel;
      this.$ = $;
      this.$$ = $$;
    }

    bindEvents() {
      this.$("#hero-otb-search").addEventListener("submit", (event) => this.submitHeroSearch(event));
      this.$("#fide-id").addEventListener("input", () => this.resetProfile());
      this.$("#fide-id").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.verifyPlayer();
        }
      });
      this.$("#verify-fide").addEventListener("click", () => this.verifyPlayer());
      this.$("#search-info64").addEventListener("click", () => this.searchResults());
      this.$("#info64-federation-filter").addEventListener("change", () => this._rerenderResults());
      this.$("#info64-opponent-filter").addEventListener("input", () => this._rerenderResults());
      this.$("#info64-clear-filters").addEventListener("click", () => {
        this.$("#info64-opponent-filter").value = "";
        this.$("#info64-federation-filter").value = "all";
        this._rerenderResults();
      });
      ["info64-from", "info64-to"].forEach((id) => this._bindDateField(id));
      this.$$('[data-info64-period]').forEach((button) => {
        button.addEventListener("click", () => this.setPeriod(button.dataset.info64Period));
      });
    }

    async submitHeroSearch(event) {
      event.preventDefault();
      const fideId = this._normalizeFideId(this.$("#hero-fide-id").value);
      if (!fideId) {
        this.toast(this.t("toast.invalidFide"), this.t("toast.invalidFideMessage"), "error");
        this.$("#hero-fide-id").focus();
        return;
      }
      this.$("#hero-fide-id").value = fideId;
      this.$("#fide-id").value = fideId;
      this.resetProfile();
      this.openDialog("import-dialog");
      await this.verifyPlayer();
    }

    async verifyPlayer() {
      const fideId = this._normalizeFideId(this.$("#fide-id").value);
      if (!fideId) {
        this.resetProfile();
        this.toast(this.t("toast.invalidFide"), this.t("toast.invalidFideMessage"), "error");
        return;
      }
      this.$("#fide-id").value = fideId;
      const button = this.$("#verify-fide");
      button.disabled = true;
      button.textContent = this.t("loading.verifying");
      this.resetProfile();
      try {
        const player = await this.api(`/fide/players/${encodeURIComponent(fideId)}`);
        if (this.$("#fide-id").value.trim() !== fideId) return;
        this.state.fideProfile = player;
        this.$("#fide-profile-name").textContent = player.name;
        this.$("#fide-profile-meta").textContent = [player.title, player.federation, `ID ${player.fide_id}`].filter(
          Boolean).join(" · ");
        this.renderProfileRatings(player);
        this.renderRatingTrend(player.rating_history);
        this.$("#fide-profile").hidden = false;
        this.$("#info64-panel").hidden = false;
        this.toast(this.t("toast.fideVerified"), player.name);
      } catch (error) {
        this.resetProfile();
        this.toast(this.t("toast.fideError"), error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = this.t("otb.searchPlayer");
      }
    }

    async searchResults() {
      const fideId = this.$("#fide-id").value.trim();
      if (!this.state.fideProfile || this.state.fideProfile.fide_id !== fideId) {
        this.toast(this.t("toast.verifyFirst"), this.t("toast.verifyFirstMessage"), "error");
        return;
      }
      const from = this._readDate("info64-from", this.t("otb.from"));
      if (from === undefined) return;
      const to = this._readDate("info64-to", this.t("otb.to"));
      if (to === undefined) return;
      if (from && to && from > to) {
        this.toast(this.t("toast.invalidRange"), this.t("toast.invalidRangeMessage"), "error");
        return;
      }
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const button = this.$("#search-info64");
      button.disabled = true;
      button.textContent = this.t("loading.queryingInfo64");
      try {
        const suffix = params.toString() ? `?${params}` : "";
        const payload = await this.api(`/fide/players/${encodeURIComponent(fideId)}/info64-results${suffix}`);
        if (this.state.fideProfile?.fide_id !== fideId) return;
        const visibleSummary = this.renderResults(payload);
        const message = visibleSummary.games ?
          this.t("info64.visibleResults", {
            games: visibleSummary.games,
            tournaments: visibleSummary.tournaments
          }) :
          this.t("info64.noExactResults");
        this.toast(visibleSummary.games ? this.t("toast.otbFound") : this.t("toast.otbEmpty"), message);
      } catch (error) {
        this.toast(this.t("toast.info64Error"), error.message, "error", {
          persistent: true
        });
      } finally {
        button.disabled = false;
        button.innerHTML = this.t("otb.searchInfo64");
      }
    }

    resetProfile() {
      this.state.fideProfile = null;
      this.$("#fide-profile").hidden = true;
      this.renderRatingTrend([]);
      this._resetResults();
    }

    setPeriod(period) {
      const fromField = this.$("#info64-from");
      const toField = this.$("#info64-to");
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
        fromField.value = this._displayDate(this._localIsoDate(start));
        toField.value = this._displayDate(this._localIsoDate(today));
      }
      this.$$('[data-info64-period]').forEach((button) => {
        button.classList.toggle("active", button.dataset.info64Period === period);
      });
    }

    refreshLanguage() {
      if (this.state.fideProfile) {
        this.renderProfileRatings(this.state.fideProfile);
        this.renderRatingTrend(this.state.fideProfile.rating_history);
      }
      if (this.state.info64Results) this.renderResults(this.state.info64Results);
    }

    renderProfileRatings(player = this.state.fideProfile) {
      if (!player) return;
      const ratings = [
        [this.t("pace.classical"), player.standard_rating],
        [this.t("pace.rapid"), player.rapid_rating],
        [this.t("pace.blitz"), player.blitz_rating],
      ].filter(([, rating]) => rating);
      this.$("#fide-profile-ratings").innerHTML = ratings
        .map(([label, rating]) => `<span>${this.escapeHtml(label)} ${this.escapeHtml(rating)}</span>`)
        .join("");
    }

    renderRatingTrend(history) {
      const container = this.$("#fide-rating-trend");
      const points = (Array.isArray(history) ? history : [])
        .filter((point) => /^\d{4}-[A-Z][a-z]{2}$/.test(point?.date) && [point?.rating, point?.rapid_rating, point
          ?.blitz_rating
        ].some(Number.isFinite))
        .slice(-40);
      const series = [{
        key: "rating",
        name: this.t("pace.classical"),
        suffix: "standard"
      }, {
        key: "rapid_rating",
        name: this.t("pace.rapid"),
        suffix: "rapid"
      }, {
        key: "blitz_rating",
        name: this.t("pace.blitz"),
        suffix: "blitz"
      }, ].map((item) => ({
        ...item,
        values: points.flatMap((point, index) => Number.isFinite(point[item.key]) ?
          [{
            index,
            value: point[item.key]
          }] :
          []),
      }));
      const activeSeries = series.filter((item) => item.values.length >= 2);
      if (points.length < 2 || !activeSeries.length) {
        container.hidden = true;
        series.forEach((item) => {
          this.$(`#fide-rating-line-${item.suffix}`).removeAttribute("points");
          this.$(`#fide-rating-end-${item.suffix}`).hidden = true;
        });
        return;
      }

      const width = 220;
      const height = 52;
      const padX = 4;
      const padY = 5;
      const allRatings = activeSeries.flatMap((item) => item.values.map(({
        value
      }) => value));
      const lowest = Math.min(...allRatings);
      const highest = Math.max(...allRatings);
      const spread = Math.max(highest - lowest, 20);
      const floor = lowest - spread * 0.12;
      const ceiling = highest + spread * 0.12;

      series.forEach((item) => {
        const lineElement = this.$(`#fide-rating-line-${item.suffix}`);
        const endElement = this.$(`#fide-rating-end-${item.suffix}`);
        const deltaElement = this.$(`#fide-rating-delta-${item.suffix}`);
        if (item.values.length < 2) {
          lineElement.hidden = true;
          endElement.hidden = true;
          deltaElement.textContent = "—";
          deltaElement.className = "neutral";
          return;
        }
        const coordinates = item.values.map(({
          index,
          value
        }) => {
          const x = padX + index * ((width - padX * 2) / (points.length - 1));
          const y = padY + (ceiling - value) * ((height - padY * 2) / (ceiling - floor));
          return [x, y];
        });
        const [lastX, lastY] = coordinates.at(-1);
        lineElement.setAttribute("points", coordinates.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(
          " "));
        lineElement.hidden = false;
        endElement.setAttribute("cx", lastX.toFixed(1));
        endElement.setAttribute("cy", lastY.toFixed(1));
        endElement.hidden = false;
        const delta = item.values.at(-1).value - item.values[0].value;
        deltaElement.textContent = `${delta > 0 ? "+" : ""}${delta}`;
        deltaElement.className = delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
      });

      this.$("#fide-rating-trend-from").textContent = this._ratingDateLabel(points[0].date);
      this.$("#fide-rating-trend-to").textContent = this._ratingDateLabel(points.at(-1).date);
      this.$("#fide-rating-trend-svg").setAttribute("aria-label", this.t("rating.trendAria", {
        from: this._ratingDateLabel(points[0].date, {
          long: true
        }),
        to: this._ratingDateLabel(points.at(-1).date, {
          long: true
        }),
        series: activeSeries.map((item) => {
          const first = item.values[0].value;
          const last = item.values.at(-1).value;
          const delta = last - first;
          return this.t("rating.seriesAria", {
            name: item.name,
            first,
            last,
            delta: `${delta > 0 ? "+" : ""}${delta}`
          });
        }).join(". "),
      }));
      container.hidden = false;
    }

    renderResults(payload) {
      const results = this._filterResults(payload.results);
      const summary = this._summarizeResults(results);
      const federationFilter = this.$("#info64-federation-filter").value;
      const opponentQuery = this.$("#info64-opponent-filter").value.trim();
      const filterLabels = [];
      if (federationFilter !== "all") {
        filterLabels.push(({
          federated: this.t("otb.federated").toLocaleLowerCase(this.currentLocale()),
          "non-federated": this.t("otb.nonFederated").toLocaleLowerCase(this.currentLocale())
        })[federationFilter]);
      }
      if (opponentQuery) filterLabels.push(this.t("info64.matchesQuery", {
        query: opponentQuery
      }));
      const filterDescription = filterLabels.length ?
        this.t("info64.filterDescription", {
          filters: filterLabels.join(` ${this.t("info64.and")} `)
        }) :
        "";
      this.state.info64Results = payload;
      this.$("#info64-results").hidden = false;
      this.$("#info64-source-link").href = this._safeInfo64Url(payload.source_url);
      this.$("#info64-summary").innerHTML = [
        [this.t("info64.resultsLabel"), summary.games],
        [this.t("info64.scoreLabel"), `${this.formatNumber(summary.score_percentage)}%`],
        [this.t("record.wins"), summary.wins],
        [this.t("record.draws"), summary.draws],
        [this.t("record.losses"), summary.losses],
      ].map(([label, value]) =>
        `<div><strong>${this.escapeHtml(value)}</strong><span>${this.escapeHtml(label)}</span></div>`).join("");
      this.$("#info64-match-note").textContent = payload.tournaments_scanned ?
        this.t("info64.matchNote", {
          matched: payload.tournaments_matched,
          scanned: payload.tournaments_scanned,
          fideId: payload.player.fide_id,
          count: results.length,
          filter: filterDescription
        }) :
        this.t("info64.noParticipations", {
          player: payload.player.name
        });
      this._renderWarnings(payload.warnings);
      this._renderResultRows(results, opponentQuery);
      return summary;
    }

    _renderWarnings(warningsList) {
      const warnings = this.$("#info64-warnings");
      warnings.hidden = !warningsList.length;
      warnings.innerHTML = warningsList
        .map((warning) => `<p><span aria-hidden="true">!</span>${this.escapeHtml(warning)}</p>`)
        .join("");
    }

    _renderResultRows(results, opponentQuery) {
      const list = this.$("#info64-list");
      const empty = this.$("#info64-empty");
      list.hidden = results.length === 0;
      empty.hidden = results.length > 0;
      this.$("#info64-empty p").textContent = opponentQuery ?
        this.t("info64.noOpponentMatch", {
          query: opponentQuery
        }) :
        this.t("otb.emptyText");
      list.innerHTML = results.map((result) => this._resultRow(result)).join("");
    }

    _resultRow(result) {
      const resultClass = ["win", "draw", "loss"].includes(result.outcome) ? result.outcome : "draw";
      const color = result.color === "white" ? this.t("filter.white") : result.color === "black" ? this.t(
        "filter.black") : this.t("info64.unknownColor");
      const round = [result.round ? `${this.t("info64.round")} ${result.round}` : null, result.board ?
        `${this.t("info64.board")} ${result.board}` : null
      ].filter(Boolean).join(" · ");
      const dateLabel = result.date ?
        `${result.date_precision === "tournament" ? "≈ " : ""}${this.shortDate(result.date)}${result.time ? ` · ${result.time}` : ""}` :
        this.t("date.unknown");
      const rating = result.opponent_rating ? ` · ${result.opponent_rating}` : "";
      const fideLink = result.opponent_fide_id ?
        `<a class="info64-fide-link" href="https://ratings.fide.com/profile/${encodeURIComponent(result.opponent_fide_id)}" target="_blank" rel="noopener noreferrer">FIDE ${this.escapeHtml(result.opponent_fide_id)} ↗</a>` :
        `<span>${this.t("info64.noFideId")}</span>`;
      const walkover = result.walkover ? ` · ${this.t("info64.walkover")}` : "";
      return `<article class="info64-row">
        <div class="info64-outcome ${resultClass}"><strong>${this.escapeHtml(result.score)}</strong><span>${this.escapeHtml(this.outcomeLabel(result.outcome))}</span></div>
        <div class="info64-opponent"><span>${this.t("game.opponent")}${rating}</span><strong>${this.escapeHtml(result.opponent_name)}</strong><div>${fideLink}</div></div>
        <div class="info64-tournament"><span>${this.escapeHtml(round || this.t("info64.unknownRound"))}</span><a href="${this.escapeHtml(this._safeInfo64Url(result.player_url))}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(result.tournament)} ↗</a></div>
        <div class="info64-when"><span>${this.escapeHtml(color)}${this.escapeHtml(walkover)}</span><strong>${this.escapeHtml(dateLabel)}</strong></div>
      </article>`;
    }

    _filterResults(results) {
      const federation = this.$("#info64-federation-filter").value;
      const opponentQuery = this._normalizeOpponent(this.$("#info64-opponent-filter").value);
      return results.filter((result) => {
        const matchesFederation = federation === "all" ||
          (federation === "federated" && Boolean(result.opponent_fide_id)) ||
          (federation === "non-federated" && !result.opponent_fide_id);
        const opponentText = this._normalizeOpponent(
        `${result.opponent_name} ${result.opponent_fide_id || ""}`);
        return matchesFederation && (!opponentQuery || opponentText.includes(opponentQuery));
      });
    }

    _summarizeResults(results) {
      const wins = results.filter((result) => result.outcome === "win").length;
      const draws = results.filter((result) => result.outcome === "draw").length;
      const losses = results.filter((result) => result.outcome === "loss").length;
      return {
        games: results.length,
        wins,
        draws,
        losses,
        score_percentage: results.length ?
          100 * results.reduce((total, result) => total + Number(result.score || 0), 0) / results.length :
          0,
        opponents: new Set(results.map((result) => result.opponent_fide_id || result.opponent_name
          .toLocaleLowerCase("es"))).size,
        tournaments: new Set(results.map((result) => result.tournament_url)).size,
      };
    }

    _resetResults() {
      this.state.info64Results = null;
      this.$("#info64-panel").hidden = true;
      this.$("#info64-results").hidden = true;
      this.$("#info64-summary").replaceChildren();
      this.$("#info64-list").replaceChildren();
      this.$("#info64-warnings").replaceChildren();
      this.$("#info64-opponent-filter").value = "";
      this.$("#info64-federation-filter").value = "all";
    }

    _rerenderResults() {
      if (this.state.info64Results) this.renderResults(this.state.info64Results);
    }

    _bindDateField(id) {
      const field = document.getElementById(id);
      field.addEventListener("input", () => {
        field.removeAttribute("aria-invalid");
        this.$$('[data-info64-period]').forEach((button) => button.classList.remove("active"));
      });
      field.addEventListener("blur", () => {
        const parsed = this._parseDate(field.value);
        if (parsed) field.value = this._displayDate(parsed);
      });
    }

    _readDate(id, label) {
      const field = document.getElementById(id);
      const raw = field.value.trim();
      if (!raw) {
        field.removeAttribute("aria-invalid");
        return null;
      }
      const parsed = this._parseDate(raw);
      if (!parsed) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
        this.toast(this.t("date.invalidTitle", {
          label: label.toLocaleLowerCase(this.currentLocale())
        }), this.t("date.invalidMessage"), "error");
        return undefined;
      }
      field.removeAttribute("aria-invalid");
      field.value = this._displayDate(parsed);
      return parsed;
    }

    _parseDate(value) {
      const match = String(value || "").trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
      if (!match) return null;
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      if (year < 1900 || year > 2100) return null;
      const candidate = new Date(Date.UTC(year, month - 1, day));
      if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !==
        day) return null;
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    _displayDate(value) {
      const [year, month, day] = String(value || "").split("-");
      return year && month && day ? `${day}/${month}/${year}` : "";
    }

    _localIsoDate(value) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }

    _ratingDateLabel(value, {
      long = false
    } = {}) {
      const match = String(value || "").match(/^(\d{4})-([A-Z][a-z]{2})$/);
      if (!match) return String(value || "");
      const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(
        match[2]);
      if (month < 0) return String(value || "");
      return new Intl.DateTimeFormat(this.currentLocale(), {
        month: long ? "long" : "short",
        year: long ? "numeric" : "2-digit",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(Number(match[1]), month, 1))).replace(".", "");
    }

    _normalizeOpponent(value) {
      return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es")
        .trim();
    }

    _normalizeFideId(value) {
      const compact = String(value || "").replace(/\s+/g, "");
      return /^\d{5,10}$/.test(compact) ? compact : null;
    }

    _safeInfo64Url(value, fallback = "https://info64.org/search-player") {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "info64.org" &&
          (!url.port || url.port === "443") && !url.username && !url.password ?
          url.href :
          fallback;
      } catch {
        return fallback;
      }
    }
  }

  global.OtbController = OtbController;
})(window);
