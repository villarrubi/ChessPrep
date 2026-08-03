"use strict";

(function(global) {
  const MAX_PGN_BYTES = 5_000_000;

  class PgnImportController {
    constructor({
      state,
      api,
      toast,
      setLoading,
      loadPlayer,
      t,
      currentLocale,
      $,
      $$
    }) {
      this.state = state;
      this.api = api;
      this.toast = toast;
      this.setLoading = setLoading;
      this.loadPlayer = loadPlayer;
      this.t = t;
      this.currentLocale = currentLocale;
      this.$ = $;
      this.$$ = $$;
    }

    bindEvents() {
      this.$("#pgn-file").addEventListener("change", (event) => this.readFile(event.target.files[0]));
      this.$("#remove-pgn-file").addEventListener("click", () => this.clear());
      this.$("#submit-import").addEventListener("click", () => this.submit());
      const dropZone = this.$("#drop-zone");
      ["dragenter", "dragover"].forEach((name) => {
        dropZone.addEventListener(name, (event) => {
          event.preventDefault();
          dropZone.classList.add("dragging");
        });
      });
      ["dragleave", "drop"].forEach((name) => {
        dropZone.addEventListener(name, (event) => {
          event.preventDefault();
          dropZone.classList.remove("dragging");
        });
      });
      dropZone.addEventListener("drop", (event) => this.readFile(event.dataTransfer.files[0]));
    }

    async readFile(file) {
      if (!file) return;
      const lowerName = file.name.toLowerCase();
      const compatible = lowerName.endsWith(".pgn") || lowerName.endsWith(".txt") || ["application/x-chess-pgn",
        "text/plain"
      ].includes(file.type);
      if (!compatible) {
        this.clear();
        this.toast(this.t("toast.fileType"), this.t("toast.fileTypeMessage"), "error");
        return;
      }
      if (file.size > MAX_PGN_BYTES) {
        this.clear();
        this.toast(this.t("toast.fileSize"), this.t("toast.fileSizeMessage"), "error");
        return;
      }
      const contents = await file.text();
      if (contents.trim().length < 8) {
        this.clear();
        this.toast(this.t("toast.emptyPgn"), this.t("toast.emptyPgnMessage"), "error");
        return;
      }
      this.state.pgnText = contents;
      this.$("#selected-file").hidden = false;
      this.$("#selected-file-label").textContent =
        `✓ ${file.name} · ${(file.size / 1024).toLocaleString(this.currentLocale(), { maximumFractionDigits: 1 })} KB`;
      this.updateReady();
    }

    clear() {
      this.state.pgnText = "";
      this.$("#pgn-file").value = "";
      this.$("#selected-file-label").textContent = "";
      this.$("#selected-file").hidden = true;
      this.updateReady();
    }

    updateReady() {
      const hasPgn = this.state.pgnText.trim().length >= 8;
      const button = this.$("#submit-import");
      const status = this.$("#pgn-import-status");
      button.disabled = !hasPgn;
      status.textContent = this.t(hasPgn ? "pgn.readyStatus" : "pgn.selectStatus");
      button.title = hasPgn ? this.t("pgn.processTitle") : status.textContent;
    }

    async submit() {
      if (!this.state.pgnText) return;
      this.setLoading(true, this.t("loading.processingPgn"));
      try {
        const result = await this.api("/datasets", {
          method: "POST",
          body: JSON.stringify({
            pgn: this.state.pgnText,
            game_type: "otb"
          }),
        });
        this.state.pace = "global";
        this.$$('[data-pace]').forEach((button) => {
          button.classList.toggle("active", button.dataset.pace === "global");
        });
        await this.loadPlayer(result.dataset.player, {
          scroll: true
        });
        const duplicateNote = result.duplicates ?
          this.t("pgn.duplicates", {
            count: result.duplicates
          }) :
          "";
        this.toast(
          this.t("toast.pgnProcessed"),
          this.t("toast.pgnProcessedMessage", {
            count: result.dataset.games.length,
            duplicates: duplicateNote,
          }),
        );
        this.clear();
        if (result.warnings?.length) {
          this.toast(
            this.t("toast.pgnWarnings"),
            result.warnings.join(" "),
            "warning", {
              persistent: true
            },
          );
        }
      } catch (error) {
        this.setLoading(false);
        this.toast(this.t("toast.pgnError"), error.message, "error");
      }
    }
  }

  global.PgnImportController = PgnImportController;
})(window);
