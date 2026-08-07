from __future__ import annotations

import json
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

from api.app.models import GameType, PlayerRef
from api.app.services.pgn import ParseResult, parse_pgn, variant_exclusion_warning, variant_label
from api.app.services.text import clean_identifier, clean_untrusted_text


BASE_URL = "https://api.chess.com"
USER_AGENT = "ChessPrep/1.0 (public chess preparation tool; github.com/villarrubi/ChessPrep)"
MAX_RESPONSE_BYTES = 12_000_000


class ProviderUnavailable(RuntimeError):
    pass


def _get_json(url_or_path: str, timeout: int = 10) -> dict:
    if url_or_path.startswith("https://"):
        parsed = urlsplit(url_or_path)
        try:
            port = parsed.port
        except ValueError as exc:
            raise ProviderUnavailable(
                "Chess.com devolvió una URL de archivo no permitida."
            ) from exc
        if (
            parsed.scheme != "https"
            or parsed.hostname != "api.chess.com"
            or port not in {None, 443}
            or parsed.username
            or parsed.password
        ):
            raise ProviderUnavailable("Chess.com devolvió una URL de archivo no permitida.")
        url = url_or_path
    elif url_or_path.startswith("/"):
        url = f"{BASE_URL}{url_or_path}"
    else:
        raise ProviderUnavailable("Chess.com devolvió una ruta de archivo no válida.")
    request = Request(
        url,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise ProviderUnavailable("La respuesta de Chess.com supera el límite permitido.")
            return json.loads(body)
    except HTTPError as exc:
        if exc.code in {404, 410}:
            raise LookupError("El jugador no existe en Chess.com.") from exc
        if exc.code == 429:
            raise ProviderUnavailable("Chess.com ha limitado temporalmente las consultas.") from exc
        raise ProviderUnavailable(f"Chess.com respondió con el estado {exc.code}.") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ProviderUnavailable("No se pudo conectar con Chess.com.") from exc


def get_player(username: str) -> PlayerRef:
    clean_username = clean_untrusted_text(username, max_length=80)
    encoded_username = quote(clean_username.lower(), safe="")
    profile_path = f"/pub/player/{encoded_username}"
    stats_path = f"/pub/player/{encoded_username}/stats"
    with ThreadPoolExecutor(max_workers=2) as pool:
        profile_future = pool.submit(_get_json, profile_path)
        stats_future = pool.submit(_get_json, stats_path)
        payload = profile_future.result()
        rating = None
        try:
            stats = stats_future.result()
            ratings = [
                stats.get(key, {}).get("last", {}).get("rating")
                for key in ("chess_rapid", "chess_blitz", "chess_bullet", "chess_daily")
            ]
            rating = max(value for value in ratings if isinstance(value, int))
        except (LookupError, ProviderUnavailable, ValueError):
            pass
    provider_username = clean_untrusted_text(payload.get("username") or clean_username, max_length=80)
    country_url = clean_untrusted_text(payload.get("country"), max_length=300)
    external_id = clean_identifier(provider_username, max_length=80)
    if not external_id:
        raise ProviderUnavailable("Chess.com devolvió un identificador de jugador no válido.")
    return PlayerRef(
        source="chess.com",
        external_id=external_id.lower(),
        username=provider_username,
        display_name=clean_untrusted_text(payload.get("name") or provider_username, max_length=160),
        title=clean_untrusted_text(payload.get("title"), max_length=16) or None,
        rating=rating,
        country=clean_identifier(country_url.rstrip("/").split("/")[-1], max_length=16),
        avatar_url=None,
        game_type=GameType.ONLINE,
    )


def _pgn_with_external_id(game: dict) -> str | None:
    pgn = game.get("pgn")
    if not pgn:
        return None
    game_url = str(game.get("url") or "").rstrip("/")
    url_parts = game_url.split("/") if game_url else []
    external_id = "-".join(url_parts[-2:]) if len(url_parts) >= 2 else game.get("uuid")
    if not external_id:
        return pgn
    # Chess.com commonly writes `[Site "Chess.com"]` in its PGN. Preserve the
    # real public game URL as a dedicated identifier so every viewer link is unique.
    return f'[GameId "{external_id}"]\n{pgn}'


def fetch_games(username: str, max_games: int | None = None) -> ParseResult:
    configured_max = int(os.getenv("CHESSPREP_CHESSCOM_MAX_GAMES", "50"))
    limit = min(max(max_games or configured_max, 1), 100)
    encoded_username = quote(clean_untrusted_text(username, max_length=80).lower(), safe="")
    archive_index = _get_json(f"/pub/player/{encoded_username}/games/archives")
    archives = archive_index.get("archives", [])
    collected: list[str] = []
    excluded_variants: Counter[str] = Counter()

    # Chess.com recommends serial access. Start with the most recent month and
    # only request older archives when the configured sample still needs games.
    for archive_url in reversed(archives):
        archive = _get_json(archive_url, timeout=20)
        standard_games = []
        for game in archive.get("games", []):
            rules = str(game.get("rules") or "chess")
            if rules != "chess":
                excluded_variants[variant_label(rules)] += 1
                continue
            annotated = _pgn_with_external_id(game)
            if annotated:
                standard_games.append(annotated)
        remaining = limit - len(collected)
        collected = standard_games[-remaining:] + collected
        if len(collected) >= limit:
            break

    if not collected:
        errors = ["Chess.com no devolvió partidas públicas estándar."]
        if excluded_variants:
            errors.append(variant_exclusion_warning(excluded_variants))
        return ParseResult(games=[], errors=errors, duplicates=0)
    parsed = parse_pgn(
        "\n\n".join(collected[-limit:]),
        source="chess.com",
        game_type=GameType.ONLINE,
        target_player=username,
        confidence="official",
    )
    if excluded_variants:
        parsed.errors.append(variant_exclusion_warning(excluded_variants))
    return parsed
