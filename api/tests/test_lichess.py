from urllib.parse import parse_qs, urlsplit

from api.app.providers import lichess


STANDARD_PGN = """[Event "Rated blitz game"]
[Site "https://lichess.org/abcdefgh"]
[Date "2026.08.01"]
[White "SampleUser"]
[Black "Opponent"]
[Result "1-0"]
[ECO "C50"]
[TimeControl "300+3"]

1. e4 e5 2. Nf3 Nc6 1-0
"""


def test_lichess_requests_only_standard_chess_performances(monkeypatch):
    requested_path = ""

    def fake_get(path, accept="application/json", timeout=8):
        nonlocal requested_path
        requested_path = path
        return STANDARD_PGN.encode("utf-8")

    monkeypatch.setattr(lichess, "_get", fake_get)

    parsed = lichess.fetch_games("SampleUser", max_games=25)
    query = parse_qs(urlsplit(requested_path).query)

    assert len(parsed.games) == 1
    assert query["max"] == ["25"]
    assert query["perfType"] == [
        "ultraBullet,bullet,blitz,rapid,classical,correspondence"
    ]
    assert "chess960" not in query["perfType"][0]
