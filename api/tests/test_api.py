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
    script = client.get("/app.js").text
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
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["x-xss-protection"] == "0"
    assert client.get("/").headers["cache-control"] == "no-cache"
    assert client.get("/app.js").headers["cache-control"] == "no-cache"
    assert client.get("/api/v1/health").headers["cache-control"] == "no-store"


def test_loader_cycles_all_pieces_without_disabling_its_timer():
    index = client.get("/").text
    script = client.get("/app.js").text

    assert "/app.js?v=20260803-elo-calculator" in index
    assert 'const LOADER_PIECES = ["♙", "♘", "♗", "♖", "♕", "♔"];' in script
    assert "const LOADER_INTERVAL_MS = 450;" in script
    assert "window.setInterval(advanceLoaderPiece, LOADER_INTERVAL_MS)" in script


def test_language_switcher_and_elo_calculator_are_available():
    index = client.get("/").text
    script = client.get("/app.js").text
    translations = client.get("/i18n.js").text

    assert 'id="elo-calculator"' in index
    assert 'id="language-button"' in index
    assert 'id="language-menu"' in index
    assert index.count('data-language="') == 5
    assert "/i18n.js?v=20260803-elo-calculator" in index
    assert 'const STORAGE_KEY = "chessprep_language";' in translations
    assert '{ code: "es"' in translations
    assert '{ code: "en"' in translations
    assert '{ code: "de"' in translations
    assert '{ code: "fr"' in translations
    assert '{ code: "it"' in translations
    assert 'document.addEventListener("chessprep:languagechange", refreshLocalizedInterface)' in script
    assert 'i18n.setLanguage(button.dataset.language)' in script
    assert 'id="elo-dialog"' in index
    assert 'id="elo-panel-game"' in index
    assert 'id="elo-panel-initial"' in index
    assert 'id="elo-default-period" type="month"' in index
    assert 'api("/elo/head-to-head"' in script
    assert 'api("/elo/initial"' in script
    assert 'if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;' not in script


def test_otb_dialog_exposes_info64_search_and_date_filters():
    index = client.get("/").text
    script = client.get("/app.js").text

    assert 'id="search-info64"' in index
    assert 'id="info64-from" type="text"' in index
    assert 'id="info64-to" type="text"' in index
    assert 'placeholder="dd/mm/aaaa"' in index
    assert 'data-info64-period="12m"' in index
    assert 'id="info64-federation-filter"' in index
    assert 'id="info64-opponent-filter"' in index
    assert 'id="info64-clear-filters"' in index
    assert "/info64-results" in script
    assert "safeInfo64Url" in script
    assert "filterInfo64Results" in script
    assert "parseSpanishDate" in script
    assert "normalizeInfo64Opponent" in script


def test_fide_profile_exposes_a_responsive_rating_trend():
    index = client.get("/").text
    script = client.get("/app.js").text
    styles = client.get("/styles.css").text

    assert 'id="fide-rating-trend"' in index
    assert 'id="fide-rating-trend-svg"' in index
    assert 'id="fide-rating-line-standard"' in index
    assert 'id="fide-rating-line-rapid"' in index
    assert 'id="fide-rating-line-blitz"' in index
    assert 'id="fide-rating-delta-standard"' in index
    assert 'id="fide-rating-delta-rapid"' in index
    assert 'id="fide-rating-delta-blitz"' in index
    assert "function renderFideRatingTrend(history)" in script
    assert "player.rating_history" in script
    assert 'key: "rapid_rating"' in script
    assert 'key: "blitz_rating"' in script
    assert ".fide-rating-trend-svg" in styles


def test_pgn_import_is_independent_and_can_be_cleared():
    index = client.get("/").text
    script = client.get("/app.js").text

    assert 'id="importar-pgn"' in index
    assert 'id="manual-import"' not in index
    assert 'id="open-import-bottom"' not in index
    assert 'id="remove-pgn-file"' in index
    assert 'id="pgn-import-status" aria-live="polite"' in index
    assert 'lowerName.endsWith(".txt")' in script
    assert "function clearPgnFile()" in script
    assert 'addEventListener("click", clearPgnFile)' in script
    assert "state.fideProfile?.fide_id" not in script[script.index("function updateImportReady"):script.index("function safeInfo64Url")]


def test_header_is_clean_and_online_otb_searches_have_equal_modes():
    index = client.get("/").text
    script = client.get("/app.js").text

    assert 'class="main-nav"' not in index
    assert 'id="menu-button"' not in index
    assert 'class="search-mode-tabs"' in index
    assert 'data-search-mode="online"' in index
    assert 'data-search-mode="otb"' in index
    assert 'id="hero-otb-search"' in index
    assert 'id="hero-fide-id"' in index
    assert 'id="importar-pgn"' in index
    assert "#menu-button" not in script
    assert "selectHeroSearchMode" in script
    assert "submitHeroOtbSearch" in script


def test_game_result_badges_keep_their_layout_and_use_stable_color_markers():
    script = client.get("/app.js").text
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
