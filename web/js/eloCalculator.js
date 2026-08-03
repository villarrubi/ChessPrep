"use strict";

(function(global) {
  class EloCalculatorController {
    constructor({
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
      $$
    }) {
      this.state = state;
      this.api = api;
      this.toast = toast;
      this.openDialog = openDialog;
      this.t = t;
      this.currentLocale = currentLocale;
      this.formatNumber = formatNumber;
      this.escapeHtml = escapeHtml;
      this.outcomeLabel = outcomeLabel;
      this.$ = $;
      this.$$ = $$;
    }

    bindEvents() {
      this.$("#elo-calculator").addEventListener("click", () => {
        this.ensureInitialRows();
        this.openDialog("elo-dialog");
      });
      this.$$('[data-elo-tab]').forEach((button) => {
        button.addEventListener("click", () => this.selectTab(button.dataset.eloTab));
      });
      this.$$(".elo-player-card").forEach((card) => {
        this.$(".elo-source", card).addEventListener("change", () => this.updatePlayerSource(card));
        this.updatePlayerSource(card);
      });
      this.$("#add-elo-opponent").addEventListener("click", () => {
        this.addInitialRow({
          period: this.$("#elo-default-period").value
        });
      });
      this.$("#calculate-elo-game").addEventListener("click", () => this.calculateHeadToHead());
      this.$("#calculate-initial-elo").addEventListener("click", () => this.calculateInitial());
      this.$("#elo-discipline").addEventListener("change", () => this.clearResults());
    }

    selectTab(tab) {
      this.$$('[data-elo-tab]').forEach((button) => {
        const selected = button.dataset.eloTab === tab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      this.$("#elo-panel-game").hidden = tab !== "game";
      this.$("#elo-panel-initial").hidden = tab !== "initial";
    }

    updatePlayerSource(card) {
      const manual = this.$(".elo-source", card).value === "manual";
      this.$(".elo-fide-field", card).hidden = manual;
      this.$(".elo-manual-fields", card).hidden = !manual;
    }

    addInitialRow(values = {}) {
      const row = document.createElement("div");
      row.className = "elo-initial-row";
      row.innerHTML = `
        <select class="text-field elo-row-source" aria-label="${this.escapeHtml(this.t("elo.dataSource"))}">
          <option value="fide"></option><option value="manual"></option>
        </select>
        <div class="elo-row-data">
          <input class="text-field elo-row-fide" inputmode="numeric" autocomplete="off" maxlength="10" />
          <input class="text-field elo-row-rating" type="number" min="100" max="4000" inputmode="numeric" hidden />
        </div>
        <select class="text-field elo-result-select" aria-label="${this.escapeHtml(this.t("elo.result"))}">
          <option value="win"></option><option value="draw"></option><option value="loss"></option>
        </select>
        <input class="text-field elo-period" type="month" aria-label="${this.escapeHtml(this.t("elo.monthYear"))}" />
        <button class="elo-remove-row" type="button">×</button>`;
      this.$(".elo-row-source", row).value = values.source || "fide";
      this.$(".elo-row-fide", row).value = values.fideId || "";
      this.$(".elo-row-rating", row).value = values.rating || "";
      this.$(".elo-result-select", row).value = values.result || "win";
      this.$(".elo-period", row).value = values.period || "";
      this._localizeRow(row);
      this._updateRowSource(row);
      this.$(".elo-row-source", row).addEventListener("change", () => this._updateRowSource(row));
      this.$(".elo-remove-row", row).addEventListener("click", () => row.remove());
      this.$("#elo-initial-rows").append(row);
    }

    ensureInitialRows() {
      if (this.$$(`.elo-initial-row`, this.$("#elo-initial-rows")).length) return;
      for (let index = 0; index < 5; index += 1) this.addInitialRow();
    }

    refreshLanguage() {
      this.$$(`.elo-initial-row`, this.$("#elo-initial-rows")).forEach((row) => this._localizeRow(row));
      if (this.state.eloGameResult) this._renderHeadToHeadResult();
      if (this.state.eloInitialResult) this._renderInitialResult();
    }

    clearResults() {
      this.state.eloGameResult = null;
      this.state.eloInitialResult = null;
      this.$("#elo-game-result").hidden = true;
      this.$("#elo-initial-result").hidden = true;
    }

    async calculateHeadToHead() {
      const button = this.$("#calculate-elo-game");
      try {
        const body = {
          discipline: this.$("#elo-discipline").value,
          player_a: this._collectHeadToHeadPlayer(this.$("[data-elo-player='a']"), "A"),
          player_b: this._collectHeadToHeadPlayer(this.$("[data-elo-player='b']"), "B"),
        };
        button.disabled = true;
        button.textContent = this.t("elo.consultingFide");
        this.state.eloGameResult = await this.api("/elo/head-to-head", {
          method: "POST",
          body: JSON.stringify(body),
        });
        this._renderHeadToHeadResult();
      } catch (error) {
        this.toast(this.t("elo.calculationError"), error.message, "error", {
          persistent: true
        });
      } finally {
        button.disabled = false;
        button.innerHTML = this.t("elo.calculateChanges");
      }
    }

    async calculateInitial() {
      const button = this.$("#calculate-initial-elo");
      try {
        const body = {
          discipline: this.$("#elo-discipline").value,
          games: this._collectInitialGames(),
        };
        button.disabled = true;
        button.textContent = this.t("elo.consultingHistory");
        this.state.eloInitialResult = await this.api("/elo/initial", {
          method: "POST",
          body: JSON.stringify(body),
        });
        this._renderInitialResult();
      } catch (error) {
        this.toast(this.t("elo.calculationError"), error.message, "error", {
          persistent: true
        });
      } finally {
        button.disabled = false;
        button.innerHTML = this.t("elo.calculateInitial");
      }
    }

    _localizeRow(row) {
      const source = this.$(".elo-row-source", row);
      const result = this.$(".elo-result-select", row);
      source.options[0].textContent = this.t("elo.fideIdShort");
      source.options[1].textContent = this.t("elo.manualRatingShort");
      result.options[0].textContent = this.t("outcome.win");
      result.options[1].textContent = this.t("outcome.draw");
      result.options[2].textContent = this.t("outcome.loss");
      this.$(".elo-row-fide", row).placeholder = this.t("elo.fideIdPlaceholder");
      this.$(".elo-row-rating", row).placeholder = this.t("elo.ratingPlaceholder");
      this.$(".elo-remove-row", row).setAttribute("aria-label", this.t("elo.removeOpponent"));
    }

    _updateRowSource(row) {
      const manual = this.$(".elo-row-source", row).value === "manual";
      this.$(".elo-row-fide", row).hidden = manual;
      this.$(".elo-row-rating", row).hidden = !manual;
    }

    _collectHeadToHeadPlayer(card, label) {
      if (this.$(".elo-source", card).value === "fide") {
        const fideId = this.$(".elo-fide-id", card).value.trim();
        if (!/^\d{5,10}$/.test(fideId)) throw new Error(this.t("elo.invalidPlayerId", {
          player: label
        }));
        return {
          fide_id: fideId
        };
      }
      const rating = Number(this.$(".elo-rating", card).value);
      const k = Number(this.$(".elo-k", card).value);
      if (!Number.isInteger(rating) || rating < 100 || rating > 4000) {
        throw new Error(this.t("elo.invalidManualRating", {
          player: label
        }));
      }
      if (!Number.isInteger(k) || k < 1 || k > 40) {
        throw new Error(this.t("elo.invalidK", {
          player: label
        }));
      }
      return {
        rating,
        k
      };
    }

    _collectInitialGames() {
      const defaultPeriod = this.$("#elo-default-period").value;
      const rows = this.$$(`.elo-initial-row`, this.$("#elo-initial-rows"));
      if (!rows.length) throw new Error(this.t("elo.addOpponentError"));
      return rows.map((row, index) => {
        const source = this.$(".elo-row-source", row).value;
        const period = this.$(".elo-period", row).value || defaultPeriod;
        if (!period) throw new Error(this.t("elo.missingPeriod", {
          row: index + 1
        }));
        const game = {
          result: this.$(".elo-result-select", row).value,
          period
        };
        if (source === "fide") {
          const fideId = this.$(".elo-row-fide", row).value.trim();
          if (!/^\d{5,10}$/.test(fideId)) throw new Error(this.t("elo.invalidOpponentId", {
            row: index + 1
          }));
          game.fide_id = fideId;
        } else {
          const rating = Number(this.$(".elo-row-rating", row).value);
          if (!Number.isInteger(rating) || rating < 100 || rating > 4000) {
            throw new Error(this.t("elo.invalidOpponentRating", {
              row: index + 1
            }));
          }
          game.rating = rating;
        }
        return game;
      });
    }

    _disciplineLabel(value) {
      return ({
        standard: this.t("elo.standard"),
        rapid: this.t("pace.rapid"),
        blitz: this.t("pace.blitz")
      })[value] || value;
    }

    _signedElo(value) {
      const number = Number(value || 0);
      return `${number > 0 ? "+" : ""}${number.toLocaleString(this.currentLocale(), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      })}`;
    }

    _changeClass(value) {
      return Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "neutral";
    }

    _renderHeadToHeadResult(payload = this.state.eloGameResult) {
      if (!payload) return;
      const rows = payload.outcomes.map((outcome) => {
        const label = ({
          a_win: this.t("elo.aWins"),
          draw: this.t("outcome.draw"),
          b_win: this.t("elo.bWins")
        })[outcome.result];
        return `<tr><td>${this.escapeHtml(label)}</td><td class="${this._changeClass(outcome.change_a)}">${this.escapeHtml(this._signedElo(outcome.change_a))}</td><td class="${this._changeClass(outcome.change_b)}">${this.escapeHtml(this._signedElo(outcome.change_b))}</td></tr>`;
      }).join("");
      const expected = payload.rated ?
        this.t("elo.expectedScores", {
          a: this.formatNumber(payload.expected_a * 100),
          b: this.formatNumber(payload.expected_b * 100)
        }) :
        this.t("elo.notRated600");
      const container = this.$("#elo-game-result");
      container.innerHTML =
        `
        <div class="elo-result-head">
          <div><strong>${this.escapeHtml(payload.player_a.name)}</strong><span>${this.escapeHtml(`${payload.player_a.rating} · K ${payload.player_a.k}`)}</span></div>
          <span class="elo-result-versus">${this.escapeHtml(this._disciplineLabel(payload.discipline))}</span>
          <div><strong>${this.escapeHtml(payload.player_b.name)}</strong><span>${this.escapeHtml(`${payload.player_b.rating} · K ${payload.player_b.k}`)}</span></div>
        </div>
        <table><thead><tr><th>${this.escapeHtml(this.t("elo.result"))}</th><th>${this.escapeHtml(this.t("elo.playerA"))}</th><th>${this.escapeHtml(this.t("elo.playerB"))}</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="elo-result-note">${this.escapeHtml(expected)} ${this.escapeHtml(this.t("elo.periodRoundingNote"))}</p>`;
      container.hidden = false;
    }

    _renderInitialResult(payload = this.state.eloInitialResult) {
      if (!payload) return;
      const warnings = payload.warnings.length ?
        `<ul class="elo-warning-list">${payload.warnings.map((warning) => `<li>${this.escapeHtml(warning)}</li>`).join("")}</ul>` :
        `<p class="elo-result-note">${this.escapeHtml(this.t("elo.publishable"))}</p>`;
      const opponents = payload.games.map((game) => {
        const fallback = game.standard_fallback ? ` · ${this.t("elo.standardFallback")}` : "";
        return `<li><strong>${this.escapeHtml(game.name)}</strong><span>${this.escapeHtml(`${game.rating} · ${game.period}`)}</span><span>${this.escapeHtml(this.outcomeLabel(game.result) + fallback)}</span></li>`;
      }).join("");
      const container = this.$("#elo-initial-result");
      container.innerHTML =
        `
        <div class="elo-initial-summary">
          <div class="primary"><span>${this.escapeHtml(this.t("elo.estimatedInitial"))}</span><strong>${this.escapeHtml(payload.initial_rating)}</strong></div>
          <div><span>${this.escapeHtml(this.t("elo.realGames"))}</span><strong>${this.escapeHtml(payload.game_count)}</strong></div>
          <div><span>${this.escapeHtml(this.t("elo.adjustedScore"))}</span><strong>${this.escapeHtml(`${this.formatNumber(payload.adjusted_score)} / ${payload.adjusted_game_count}`)}</strong></div>
          <div><span>${this.escapeHtml(this.t("elo.averageAndDp"))}</span><strong>${this.escapeHtml(`${this.formatNumber(payload.average_rating)} ${payload.dp >= 0 ? "+" : ""}${payload.dp}`)}</strong></div>
        </div>
        ${warnings}
        <ul class="elo-opponent-list">${opponents}<li><strong>${this.escapeHtml(this.t("elo.virtualOpponents"))}</strong><span>1800 + 1800</span><span>${this.escapeHtml(this.t("elo.twoDraws"))}</span></li></ul>`;
      container.hidden = false;
    }
  }

  global.EloCalculatorController = EloCalculatorController;
})(window);
