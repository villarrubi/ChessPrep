from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass

import chess.pgn

from api.app.models import GameType, NormalizedGame


ECO_NAMES = {
    "A00": "Apertura irregular",
    "A04": "Apertura Réti",
    "A06": "Apertura Réti",
    "A07": "Ataque Indio de Rey",
    "A40": "Defensa de la Dama",
    "A45": "Ataque Trompowsky",
    "B01": "Defensa Escandinava",
    "B06": "Defensa Moderna",
    "B07": "Defensa Pirc",
    "B12": "Defensa Caro-Kann",
    "B20": "Defensa Siciliana",
    "B22": "Siciliana Alapin",
    "B30": "Siciliana Rossolimo",
    "B33": "Siciliana Sveshnikov",
    "B90": "Siciliana Najdorf",
    "C00": "Defensa Francesa",
    "C02": "Francesa, variante del Avance",
    "C10": "Defensa Francesa",
    "C42": "Defensa Petrov",
    "C50": "Apertura Italiana",
    "C65": "Apertura Española, defensa Berlinesa",
    "C67": "Apertura Española",
    "C88": "Apertura Española, cerrada",
    "D02": "Apertura de Peón de Dama",
    "D10": "Gambito de Dama Eslavo",
    "D30": "Gambito de Dama Rehusado",
    "D37": "Gambito de Dama Rehusado",
    "D85": "Defensa Grünfeld",
    "E12": "Defensa India de Dama",
    "E20": "Defensa Nimzoindia",
    "E60": "Defensa India de Rey",
    "E90": "Defensa India de Rey",
}


@dataclass
class ParseResult:
    games: list[NormalizedGame]
    errors: list[str]
    duplicates: int


def _safe_int(value: str | None) -> int | None:
    if not value or not value.isdigit():
        return None
    number = int(value)
    return number if 100 <= number <= 4000 else None


def _normalise_date(value: str | None) -> str | None:
    if not value or value in {"????.??.??", "?"}:
        return None
    cleaned = value.replace(".", "-")
    return cleaned if re.match(r"^\d{4}(?:-\d{2})?(?:-\d{2})?$", cleaned) else None


def _time_class(control: str | None) -> str | None:
    if not control or control in {"-", "?"}:
        return None
    try:
        base = int(control.split("+")[0])
    except ValueError:
        return None
    if base < 180:
        return "bullet"
    if base < 600:
        return "blitz"
    if base < 1800:
        return "rapid"
    return "classical"


def _opening_name(headers: chess.pgn.Headers, eco: str | None) -> str:
    explicit = headers.get("Opening")
    variation = headers.get("Variation")
    if explicit and explicit not in {"?", "Unknown"}:
        return f"{explicit} · {variation}" if variation and variation != "?" else explicit
    return ECO_NAMES.get(eco or "", "Apertura sin clasificar")


def _target_color(white: str, black: str, target: str | None) -> tuple[str, str]:
    target_folded = (target or "").casefold().strip()
    if target_folded and target_folded in black.casefold():
        return "black", black
    if target_folded and target_folded in white.casefold():
        return "white", white
    return "white", white


def parse_pgn(
    pgn_text: str,
    *,
    source: str,
    game_type: GameType,
    target_player: str | None = None,
    confidence: str = "user_upload",
) -> ParseResult:
    stream = io.StringIO(pgn_text.lstrip("\ufeff\n\r "))
    games: list[NormalizedGame] = []
    errors: list[str] = []
    seen: set[str] = set()
    seen_game_ids: set[str] = set()
    duplicates = 0
    game_number = 0

    while True:
        try:
            game = chess.pgn.read_game(stream)
        except Exception as exc:  # python-chess reports malformed tokens here.
            errors.append(f"Partida {game_number + 1}: PGN no válido ({exc}).")
            break
        if game is None:
            break
        game_number += 1
        if game.errors:
            errors.append(f"Partida {game_number}: se ignoraron jugadas no válidas ({game.errors[0]}).")

        headers = game.headers
        white = headers.get("White", "Blancas")
        black = headers.get("Black", "Negras")
        result = headers.get("Result", "*")
        if result not in {"1-0", "0-1", "1/2-1/2", "*"}:
            result = "*"

        board = game.board()
        fens = [board.fen()]
        san_moves: list[str] = []
        uci_moves: list[str] = []
        try:
            for move in game.mainline_moves():
                san_moves.append(board.san(move))
                uci_moves.append(move.uci())
                board.push(move)
                fens.append(board.fen())
        except (ValueError, AssertionError) as exc:
            errors.append(f"Partida {game_number}: secuencia de jugadas incompleta ({exc}).")

        if not san_moves:
            errors.append(f"Partida {game_number}: no contiene jugadas y fue omitida.")
            continue

        date = _normalise_date(headers.get("UTCDate") or headers.get("Date"))
        eco = headers.get("ECO")
        color, resolved_target = _target_color(white, black, target_player)
        fingerprint = "|".join(
            [white.casefold(), black.casefold(), date or "", result, " ".join(uci_moves[:24])]
        )
        dedupe_hash = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
        if dedupe_hash in seen:
            duplicates += 1
            continue
        seen.add(dedupe_hash)

        source_id = headers.get("GameId")
        site_header = headers.get("Site", "").strip()
        if not source_id and site_header.startswith(("http://", "https://")):
            source_id = site_header.rstrip("/").split("/")[-1]
        if source_id in {None, "", "?", "-", "Chess.com", "lichess.org"}:
            source_id = None
        short_hash = dedupe_hash[:12]
        game_id = f"{source}-{source_id or short_hash}"
        if game_id in seen_game_ids:
            game_id = f"{source}-{short_hash}"
        seen_game_ids.add(game_id)
        exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)

        games.append(
            NormalizedGame(
                id=game_id,
                source=source,
                source_game_id=source_id,
                source_confidence=confidence,
                game_type=game_type,
                white=white,
                black=black,
                white_elo=_safe_int(headers.get("WhiteElo")),
                black_elo=_safe_int(headers.get("BlackElo")),
                result=result,
                date=date,
                event=headers.get("Event") if headers.get("Event") != "?" else None,
                site=headers.get("Site") if headers.get("Site") != "?" else None,
                eco=eco if eco and eco != "?" else None,
                opening=_opening_name(headers, eco),
                time_control=headers.get("TimeControl") if headers.get("TimeControl") not in {None, "?", "-"} else None,
                time_class=_time_class(headers.get("TimeControl")),
                player_color=color,
                target_player=resolved_target,
                ply_count=len(san_moves),
                moves=san_moves,
                moves_uci=uci_moves,
                fens=fens,
                pgn=game.accept(exporter),
                dedupe_hash=dedupe_hash,
            )
        )

    if game_number == 0:
        errors.append("No se encontró ninguna partida PGN.")
    return ParseResult(games=games, errors=errors, duplicates=duplicates)
