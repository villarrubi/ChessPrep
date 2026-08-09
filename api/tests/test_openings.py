from api.app.models import GameType
from api.app.services.pgn import _opening_position_index, opening_path, parse_pgn


def _parse(moves: str, extra_headers: str = ""):
    headers = f'''[Event "Opening test"]
[White "Target"]
[Black "Opponent"]
[Result "1-0"]'''
    if extra_headers:
        headers = f"{headers}\n{extra_headers}"
    pgn = f"{headers}\n\n{moves} 1-0\n"
    parsed = parse_pgn(
        pgn,
        source="test",
        game_type=GameType.ONLINE,
        target_player="Target",
    )
    assert not parsed.errors
    return parsed.games[0]


def test_local_opening_database_is_loaded():
    assert len(_opening_position_index()) == 3810


def test_opening_is_detected_when_pgn_has_no_opening_headers():
    game = _parse("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. Nc3 d6")

    assert game.eco == "C50"
    assert game.opening == "Italian Game: Giuoco Pianissimo, Italian Four Knights Variation"


def test_move_order_transpositions_reach_the_same_opening():
    transposition = _parse(
        "1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. Bg5 O-O"
    )
    canonical = _parse(
        "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bg5 O-O"
    )

    assert (transposition.eco, transposition.opening) == (
        canonical.eco,
        canonical.opening,
    )
    assert transposition.eco == "D53"
    assert transposition.opening == "Queen's Gambit Declined"
    assert opening_path(transposition.moves_uci)[-1].position_id == opening_path(
        canonical.moves_uci
    )[-1].position_id


def test_unknown_header_is_replaced_but_specific_provider_name_is_preserved():
    detected = _parse(
        "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. f3",
        '[ECO "A00"]\n[Opening "Apertura sin clasificar"]',
    )
    provider = _parse(
        "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. f3",
        '[ECO "B54"]\n[Opening "Nombre del proveedor"]\n[Variation "Línea secundaria"]',
    )

    assert detected.eco == "B54"
    assert detected.opening == "Sicilian Defense: Prins Variation"
    assert provider.eco == "B54"
    assert provider.opening == "Nombre del proveedor · Línea secundaria"
