from api.app.providers import chesscom


SAMPLE_PGN = """[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.07.31"]
[White "SampleUser"]
[Black "Opponent"]
[Result "1-0"]
[WhiteElo "2100"]
[BlackElo "2050"]
[ECO "C50"]
[TimeControl "600"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1-0
"""

SAMPLE_PGN_2 = SAMPLE_PGN.replace("2026.07.31", "2026.07.30").replace(
    'Black "Opponent"', 'Black "SecondOpponent"'
).replace("1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5", "1. d4 d5 2. c4 e6 3. Nc3 Nf6")


def test_chesscom_profile_and_archive_are_normalized(monkeypatch):
    def fake_get(url, timeout=10):
        if url.endswith("/stats"):
            return {"chess_rapid": {"last": {"rating": 2142}}}
        if url.endswith("/games/archives"):
            return {"archives": ["https://api.chess.com/pub/player/sampleuser/games/2026/07"]}
        if "/games/2026/07" in url:
            return {
                "games": [
                    {"rules": "chess", "url": "https://www.chess.com/game/live/123", "pgn": SAMPLE_PGN},
                    {"rules": "chess", "url": "https://www.chess.com/game/live/124", "pgn": SAMPLE_PGN_2},
                ]
            }
        return {
            "username": "SampleUser",
            "name": "Sample Player",
            "title": "FM",
            "country": "https://api.chess.com/pub/country/ES",
        }

    monkeypatch.setattr(chesscom, "_get_json", fake_get)
    player = chesscom.get_player("SampleUser")
    parsed = chesscom.fetch_games("SampleUser", max_games=10)

    assert player.source == "chess.com"
    assert player.rating == 2142
    assert player.country == "ES"
    assert len(parsed.games) == 2
    assert {game.id for game in parsed.games} == {"chess.com-live-123", "chess.com-live-124"}
    assert all(game.source == "chess.com" for game in parsed.games)
    assert all(game.game_type.value == "online" for game in parsed.games)
