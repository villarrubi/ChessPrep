from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from api.app.models import GameType, PlayerRef
from api.app.services.pgn import ParseResult, parse_pgn


BASE_URL = "https://api.chess.com"
USER_AGENT = "ChessPrep/1.0 (public chess preparation tool; github.com/villarrubi/Chess-Tournament-Assistant)"


class ProviderUnavailable(RuntimeError):
    pass


def _get_json(url_or_path: str, timeout: int = 10) -> dict:
    url = url_or_path if url_or_path.startswith("https://") else f"{BASE_URL}{url_or_path}"
    request = Request(
        url,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        if exc.code in {404, 410}:
            raise LookupError("El jugador no existe en Chess.com.") from exc
        if exc.code == 429:
            raise ProviderUnavailable("Chess.com ha limitado temporalmente las consultas.") from exc
        raise ProviderUnavailable(f"Chess.com respondió con el estado {exc.code}.") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise ProviderUnavailable("No se pudo conectar con Chess.com.") from exc


def get_player(username: str) -> PlayerRef:
    payload = _get_json(f"/pub/player/{quote(username.lower())}")
    rating = None
    try:
        stats = _get_json(f"/pub/player/{quote(username.lower())}/stats")
        ratings = [
            stats.get(key, {}).get("last", {}).get("rating")
            for key in ("chess_rapid", "chess_blitz", "chess_bullet", "chess_daily")
        ]
        rating = max(value for value in ratings if isinstance(value, int))
    except (LookupError, ProviderUnavailable, ValueError):
        pass
    country_url = payload.get("country", "")
    return PlayerRef(
        source="chess.com",
        external_id=payload.get("username", username).lower(),
        username=payload.get("username", username),
        display_name=payload.get("name") or payload.get("username", username),
        title=payload.get("title"),
        rating=rating,
        country=country_url.rstrip("/").split("/")[-1] or None,
        avatar_url=payload.get("avatar"),
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
    configured_max = int(os.getenv("CHESSPREP_CHESSCOM_MAX_GAMES", "100"))
    limit = min(max(max_games or configured_max, 1), 100)
    archive_index = _get_json(f"/pub/player/{quote(username.lower())}/games/archives")
    archives = archive_index.get("archives", [])
    collected: list[str] = []

    # Chess.com recommends serial access. Start with the most recent month and
    # only request older archives when the configured sample still needs games.
    for archive_url in reversed(archives):
        archive = _get_json(archive_url, timeout=20)
        standard_games = [
            annotated
            for game in archive.get("games", [])
            if game.get("rules", "chess") == "chess"
            if (annotated := _pgn_with_external_id(game))
        ]
        remaining = limit - len(collected)
        collected = standard_games[-remaining:] + collected
        if len(collected) >= limit:
            break

    if not collected:
        return ParseResult(games=[], errors=["Chess.com no devolvió partidas públicas estándar."], duplicates=0)
    return parse_pgn(
        "\n\n".join(collected[-limit:]),
        source="chess.com",
        game_type=GameType.ONLINE,
        target_player=username,
        confidence="official",
    )
