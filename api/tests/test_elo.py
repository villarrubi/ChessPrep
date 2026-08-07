import io
import zipfile

from fastapi.testclient import TestClient

from api.app import main as main_module
from api.app.main import app
from api.app.models import EloDiscipline, FidePlayer, FideRatingPoint
from api.app.providers import fide
from api.app.services.elo import calculate_head_to_head, calculate_initial_rating


client = TestClient(app)


def test_head_to_head_uses_official_fide_probability_table():
    calculation = calculate_head_to_head(1800, 20, 2000, 20, EloDiscipline.STANDARD)

    assert calculation["rated"] is True
    assert calculation["expected_a"] == 0.24
    assert calculation["expected_b"] == 0.76
    assert calculation["outcomes"] == [
        {"result": "a_win", "change_a": 15.2, "change_b": -15.2},
        {"result": "draw", "change_a": 5.2, "change_b": -5.2},
        {"result": "b_win", "change_a": -4.8, "change_b": 4.8},
    ]


def test_current_standard_and_rapid_blitz_difference_rules_are_separate():
    standard = calculate_head_to_head(2700, 10, 2200, 20, EloDiscipline.STANDARD)
    rapid = calculate_head_to_head(2650, 10, 2050, 20, EloDiscipline.RAPID)

    assert standard["rated"] is True
    assert standard["expected_a"] == 0.96
    assert standard["expected_b"] == 0.08
    assert rapid["rated"] is False
    assert all(row["change_a"] == row["change_b"] == 0 for row in rapid["outcomes"])


def test_initial_rating_includes_two_virtual_1800_draws():
    games = [
        {"rating": 1600, "score": 1.0 if index == 0 else 0.0, "period": "2026-08"}
        for index in range(6)
    ]

    calculation = calculate_initial_rating(games)

    assert calculation["adjusted_score"] == 2.0
    assert calculation["adjusted_game_count"] == 8
    assert calculation["average_rating"] == 1650.0
    assert calculation["dp"] == -193
    assert calculation["initial_rating"] == 1457
    assert calculation["publishable"] is True


def test_current_fide_list_parser_reads_rating_and_k(monkeypatch):
    header = "ID Number      Name                                                         Fed Sex Tit  WTit OTit           FOA AUG26 Gms K  B-day Flag\n"
    line = "94711151       Villarrubia Garcia, Alejandro                                ESP M                                1551  0   40 2003      \n"
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("standard_rating_list.txt", header + line)
    monkeypatch.setattr(fide, "_download_rating_list", lambda _: archive_buffer.getvalue())

    assert fide.get_current_rating_data(["94711151"], EloDiscipline.STANDARD) == {
        "94711151": {"rating": 1551, "k": 40}
    }


def test_historical_rapid_rating_uses_zero_when_missing(monkeypatch):
    monkeypatch.setattr(
        fide,
        "_get_rating_history",
        lambda *_, **__: [
            FideRatingPoint(date="2025-Jan", rating=1712, rapid_rating=None, blitz_rating=None)
        ],
    )

    result = fide.get_historical_rating("94711151", EloDiscipline.RAPID, "2025-01")

    assert result["rating"] == 0
    assert result["rating_source"] == "rapid"
    assert result["standard_fallback"] is False


def test_historical_blitz_rating_uses_zero_when_missing(monkeypatch):
    monkeypatch.setattr(
        fide,
        "_get_rating_history",
        lambda *_, **__: [
            FideRatingPoint(date="2025-Jan", rating=1712, rapid_rating=None, blitz_rating=None)
        ],
    )

    result = fide.get_historical_rating("94711151", EloDiscipline.BLITZ, "2025-01")

    assert result["rating"] == 0
    assert result["rating_source"] == "blitz"
    assert result["standard_fallback"] is False


def test_historical_standard_rating_stays_none_when_missing(monkeypatch):
    monkeypatch.setattr(
        fide,
        "_get_rating_history",
        lambda *_, **__: [
            FideRatingPoint(date="2025-Jan", rating=None, rapid_rating=1500, blitz_rating=1400)
        ],
    )

    result = fide.get_historical_rating("94711151", EloDiscipline.STANDARD, "2025-01")

    assert result["rating"] is None
    assert result["rating_source"] == "standard"
    assert result["standard_fallback"] is False


def test_initial_rating_treats_missing_rapid_as_zero():
    games = [
        {"rating": 1600 if index else 0, "score": 1.0, "period": "2026-08"}
        for index in range(5)
    ]

    calculation = calculate_initial_rating(games)

    # Average includes the 0-rated opponent instead of a standard-Elo substitute.
    assert calculation["average_rating"] == 1428.57
    assert calculation["game_count"] == 5


def test_manual_elo_endpoints_return_both_calculations():
    versus = client.post(
        "/api/v1/elo/head-to-head",
        json={
            "discipline": "standard",
            "player_a": {"rating": 1800, "k": 20},
            "player_b": {"rating": 2000, "k": 20},
        },
    )
    initial = client.post(
        "/api/v1/elo/initial",
        json={
            "discipline": "standard",
            "games": [
                {
                    "rating": 1600,
                    "result": "win" if index == 0 else "loss",
                    "period": "2026-08",
                }
                for index in range(6)
            ],
        },
    )

    assert versus.status_code == 200
    assert versus.json()["outcomes"][0]["change_a"] == 15.2
    assert initial.status_code == 200
    assert initial.json()["initial_rating"] == 1457


def test_fide_current_endpoint_uses_current_official_rating_and_k(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "get_current_rating_data",
        lambda ids, discipline: {fide_id: {"rating": 1551, "k": 40} for fide_id in ids},
    )
    monkeypatch.setattr(
        main_module,
        "get_fide_player",
        lambda fide_id, **_: FidePlayer(
            fide_id=fide_id,
            name=f"Jugador {fide_id}",
            standard_rating=1551,
            profile_url=f"https://ratings.fide.com/profile/{fide_id}",
        ),
    )

    response = client.post(
        "/api/v1/elo/head-to-head",
        json={
            "discipline": "standard",
            "player_a": {"fide_id": "94711151"},
            "player_b": {"fide_id": "1503014"},
        },
    )

    assert response.status_code == 200
    assert response.json()["player_a"]["rating"] == 1551
    assert response.json()["player_a"]["k"] == 40
