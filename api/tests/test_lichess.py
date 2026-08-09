import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

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


class FakeResponse:
    def __init__(self, body: bytes = b"{}", on_read=None):
        self.body = body
        self.on_read = on_read

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def read(self, _size: int) -> bytes:
        if self.on_read:
            self.on_read()
        return self.body


@pytest.fixture(autouse=True)
def reset_lichess_rate_limit(monkeypatch):
    monkeypatch.setattr(lichess, "_rate_limited_until", 0.0)


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


def test_lichess_serializes_requests_globally(monkeypatch):
    active_requests = 0
    maximum_active_requests = 0
    state_lock = threading.Lock()
    start = threading.Barrier(4)

    def observe_read():
        nonlocal active_requests, maximum_active_requests
        with state_lock:
            active_requests += 1
            maximum_active_requests = max(maximum_active_requests, active_requests)
        time.sleep(0.02)
        with state_lock:
            active_requests -= 1

    monkeypatch.setattr(
        lichess,
        "urlopen",
        lambda *_args, **_kwargs: FakeResponse(on_read=observe_read),
    )

    def request_once():
        start.wait()
        return lichess._get("/api/test")

    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(lambda _index: request_once(), range(4)))

    assert responses == [b"{}"] * 4
    assert maximum_active_requests == 1


def test_lichess_waits_full_minute_after_429(monkeypatch):
    clock = [100.0]
    sleeps: list[float] = []
    calls = 0

    def fake_urlopen(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise HTTPError(
                "https://lichess.org/api/test",
                429,
                "Too Many Requests",
                {"Retry-After": "5"},
                None,
            )
        return FakeResponse()

    def fake_sleep(seconds: float):
        sleeps.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr(lichess, "urlopen", fake_urlopen)
    monkeypatch.setattr(lichess, "_monotonic", lambda: clock[0])
    monkeypatch.setattr(lichess, "_sleep", fake_sleep)

    with pytest.raises(lichess.ProviderUnavailable, match="al menos un minuto"):
        lichess._get("/api/test")

    assert lichess._get("/api/test") == b"{}"
    assert sleeps == [60.0]


def test_lichess_respects_longer_retry_after(monkeypatch):
    clock = [250.0]
    sleeps: list[float] = []
    calls = 0

    def fake_urlopen(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise HTTPError(
                "https://lichess.org/api/test",
                429,
                "Too Many Requests",
                {"Retry-After": "90"},
                None,
            )
        return FakeResponse()

    def fake_sleep(seconds: float):
        sleeps.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr(lichess, "urlopen", fake_urlopen)
    monkeypatch.setattr(lichess, "_monotonic", lambda: clock[0])
    monkeypatch.setattr(lichess, "_sleep", fake_sleep)

    with pytest.raises(lichess.ProviderUnavailable):
        lichess._get("/api/test")

    assert lichess._get("/api/test") == b"{}"
    assert sleeps == [90.0]
