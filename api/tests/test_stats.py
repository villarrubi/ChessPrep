from api.app.main import ensure_demo
from api.app.models import Mode
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

