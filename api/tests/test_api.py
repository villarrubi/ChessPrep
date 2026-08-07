from fastapi.testclient import TestClient

from api.app.main import app
from api.app.models import FidePlayer, GameType, Info64Result, PlayerRef
from api.app.services.pgn import parse_pgn


client = TestClient(app)


def test_health_and_demo_are_available():
    assert client.get("/api/v1/health").json()["status"] == "ok"
    demo = client.get("/api/v1/demo")
    assert demo.status_code == 200
    assert demo.json()["games"] == 12
    assert demo.json()["player"]["display_name"] == "Jugador de muestra"


def test_demo_is_synthetic_and_only_loads_after_an_explicit_action():
    index = client.get("/").text
    script = client.get("/js/dossierController.js").text
    translations = client.get("/i18n.js").text
    games = client.get("/api/v1/players/demo/jugador-muestra/games?mode=combined&page_size=20").json()["items"]

    assert 'id="analisis" aria-live="polite" hidden' in index
    assert 'id="partidas" hidden' in index
    assert "Ver ejemplo ficticio" in index
    assert "loadDemo(false)" not in script
    assert 't("toast.demoLoaded")' in script
    assert '"toast.demoLoaded": "Ejemplo ficticio cargado"' in translations
    assert all(game["source"] == "demo" for game in games)
    assert all(game["source_confidence"] == "synthetic" for game in games)


def test_security_headers_are_applied_to_api_and_web():
    for path in ("/", "/api/v1/health"):
        response = client.get(path)
        assert response.status_code == 200
        assert "default-src 'self'" in response.headers["content-security-policy"]
        assert "script-src 'self' 'wasm-unsafe-eval'" in response.headers["content-security-policy"]
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["x-xss-protection"] == "0"
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/app.js").headers["cache-control"] == "no-cache"
    assert client.get("/api/v1/health").headers["cache-control"] == "no-store"


def test_frontend_feature_modules_are_served():
    modules = (
        "dossierController.js",
        "eloCalculator.js",
        "gameViewerController.js",
        "otbController.js",
        "pgnImportController.js",
    )

    for module in modules:
        response = client.get(f"/js/{module}")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-cache"
        assert response.text.startswith('"use strict";')


def test_stockfish_18_lite_worker_and_wasm_are_served_locally():
    engine_script = client.get("/js/stockfishEngine.js").text
    worker = client.get("/vendor/stockfish/stockfish-18-lite-single.js")
    wasm = client.get("/vendor/stockfish/stockfish-18-lite-single.wasm")

    assert worker.status_code == 200
    assert "Stockfish.js 18" in worker.text[:500]
    assert wasm.status_code == 200
    assert len(wasm.content) == 7_295_411
    assert wasm.headers["content-type"].startswith("application/wasm")
    assert client.get("/vendor/stockfish/stockfish.js").status_code == 404
    assert 'const WORKER_URL = "/vendor/stockfish/stockfish-18-lite-single.js"' in engine_script
    assert 'const ENGINE_VERSION = "18-lite-single-18.0.8"' in engine_script
    assert 'const ENGINE_CACHE_NAMESPACE = `stockfish-${ENGINE_VERSION}`' in engine_script
    assert 'global.STOCKFISH_ENGINE_NAME = "Stockfish 18 Lite"' in engine_script
    assert 'global.STOCKFISH_DEFAULT_NODES = DEFAULT_NODES' in engine_script
    assert "const STRENGTH_PRESETS = Object.freeze({" in engine_script
    assert 'id="analysis-strength"' in client.get("/").text
    assert 'option value="fast"' in client.get("/").text
    assert 'option value="normal"' in client.get("/").text
    assert 'option value="deep"' in client.get("/").text
    assert 'id="analysis-nodes"' not in client.get("/").text


def test_loader_cycles_all_pieces_without_disabling_its_timer():
    index = client.get("/").text
    script = client.get("/app.js").text

    assert "/app.js?v=20260807-best-blue" in index
    assert 'const LOADER_PIECES = ["♙", "♘", "♗", "♖", "♕", "♔"];' in script
    assert "const LOADER_INTERVAL_MS = 450;" in script
    assert "window.setInterval(advanceLoaderPiece, LOADER_INTERVAL_MS)" in script


