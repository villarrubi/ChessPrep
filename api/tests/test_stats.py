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


def _decision_child(decision_map: dict, parent: dict | None, move: str):
    edges = parent["children"] if parent else decision_map["roots"]
    edge = next(item for item in edges if item["moves"][0]["move"] == move)
    return edge, decision_map["nodes"][edge["node_id"]]


def test_decision_map_attributes_choices_to_player_and_opponent():
    white_game = _repertoire_game("1. e4 c5 2. Bc4 e6", "White")
    black_game = _repertoire_game("1. d4 d5 2. c4 c6", "Black")
    decisions = calculate_stats([white_game, black_game])["opening_decisions"]

    white_map = decisions["white"]
    _, e4 = _decision_child(white_map, None, "e4")
    _, c5 = _decision_child(white_map, e4, "c5")
    _, bc4 = _decision_child(white_map, c5, "Bc4")
    assert e4["actor"] == "player"
    assert c5["actor"] == "opponent"
    assert bc4["actor"] == "player"
    assert bc4["opening"] == "Sicilian Defense: Bowdler Attack"

    black_map = decisions["black"]
    _, d4 = _decision_child(black_map, None, "d4")
    _, d5 = _decision_child(black_map, d4, "d5")
    _, c4 = _decision_child(black_map, d5, "c4")
    _, c6 = _decision_child(black_map, c4, "c6")
    assert d4["actor"] == "opponent"
    assert d5["actor"] == "player"
    assert c4["actor"] == "opponent"
    assert c6["actor"] == "player"
    assert c6["opening"] == "Slav Defense"
    assert c6["game_ids"] == [black_game.id]

    for decision_map in decisions.values():
        for node in decision_map["nodes"].values():
            child_actors = {
                decision_map["nodes"][edge["node_id"]]["actor"]
                for edge in node["children"]
            }
            assert len(child_actors) <= 1
            if node["children"]:
                explained_share = sum(edge["share_pct"] for edge in node["children"])
                explained_share += node["other_continuations"]["share_pct"]
                assert abs(explained_share - 100.0) <= 0.2


def test_decision_percentages_are_conditional_on_the_parent_position():
    sicilian = _repertoire_game("1. e4 c5 2. Bc4 e6", "White")
    open_game = _repertoire_game("1. e4 e5 2. Nf3 Nc6", "White").model_copy(
        update={"id": "second-repertoire-game"}
    )
    decision_map = calculate_stats([sicilian, open_game])["opening_decisions"]["white"]
    root, king_pawn = _decision_child(decision_map, None, "e4")
    sicilian_edge, _ = _decision_child(decision_map, king_pawn, "c5")
    open_edge, _ = _decision_child(decision_map, king_pawn, "e5")

    assert root["share_pct"] == 100.0
    assert sicilian_edge["share_pct"] == 50.0
    assert sicilian_edge["game_ids"] == [sicilian.id]
    assert open_edge["share_pct"] == 50.0


def test_decision_map_exposes_games_without_a_further_classified_move():
    long_game = _repertoire_game("1. e4 c5 2. Bc4 e6", "White")
    short_game = _repertoire_game("1. e4 c5", "White").model_copy(
        update={"id": "short-sicilian"}
    )
    decision_map = calculate_stats([long_game, short_game])["opening_decisions"]["white"]
    _, e4 = _decision_child(decision_map, None, "e4")
    _, c5 = _decision_child(decision_map, e4, "c5")
    bc4_edge, _ = _decision_child(decision_map, c5, "Bc4")

    remainder = c5["other_continuations"]
    assert bc4_edge["share_pct"] == 50.0
    assert remainder["share_pct"] == 50.0
    assert remainder["game_ids"] == [short_game.id]
    assert bc4_edge["share_pct"] + remainder["share_pct"] == 100.0
