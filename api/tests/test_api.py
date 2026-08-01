from fastapi.testclient import TestClient

from api.app.main import app
from api.app.models import FidePlayer, GameType, PlayerRef
from api.app.services.pgn import parse_pgn


client = TestClient(app)


def test_health_and_demo_are_available():
    assert client.get("/api/v1/health").json()["status"] == "ok"
    demo = client.get("/api/v1/demo")
    assert demo.status_code == 200
    assert demo.json()["games"] == 12


def test_demo_stats_are_traced_and_consistent():
    response = client.get("/api/v1/players/demo/judit-polgar/stats?mode=combined")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sample_size"] == 12
    assert payload["overall"]["wins"] == 6
    assert payload["overall"]["draws"] == 3
    assert payload["overall"]["losses"] == 3
    assert payload["mode_breakdown"] == {"online": 6, "otb": 6}
    assert payload["sources"] == ["lichess", "pgn_import"]


def test_filters_and_game_traceability():
    response = client.get("/api/v1/players/demo/judit-polgar/games?mode=otb&color=black")
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


def test_import_pgn_deduplicates(monkeypatch):
    import api.app.main as main_module

    monkeypatch.setattr(main_module, "get_fide_player", lambda _: fide_player())
    pgn = """[Event \"Test\"]
[Date \"2026.01.01\"]
[White \"Alice Smith\"]
[Black \"Bob\"]
[Result \"1-0\"]

1. e4 e5 2. Nf3 Nc6 1-0
"""
    response = client.post(
        "/api/v1/datasets",
        json={"pgn": pgn + "\n" + pgn, "fide_id": "1000001", "game_type": "otb"},
    )
    assert response.status_code == 201
    assert len(response.json()["dataset"]["games"]) == 1
    assert response.json()["duplicates"] == 1


def test_imported_otb_games_can_extend_an_online_dossier(monkeypatch):
    import api.app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_fide_player",
        lambda _: fide_player(fide_id="700070", name="Polgar, Judit"),
    )
    demo = client.get("/api/v1/demo").json()
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
            "fide_id": "700070",
            "game_type": "otb",
            "merge_with_dataset_id": demo["dataset_id"],
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["merged_games"] == 1
    assert len(payload["dataset"]["games"]) == 13
    assert payload["dataset"]["player"]["source"] == "combined"
    assert payload["dataset"]["player"]["fide_id"] == "700070"


def test_otb_import_requires_a_fide_id():
    pgn = """[Event "Test"]
[White "Alice Smith"]
[Black "Bob"]
[Result "1-0"]
1. e4 e5 1-0
"""
    response = client.post("/api/v1/datasets", json={"pgn": pgn, "game_type": "otb"})
    assert response.status_code == 422
    assert "ID FIDE" in response.json()["detail"]


def test_otb_import_rejects_games_from_another_player(monkeypatch):
    import api.app.main as main_module

    monkeypatch.setattr(main_module, "get_fide_player", lambda _: fide_player(name="Alice Smith"))
    pgn = """[Event "Test"]
[White "Bob Jones"]
[Black "Carol Brown"]
[Result "1-0"]
1. e4 e5 1-0
"""
    response = client.post(
        "/api/v1/datasets",
        json={"pgn": pgn, "fide_id": "1000001", "game_type": "otb"},
    )
    assert response.status_code == 422
    assert "no contiene partidas verificables" in response.json()["detail"]


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