def test_language_switcher_and_elo_calculator_are_available():
    index = client.get("/").text
    app_script = client.get("/app.js").text
    elo_script = client.get("/js/eloCalculator.js").text
    translations = client.get("/i18n.js").text

    assert 'id="elo-calculator"' in index
    assert 'id="language-button"' in index
    assert 'id="language-menu"' in index
    assert index.count('data-language="') == 5
    assert "/i18n.js?v=20260807-best-blue" in index
    assert 'const STORAGE_KEY = "chessprep_language";' in translations
    assert '{ code: "es"' in translations
    assert '{ code: "en"' in translations
    assert '{ code: "de"' in translations
    assert '{ code: "fr"' in translations
    assert '{ code: "it"' in translations
    assert 'document.addEventListener("chessprep:languagechange", refreshLocalizedInterface)' in app_script
    assert 'i18n.setLanguage(button.dataset.language)' in app_script
    assert 'id="elo-dialog"' in index
    assert 'id="elo-panel-game"' in index
    assert 'id="elo-panel-initial"' in index
    assert 'id="elo-default-period" type="month"' in index
    assert 'this.api("/elo/head-to-head"' in elo_script
    assert 'this.api("/elo/initial"' in elo_script
    assert 'if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;' not in app_script


def test_otb_dialog_exposes_info64_search_and_date_filters():
    index = client.get("/").text
    script = client.get("/js/otbController.js").text

    assert 'id="search-info64"' in index
    assert 'id="info64-from" type="text"' in index
    assert 'id="info64-to" type="text"' in index
    assert 'placeholder="dd/mm/aaaa"' in index
    assert 'data-info64-period="12m"' in index
    assert 'id="info64-federation-filter"' in index
    assert 'id="info64-opponent-filter"' in index
    assert 'id="info64-clear-filters"' in index
    assert "/info64-results" in script
    assert "_safeInfo64Url" in script
    assert "_filterResults" in script
    assert "_parseDate" in script
    assert "_normalizeOpponent" in script


def test_fide_profile_exposes_a_responsive_rating_trend():
    index = client.get("/").text
    script = client.get("/js/otbController.js").text
    styles = client.get("/styles.css").text

    assert 'id="fide-rating-trend"' in index
    assert 'id="fide-rating-trend-svg"' in index
    assert 'id="fide-rating-line-standard"' in index
    assert 'id="fide-rating-line-rapid"' in index
    assert 'id="fide-rating-line-blitz"' in index
    assert 'id="fide-rating-delta-standard"' in index
    assert 'id="fide-rating-delta-rapid"' in index
    assert 'id="fide-rating-delta-blitz"' in index
    assert "renderRatingTrend(history)" in script
    assert "player.rating_history" in script
    assert 'key: "rapid_rating"' in script
    assert 'key: "blitz_rating"' in script
    assert ".fide-rating-trend-svg" in styles


def test_pgn_import_is_independent_and_can_be_cleared():
    index = client.get("/").text
    script = client.get("/js/pgnImportController.js").text

    assert 'id="importar-pgn"' in index
    assert 'id="manual-import"' not in index
    assert 'id="open-import-bottom"' not in index
    assert 'id="remove-pgn-file"' in index
    assert 'id="pgn-import-status" aria-live="polite"' in index
    assert 'lowerName.endsWith(".txt")' in script
    assert "clear()" in script
    assert 'addEventListener("click", () => this.clear())' in script
    assert "state.fideProfile?.fide_id" not in script


def test_header_is_clean_and_online_otb_searches_have_equal_modes():
    index = client.get("/").text
    app_script = client.get("/app.js").text
    dossier_script = client.get("/js/dossierController.js").text
    otb_script = client.get("/js/otbController.js").text

    assert 'class="main-nav"' not in index
    assert 'id="menu-button"' not in index
    assert 'class="search-mode-tabs"' in index
    assert 'data-search-mode="online"' in index
    assert 'data-search-mode="otb"' in index
    assert 'id="hero-otb-search" role="search" novalidate' in index
    assert 'id="hero-fide-id"' in index
    assert 'pattern="[0-9]{5,10}"' not in index
    assert 'id="importar-pgn"' in index
    assert "#menu-button" not in app_script
    assert "selectHeroSearchMode" in dossier_script
    assert "submitHeroSearch" in otb_script
    assert 'replace(/\\s+/g, "")' in otb_script


def test_game_viewer_owns_its_fen_parser_and_loading_dependency():
    app_script = client.get("/app.js").text
    viewer_script = client.get("/js/gameViewerController.js").text
    dossier_script = client.get("/js/dossierController.js").text

    assert "function parseFen(fen)" in viewer_script
    assert "function parseFen(fen)" not in dossier_script
    assert "setLoading = dependencies.setLoading" in viewer_script
    viewer_start = app_script.index("viewerController = new GameViewerController({")
    viewer_end = app_script.index("dossierController = new DossierController({")
    assert "setLoading," in app_script[viewer_start:viewer_end]


