from fastapi.testclient import TestClient

from api.app.main import app


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


def test_import_pgn_deduplicates():
    pgn = """[Event \"Test\"]
[Date \"2026.01.01\"]
[White \"Alice\"]
[Black \"Bob\"]
[Result \"1-0\"]

1. e4 e5 2. Nf3 Nc6 1-0
"""
    response = client.post(
        "/api/v1/datasets",
        json={"pgn": pgn + "\n" + pgn, "target_player": "Alice", "game_type": "otb"},
    )
    assert response.status_code == 201
    assert len(response.json()["dataset"]["games"]) == 1
    assert response.json()["duplicates"] == 1

