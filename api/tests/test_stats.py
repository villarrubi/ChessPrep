from api.app.main import ensure_demo
from api.app.models import Mode, Pace
from api.app.services.stats import calculate_stats, filter_games, outcome_for_player


def test_outcomes_use_target_player_color():
    games = ensure_demo().games
    black_win = next(game for game in games if game.player_color == "black" and game.result == "0-1")
    assert outcome_for_player(black_win) == "win"


def test_mode_and_opening_aggregations():
    games = ensure_demo().games
    online = filter_games(games, mode=Mode.ONLINE)
    assert len(online) == 6
    stats = calculate_stats(games, Mode.COMBINED)
    assert sum(item["games"] for item in stats["openings"]) == 12
    assert sum(item["games"] for item in stats["by_color"]) == 12


def test_unclassified_opening_keeps_null_eco_for_exact_filtering():
    game = ensure_demo().games[0].model_copy(
        update={"eco": None, "opening": "Apertura sin clasificar"}
    )

    opening = calculate_stats([game])["openings"][0]

    assert opening["eco"] is None
    assert opening["opening"] == "Apertura sin clasificar"
    assert opening["color"] == game.player_color
    assert opening["games"] == 1


def test_pace_filters_blitz_rapid_and_classical():
    games = ensure_demo().games
    assert len(filter_games(games, pace=Pace.BLITZ)) == 2
    assert len(filter_games(games, pace=Pace.RAPID)) == 4
    assert len(filter_games(games, pace=Pace.CLASSICAL)) == 6
    assert calculate_stats(games, pace=Pace.GLOBAL)["sample_size"] == 12
    bullet = games[0].model_copy(update={"id": "bullet-copy", "time_class": "bullet"})
    assert bullet in filter_games([bullet], pace=Pace.GLOBAL)
    assert bullet in filter_games([bullet], pace=Pace.BULLET)
    assert bullet not in filter_games([bullet], pace=Pace.BLITZ)