def test_manual_moves_are_draggable_and_use_an_independent_engine():
    index = client.get("/").text
    viewer_script = client.get("/js/gameViewerController.js").text
    explore_script = client.get("/js/exploreMode.js").text
    engine_script = client.get("/js/stockfishEngine.js").text
    translations = client.get("/i18n.js").text
    styles = client.get("/styles.css").text

    assert "/js/exploreMode.js?v=20260807-best-blue" in index
    assert 'id="explore-toggle"' not in index
    assert "exploreEngine = new global.StockfishEngine()" in viewer_script
    assert "new global.ExploreMode(exploreEngine)" in viewer_script
    assert "await initializeInteractiveBoard()" in viewer_script
    assert "onMove: handleManualMove" in viewer_script
    assert "if (!state.analysisEnabled) setAnalysisEnabled(true)" in viewer_script
    assert "toggleExploreMode" not in viewer_script
    assert "bindExploreBoardEvents()" in viewer_script
    assert 'draggable="true"' in viewer_script
    assert "const PLAYBACK_INTERVAL_MS = 1100;" in viewer_script
    assert "}, PLAYBACK_INTERVAL_MS);" in viewer_script
    assert '<span class="board-piece"${draggable}>' in viewer_script
    assert 'event.target.closest(".board-piece")' in viewer_script
    assert "movePiece(from, to)" in explore_script
    assert "setPosition(fen, ply)" in explore_script
    assert 'typeof this.onMove === "function"' in explore_script
    assert "this.analyzing) return" not in explore_script
    assert "this.tries = []" in explore_script
    assert "this.tries.push(entry)" in explore_script
    assert "async _drainEvaluationQueue()" in explore_script
    assert "const evaluationId = ++this.evaluationId" in explore_script
    assert "formatManualTryLine(entry, index)" in viewer_script
    assert "tries.map((entry, index) => formatManualTryLine(entry, index))" in viewer_script
    assert "this._initPromise === guardedPromise" in engine_script
    assert '"analysis.manualHint"' in translations
    assert "valora cada una del historial" in translations
    assert ".manual-try" in styles
    assert "--judgment-best:" in styles
    assert "--judgment-excellent:" in styles
    assert "--judgment-good:" in styles
    assert "manual-try.best" in styles
    assert '.board-square.drag-over' in styles
    assert '.board-piece[draggable="true"]' in styles
    assert '.board-square[draggable="true"]' not in styles


def test_stockfish_recommendation_and_manual_grading_share_one_reference():
    viewer_script = client.get("/js/gameViewerController.js").text
    engine_script = client.get("/js/stockfishEngine.js").text
    analysis_script = client.get("/js/gameAnalysis.js").text
    quality_script = client.get("/js/moveQuality.js").text
    translations = client.get("/i18n.js").text

    assert 'best: "★"' in quality_script
    assert 'excellent: "!"' in quality_script
    assert 'good: "✓"' in quality_script
    assert "const positionCache = new Map()" in engine_script
    assert "const pendingSearches = new Map()" in engine_script
    assert "return runSharedSearch(cacheKey" in engine_script
    assert "go nodes ${safeNodes} searchmoves ${safeMove}" in engine_script
    assert "go searchmoves ${safeMove} nodes ${safeNodes}" not in engine_script
    assert 'this._post("setoption name Clear Hash")' in engine_script
    assert "await this._syncPosition(fen)" in engine_script
    assert "if (!sawSearchInfo && move !== \"(none)\") return false" in engine_script
    assert "position fen ${fen} moves ${moveUci}" not in engine_script
    assert "function mergeReferenceLines" in viewer_script
    assert "engine.analyzeFen(fen, { nodes, multipv: 1 })" in viewer_script
    assert "mergeReferenceLines(fen, reference, alternatives, multipv)" in viewer_script
    assert "state.analysis?.plies?.[state.ply - 1]?.bestUci" not in viewer_script
    assert 't("analysis.bestLine")' in viewer_script
    assert '"analysis.bestLine": "Mejor línea"' in translations
    assert '"viewer.strength": "Fuerza"' in translations
    assert '"viewer.strengthFast": "Rápido"' in translations
    assert '"dynamic.engineReady": "Listo · {strength} · {count} {lines}"' in translations
    assert '"viewer.nodes": "Nodos (k)"' not in translations
    assert "MoveQuality.winChanceLoss(best.score, playedScoreStm)" in analysis_script
    assert "MoveQuality.classifyWinLoss(winLoss" in analysis_script
    assert "function accuracyFromWinLosses" in quality_script


