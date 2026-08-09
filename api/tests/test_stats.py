from api.app.main import ensure_demo
from api.app.models import GameType, Mode, Pace
from api.app.services.pgn import parse_pgn
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


def _repertoire_game(moves: str, target: str):
    parsed = parse_pgn(
        f'''[White "White"]
[Black "Black"]
[Result "1-0"]

{moves} 1-0
''',
        source="repertoire-test",
        game_type=GameType.ONLINE,
        target_player=target,
    )
    assert not parsed.errors
    return parsed.games[0]


def test_decision_map_attributes_choices_to_player_and_opponent():
    white_game = _repertoire_game("1. e4 c5 2. Bc4 e6", "White")
    black_game = _repertoire_game("1. d4 d5 2. c4 c6", "Black")
    decisions = calculate_stats([white_game, black_game])["opening_decisions"]

    white_nodes = {node["opening"]: node for node in decisions["white"]["nodes"].values()}
    assert white_nodes["King's Pawn Game"]["actor"] == "player"
    assert white_nodes["Sicilian Defense"]["actor"] == "opponent"
    assert white_nodes["Sicilian Defense: Bowdler Attack"]["actor"] == "player"
    assert white_nodes["Sicilian Defense: Bowdler Attack"]["moves"] == [
        {"move": "Bc4", "games": 1}
    ]

    black_map = decisions["black"]
    black_root = black_map["nodes"][black_map["roots"][0]["node_id"]]
    black_nodes = {node["opening"]: node for node in black_map["nodes"].values()}
    assert black_root["opening"] == "Queen's Pawn Game"
    assert black_root["actor"] == "opponent"
    assert black_nodes["Queen's Gambit"]["actor"] == "opponent"
    assert black_nodes["Slav Defense"]["actor"] == "player"
    assert black_nodes["Slav Defense"]["game_ids"] == [black_game.id]


def test_decision_percentages_are_conditional_on_the_parent_position():
    sicilian = _repertoire_game("1. e4 c5 2. Bc4 e6", "White")
    open_game = _repertoire_game("1. e4 e5 2. Nf3 Nc6", "White").model_copy(
        update={"id": "second-repertoire-game"}
    )
    decision_map = calculate_stats([sicilian, open_game])["opening_decisions"]["white"]
    root = next(
        edge
        for edge in decision_map["roots"]
        if decision_map["nodes"][edge["node_id"]]["opening"] == "King's Pawn Game"
    )
    king_pawn = decision_map["nodes"][root["node_id"]]
    replies = {
        decision_map["nodes"][edge["node_id"]]["opening"]: edge
        for edge in king_pawn["children"]
    }

    assert root["share_pct"] == 100.0
    assert replies["Sicilian Defense"]["share_pct"] == 50.0
    assert replies["Sicilian Defense"]["game_ids"] == [sicilian.id]
