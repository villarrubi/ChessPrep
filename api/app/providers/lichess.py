from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from api.app.models import GameType, PlayerRef
from api.app.services.pgn import ParseResult, parse_pgn


BASE_URL = "https://lichess.org"
USER_AGENT = "ChessPrep/1.0 (educational tournament preparation tool)"


class ProviderUnavailable(RuntimeError):
    pass


def _get(path: str, accept: str = "application/json", timeout: int = 8) -> bytes:
    request = Request(
        f"{BASE_URL}{path}",
        headers={"Accept": accept, "User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read()
    except HTTPError as exc:
        if exc.code == 404:
            raise LookupError("El jugador no existe en Lichess.") from exc
        if exc.code == 429:
            raise ProviderUnavailable("Lichess ha limitado temporalmente las consultas.") from exc
        raise ProviderUnavailable(f"Lichess respondió con el estado {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise ProviderUnavailable("No se pudo conectar con Lichess.") from exc


def get_player(username: str) -> PlayerRef:
    payload = json.loads(_get(f"/api/user/{quote(username)}"))
    profile = payload.get("profile") or {}
    full_name = " ".join(value for value in (profile.get("firstName"), profile.get("lastName")) if value)
    perfs = payload.get("perfs") or {}
    rating_candidates = [
        perf.get("rating")
        for key, perf in perfs.items()
        if key in {"rapid", "blitz", "classical"} and isinstance(perf, dict) and perf.get("rating")
    ]
    return PlayerRef(
        source="lichess",
        external_id=payload.get("id", username).lower(),
        username=payload.get("username", username),
        display_name=full_name or payload.get("username", username),
        title=payload.get("title"),
        rating=max(rating_candidates) if rating_candidates else None,
        country=profile.get("country"),
        game_type=GameType.ONLINE,
    )


def fetch_games(username: str, max_games: int | None = None) -> ParseResult:
    configured_max = int(os.getenv("CHESSPREP_LICHESS_MAX_GAMES", "100"))
    limit = min(max(max_games or configured_max, 1), 100)
    query = f"max={limit}&clocks=false&evals=false&opening=true"
    body = _get(
        f"/api/games/user/{quote(username)}?{query}",
        accept="application/x-chess-pgn",
        timeout=20,
    ).decode("utf-8", errors="replace")
    return parse_pgn(
        body,
        source="lichess",
        game_type=GameType.ONLINE,
        target_player=username,
        confidence="official",
    )