def test_game_viewer_is_a_fullscreen_workspace_with_independent_panels():
    index = client.get("/").text
    styles = client.get("/styles.css").text
    viewer_script = client.get("/js/gameViewerController.js").text

    assert '<div class="viewer-backdrop" id="viewer-dialog" hidden>' in index
    assert 'class="dialog-backdrop viewer-backdrop"' not in index
    assert '<section class="viewer-screen" role="region"' in index
    assert 'class="viewer-body"' in index
    assert 'class="viewer-moves-pane"' in index
    assert 'id="viewer-analysis-title"' in index
    assert 'id="eval-curve" width="480" height="72"' in index
    assert 'class="viewer-scroll-area"' not in index
    board_start = index.index('class="viewer-board-column"')
    controls = index.index('class="viewer-controls"')
    info_start = index.index('class="viewer-info"')
    assert board_start < controls < info_start
    assert ".viewer-screen { width: 100%; height: 100dvh;" in styles
    assert "#viewer-dialog.analysis-on .viewer-info" in styles
    assert ".viewer-moves-pane { overflow: hidden;" in styles
    assert ".analysis-body { min-height: 0;" in styles
    assert '`${game.white} — ${game.black}`' in viewer_script
    assert '`${game.target_player} — ${opponent}`' not in viewer_script
    assert 'fillEvaluationArea("rgba(211, 169, 73, .34)", 0, middle)' in viewer_script
    assert 'fillEvaluationArea("rgba(16, 35, 31, .24)", middle, height)' in viewer_script
    assert 'ctx.fillText("♙", 6, 11)' in viewer_script
    assert 'ctx.fillText("♟", 6, height - 11)' in viewer_script


def test_game_result_badges_keep_their_layout_and_use_stable_color_markers():
    script = client.get("/js/dossierController.js").text
    styles = client.get("/styles.css").text

    assert 'class="game-player-meta"' in script
    assert 'class="game-color-icon ${game.player_color}"' in script
    assert ".game-players > .game-result" in styles
    assert ".game-player-meta" in styles


def test_pgn_import_excludes_non_standard_variants():
    standard = """[Event "Standard"]
[White "Target"]
[Black "Opponent"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 1-0
"""
    chess960 = standard.replace(
        '[Event "Standard"]', '[Event "Chess960"]\n[Variant "Chess960"]'
    )
    crazyhouse = standard.replace(
        '[Event "Standard"]', '[Event "Crazyhouse"]\n[Variant "Crazyhouse"]'
    )
    custom_position = standard.replace(
        '[Event "Standard"]',
        '[Event "Custom position"]\n[SetUp "1"]\n[FEN "8/8/8/8/8/8/4K3/7k w - - 0 1"]',
    )

    parsed = parse_pgn(
        "\n\n".join((standard, chess960, crazyhouse, custom_position)),
        source="upload",
        game_type=GameType.ONLINE,
        target_player="Target",
    )

    assert len(parsed.games) == 1
    assert "Chess960" in parsed.errors[-1]
    assert "Crazyhouse" in parsed.errors[-1]
    assert "Posición inicial no estándar" in parsed.errors[-1]
    assert "Se omitieron 3 partidas" in parsed.errors[-1]


def test_untrusted_host_and_oversized_request_are_rejected():
    invalid_host = client.get("/api/v1/health", headers={"host": "attacker.example"})
    assert invalid_host.status_code == 400

    oversized = client.post(
        "/api/v1/datasets",
        content=b"{}",
        headers={"content-type": "application/json", "content-length": "6000001"},
    )
    assert oversized.status_code == 413
    assert oversized.headers["x-content-type-options"] == "nosniff"


def test_demo_stats_are_traced_and_consistent():
    response = client.get("/api/v1/players/demo/jugador-muestra/stats?mode=combined")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sample_size"] == 12
    assert payload["overall"]["wins"] == 6
    assert payload["overall"]["draws"] == 3
    assert payload["overall"]["losses"] == 3
    assert payload["mode_breakdown"] == {"online": 6, "otb": 6}
    assert payload["sources"] == ["demo"]


