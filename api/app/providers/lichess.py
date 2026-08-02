from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from api.app.models import GameType, PlayerRef
from api.app.services.pgn import ParseResult, parse_pgn
from api.app.services.text import clean_identifier, clean_untrusted_text


BASE_URL = "https://lichess.org"
USER_AGENT = "ChessPrep/1.0 (educational tournament preparation tool)"
MAX_RESPONSE_BYTES = 12_000_000
STANDARD_PERF_TYPES = (
    "ultraBullet",
    "bullet",
    "blitz",
    "rapid",
    "classical",
    "correspondence",
)


class ProviderUnavailable(RuntimeError):
    pass


def _get(path: str, accept: str = "application/json", timeout: int = 8) -> bytes:
    request = Request(
        f"{BASE_URL}{path}",
        headers={"Accept": accept, "User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ProviderUnavailable("La respuesta de Lichess supera el límite permitido.")
            return body
    except HTTPError as exc:
        if exc.code == 404:
            raise LookupError("El jugador no existe en Lichess.") from exc
        if exc.code == 429:
            raise ProviderUnavailable("Lichess ha limitado temporalmente las consultas.") from exc
        raise ProviderUnavailable(f"Lichess respondió con el estado {exc.code}.") from exc
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


def fetch_games(username: str, max_games: int | None = None) -> ParseResult:
    configured_max = int(os.getenv("CHESSPREP_LICHESS_MAX_GAMES", "100"))
    limit = min(max(max_games or configured_max, 1), 100)
    standard_perfs = ",".join(STANDARD_PERF_TYPES)
    query = f"max={limit}&clocks=false&evals=false&opening=true&perfType={standard_perfs}"
    encoded_username = quote(clean_untrusted_text(username, max_length=80), safe="")
    body = _get(
        f"/api/games/user/{encoded_username}?{query}",
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
