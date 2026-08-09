from __future__ import annotations

import json
import os
import threading
import time
from datetime import UTC, date, datetime
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from api.app.models import GameType, PlayerRef
from api.app.services.pgn import ParseResult, parse_pgn
from api.app.services.text import clean_identifier, clean_untrusted_text


BASE_URL = "https://lichess.org"
USER_AGENT = os.getenv(
    "CHESSPREP_LICHESS_USER_AGENT",
    "ChessPrep/1.0 (+https://github.com/villarrubi/ChessPrep)",
)
MAX_RESPONSE_BYTES = 12_000_000
MAX_GAMES_PER_REQUEST = 200
MIN_RATE_LIMIT_PAUSE_SECONDS = 60.0
STANDARD_PERF_TYPES = (
    "ultraBullet",
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
)

# Lichess requires clients to make only one request at a time. The production
# image runs one Uvicorn process, so this lock serializes every Lichess call
# made by all request threads in that process. A deployment with more workers
# or replicas must replace it with a shared/distributed gate.
_request_lock = threading.Lock()
_rate_limited_until = 0.0


class ProviderUnavailable(RuntimeError):
    pass


def _monotonic() -> float:
    return time.monotonic()


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _retry_delay(error: HTTPError) -> float:
    retry_after = error.headers.get("Retry-After") if error.headers else None
    try:
        requested_delay = float(retry_after) if retry_after is not None else 0.0
    except (TypeError, ValueError):
        requested_delay = 0.0
    return max(MIN_RATE_LIMIT_PAUSE_SECONDS, requested_delay)


def _wait_until_available() -> None:
    while True:
        remaining = _rate_limited_until - _monotonic()
        if remaining <= 0:
            return
        _sleep(remaining)


def _record_rate_limit(error: HTTPError) -> None:
    global _rate_limited_until
    _rate_limited_until = max(
        _rate_limited_until,
        _monotonic() + _retry_delay(error),
    )


def _get(path: str, accept: str = "application/json", timeout: int = 8) -> bytes:
    request = Request(
        f"{BASE_URL}{path}",
        headers={"Accept": accept, "User-Agent": USER_AGENT},
    )
    with _request_lock:
        _wait_until_available()
        try:
            with urlopen(request, timeout=timeout) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ProviderUnavailable(
                        "La respuesta de Lichess supera el límite permitido."
                    )
                return body
        except HTTPError as exc:
            if exc.code == 404:
                raise LookupError("El jugador no existe en Lichess.") from exc
            if exc.code == 429:
                _record_rate_limit(exc)
                raise ProviderUnavailable(
                    "Lichess ha limitado temporalmente las consultas; "
                    "ChessPrep esperará al menos un minuto antes de reanudarlas."
                ) from exc
            raise ProviderUnavailable(
                f"Lichess respondió con el estado {exc.code}."
            ) from exc
        except (URLError, TimeoutError) as exc:
            raise ProviderUnavailable("No se pudo conectar con Lichess.") from exc


def get_player(username: str) -> PlayerRef:
    clean_username = clean_untrusted_text(username, max_length=80)
    try:
        payload = json.loads(_get(f"/api/user/{quote(clean_username, safe='')}"))
    except json.JSONDecodeError as exc:
        raise ProviderUnavailable("Lichess devolvió una respuesta no válida.") from exc
    profile = payload.get("profile") or {}
    full_name = clean_untrusted_text(
        " ".join(
            str(value)
            for value in (profile.get("firstName"), profile.get("lastName"))
            if value
        ),
        max_length=160,
    )
    perfs = payload.get("perfs") or {}
    rating_candidates = [
        perf.get("rating")
        for key, perf in perfs.items()
        if key in {"rapid", "blitz", "classical"} and isinstance(perf, dict) and perf.get("rating")
    ]
    provider_username = clean_untrusted_text(payload.get("username") or clean_username, max_length=80)
    external_id = clean_identifier(payload.get("id") or provider_username, max_length=80)
    if not external_id:
        raise ProviderUnavailable("Lichess devolvió un identificador de jugador no válido.")
    return PlayerRef(
        source="lichess",
        external_id=external_id.lower(),
        username=provider_username,
        display_name=full_name or provider_username,
        title=clean_untrusted_text(payload.get("title"), max_length=16) or None,
        rating=max(rating_candidates) if rating_candidates else None,
        country=clean_untrusted_text(profile.get("country"), max_length=16) or None,
        game_type=GameType.ONLINE,
    )


def _date_to_millis(value: date, *, end_of_day: bool = False) -> int:
    boundary = datetime.combine(
        value,
        datetime.max.time() if end_of_day else datetime.min.time(),
        tzinfo=UTC,
    )
    return int(boundary.timestamp() * 1000)


def fetch_games(
    username: str,
    max_games: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> ParseResult:
    configured_max = int(os.getenv("CHESSPREP_LICHESS_MAX_GAMES", "50"))
    limit = min(max(max_games or configured_max, 1), MAX_GAMES_PER_REQUEST)
    standard_perfs = ",".join(STANDARD_PERF_TYPES)
    params: dict[str, str | int] = {
        "max": limit,
        "clocks": "false",
        "evals": "false",
        "opening": "true",
        "perfType": standard_perfs,
    }
    if date_from:
        params["since"] = _date_to_millis(date_from)
    if date_to:
        params["until"] = _date_to_millis(date_to, end_of_day=True)
    query = urlencode(params)
    encoded_username = quote(clean_untrusted_text(username, max_length=80), safe="")
    body = _get(
        f"/api/games/user/{encoded_username}?{query}",
        accept="application/x-chess-pgn",
        timeout=20,
    ).decode("utf-8", errors="replace")
    parsed = parse_pgn(
        body,
        source="lichess",
        game_type=GameType.ONLINE,
        target_player=username,
        confidence="official",
    )
    if len(parsed.games) > limit:
        return ParseResult(
            games=parsed.games[:limit],
            errors=parsed.errors,
            duplicates=parsed.duplicates,
        )
    return parsed