def test_filters_and_game_traceability():
    response = client.get("/api/v1/players/demo/jugador-muestra/games?mode=otb&color=black")
    payload = response.json()
    assert response.status_code == 200
    assert payload["total"] == 3
    assert all(game["game_type"] == "otb" for game in payload["items"])
    game = payload["items"][0]
    detail = client.get(f"/api/v1/games/{game['source']}/{game['id']}")
    assert detail.status_code == 200
    assert len(detail.json()["fens"]) == len(detail.json()["moves"]) + 1


def fide_player(fide_id="1000001", name="Alice Smith"):
    return FidePlayer(
        fide_id=fide_id,
        name=name,
        federation="España",
        title="GM",
        standard_rating=2400,
        rapid_rating=2350,
        blitz_rating=2300,
        profile_url=f"https://ratings.fide.com/profile/{fide_id}",
    )


def test_fide_player_endpoint_returns_the_verified_profile(monkeypatch):
    import api.app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_fide_player",
        lambda fide_id, **_: fide_player(fide_id, "Alejandro Villarrubia"),
    )

    response = client.get("/api/v1/fide/players/94711151")

    assert response.status_code == 200
    assert response.json()["fide_id"] == "94711151"
    assert response.json()["name"] == "Alejandro Villarrubia"


def test_info64_endpoint_returns_statistics_and_validates_dates(monkeypatch):
    import api.app.main as main_module

    monkeypatch.setattr(main_module, "get_fide_player", lambda _, **__: fide_player())
    result = Info64Result(
        id="result-1",
        fide_id="1000001",
        player_name="Alice Smith",
        opponent_name="Bob",
        opponent_fide_id="2000002",
        opponent_rating=2200,
        color="white",
        outcome="win",
        score=1,
        result="1",
        round="3",
        date="2026-04-02",
        date_precision="round",
        tournament="Open 2026",
        tournament_url="https://info64.org/open-2026",
        player_url="https://info64.org/open-2026/alice",
    )
    monkeypatch.setattr(
        main_module,
        "fetch_info64_results",
        lambda *_, **__: {
            "results": [result],
            "warnings": [],
            "source_url": "https://info64.org/search-player?name=Alice",
            "tournaments_scanned": 1,
            "tournaments_matched": 1,
        },
    )

    response = client.get(
        "/api/v1/fide/players/1000001/info64-results?from=2026-01-01&to=2026-12-31"
    )
    assert response.status_code == 200
    assert response.json()["summary"] == {
        "games": 1,
        "wins": 1,
        "draws": 0,
        "losses": 0,
        "score_percentage": 100.0,
        "opponents": 1,
        "tournaments": 1,
        "walkovers": 0,
        "date_range": {"from": "2026-04-02", "to": "2026-04-02"},
    }
    invalid = client.get(
        "/api/v1/fide/players/1000001/info64-results?from=2027-01-01&to=2026-01-01"
    )
    assert invalid.status_code == 422


def test_import_pgn_deduplicates_without_fide_identity():
    pgn = """[Event \"Test\"]
[Date \"2026.01.01\"]
[White \"Alice Smith\"]
[Black \"Bob\"]
[Result \"1-0\"]

1. e4 e5 2. Nf3 Nc6 1-0
"""
    response = client.post(
        "/api/v1/datasets",
        json={"pgn": pgn + "\n" + pgn, "game_type": "otb"},
    )
    assert response.status_code == 201
    assert len(response.json()["dataset"]["games"]) == 1
    assert response.json()["duplicates"] == 1
    assert response.json()["dataset"]["player"]["display_name"] == "Alice Smith"
    assert response.json()["dataset"]["player"]["fide_id"] is None


def test_imported_markup_remains_plain_json_data():
    payload = "<img src=x onerror=alert(1)>"
    pgn = f'''[Event "{payload}"]
[White "Alice Smith"]
[Black "<svg onload=alert(2)>"]
[Result "1-0"]

1. e4 e5 1-0
'''
    response = client.post(
        "/api/v1/datasets",
        json={"pgn": pgn, "game_type": "otb"},
    )
    assert response.status_code == 201
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["x-content-type-options"] == "nosniff"
    game = response.json()["dataset"]["games"][0]
    assert game["event"] == payload
    assert game["black"] == "<svg onload=alert(2)>"


def test_imported_pgn_creates_an_independent_dossier():
    pgn = """[Event "Local OTB"]
[Date "2026.08.01"]
[White "Judit Polgar"]
[Black "Club Player"]
[Result "1-0"]
1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 1-0
"""
    response = client.post(
        "/api/v1/datasets",
        json={
            "pgn": pgn,
            "game_type": "otb",
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["merged_games"] == 1
    assert len(payload["dataset"]["games"]) == 1
    assert payload["dataset"]["player"]["source"] == "pgn_import"
    assert payload["dataset"]["player"]["display_name"] == "Judit Polgar"
    assert payload["dataset"]["player"]["fide_id"] is None
    external_id = payload["dataset"]["player"]["external_id"]
    assert client.get(f"/api/v1/players/pgn_import/{external_id}").status_code == 200
    assert client.get(f"/api/v1/players/pgn_import/{external_id}/stats").json()["sample_size"] == 1


def test_pgn_import_infers_the_most_frequent_player_and_both_colors():
    pgn = """[Event "Round 1"]
[White "Opponent One"]
[Black "Main Player"]
[Result "0-1"]
1. e4 e5 0-1

[Event "Round 2"]
[White "Main Player"]
[Black "Opponent Two"]
[Result "1-0"]
1. d4 d5 1-0
"""
    response = client.post("/api/v1/datasets", json={"pgn": pgn, "game_type": "otb"})

    assert response.status_code == 201
    payload = response.json()["dataset"]
    assert payload["player"]["display_name"] == "Main Player"
    assert {game["player_color"] for game in payload["games"]} == {"white", "black"}


def test_pgn_import_does_not_require_a_fide_id():
    pgn = """[Event "Test"]
[White "Alice Smith"]
[Black "Bob"]
[Result "1-0"]
1. e4 e5 1-0
"""
    response = client.post("/api/v1/datasets", json={"pgn": pgn, "game_type": "otb"})
    assert response.status_code == 201
    assert response.json()["dataset"]["player"]["display_name"] == "Alice Smith"


def test_pgn_import_accepts_names_without_fide_matching():
    pgn = """[Event "Test"]
[White "Bob Jones"]
[Black "Carol Brown"]
[Result "1-0"]
1. e4 e5 1-0
"""
    response = client.post(
        "/api/v1/datasets",
        json={"pgn": pgn, "game_type": "otb"},
    )
    assert response.status_code == 201
    assert response.json()["dataset"]["player"]["display_name"] == "Bob Jones"


def test_combined_profiles_merge_sources(monkeypatch):
    import api.app.main as main_module

    pgn_lichess = """[Event "Online"]
[Date "2026.07.01"]
[White "DualUser"]
[Black "One"]
[Result "1-0"]
1. e4 e5 2. Nf3 Nc6 1-0
"""
    pgn_chesscom = """[Event "Online"]
[Date "2026.07.02"]
[White "Two"]
[Black "OtherAlias"]
[Result "0-1"]
1. d4 d5 2. c4 e6 0-1
"""
    lichess_player = PlayerRef(
        source="lichess", external_id="dualuser", username="DualUser",
        display_name="Dual User", game_type=GameType.ONLINE,
    )
    chesscom_player = PlayerRef(
        source="chess.com", external_id="otheralias", username="OtherAlias",
        display_name="Dual User", game_type=GameType.ONLINE,
    )
    monkeypatch.setattr(main_module, "get_lichess_player", lambda _: lichess_player)
    monkeypatch.setattr(main_module, "get_chesscom_player", lambda _: chesscom_player)
    monkeypatch.setattr(
        main_module, "fetch_lichess_games",
        lambda *_, **__: parse_pgn(pgn_lichess, source="lichess", game_type=GameType.ONLINE, target_player="DualUser", confidence="official"),
    )
    monkeypatch.setattr(
        main_module, "fetch_chesscom_games",
        lambda *_, **__: parse_pgn(pgn_chesscom, source="chess.com", game_type=GameType.ONLINE, target_player="OtherAlias", confidence="official"),
    )

    response = client.post(
        "/api/v1/players/combined",
        json={"lichess_username": "DualUser", "chesscom_username": "OtherAlias"},
    )
    assert response.status_code == 200
    dataset = response.json()["dataset"]
    assert dataset["player"]["source"] == "combined"
    assert dataset["sources"] == ["chess.com", "lichess"]
    assert len(dataset["games"]) == 2
    assert [game["date"] for game in dataset["games"]] == ["2026-07-02", "2026-07-01"]

    games = client.get(
        f"/api/v1/players/combined/{dataset['player']['external_id']}/games?page_size=250"
    )
    assert games.status_code == 200
    assert [game["date"] for game in games.json()["items"]] == [
        "2026-07-02",
        "2026-07-01",
    ]
