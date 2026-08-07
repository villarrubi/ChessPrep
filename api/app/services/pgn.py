from __future__ import annotations

import hashlib
import io
import re
from collections import Counter
from dataclasses import dataclass

import chess.pgn

from api.app.models import GameType, NormalizedGame
from api.app.services.text import clean_identifier, clean_untrusted_text


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
MAX_GAMES_PER_IMPORT = 500
STANDARD_VARIANTS = {"standard", "standard chess", "chess", "normal"}
STANDARD_START_POSITION = " ".join(chess.STARTING_FEN.split()[:4])
VARIANT_LABELS = {
    "chess960": "Chess960",
    "fischerandom": "Chess960",
    "fischer random": "Chess960",
    "bughouse": "Pasapiezas",
    "crazyhouse": "Crazyhouse",
    "kingofthehill": "Rey de la colina",
    "king of the hill": "Rey de la colina",
    "threecheck": "Tres jaques",
    "three-check": "Tres jaques",
    "antichess": "Antiajedrez",
    "atomic": "Ajedrez atómico",
    "horde": "Horda",
    "racingkings": "Reyes de carrera",
}


@dataclass
class ParseResult:
    games: list[NormalizedGame]
    errors: list[str]
    duplicates: int


# Heavy move payloads are only needed when opening the viewer.
GAME_LIST_EXCLUDE = {"moves", "moves_uci", "fens", "pgn"}


def game_list_item(game: NormalizedGame) -> dict[str, object]:
    return game.model_dump(mode="json", exclude=GAME_LIST_EXCLUDE)


def hydrate_game_for_viewer(game: NormalizedGame) -> NormalizedGame:
    """Fill deferred FEN/PGN fields when a single game is opened."""
    needs_fens = len(game.fens) != len(game.moves_uci) + 1
    needs_pgn = not game.pgn
    if not needs_fens and not needs_pgn:
        return game

    updates: dict[str, object] = {}
    if needs_fens:
        board = chess.Board()
        fens = [board.fen()]
        for uci in game.moves_uci:
            board.push_uci(uci)
            fens.append(board.fen())
        updates["fens"] = fens

    if needs_pgn:
        rebuilt = chess.pgn.Game()
        for key, value in {
            "Event": game.event or "?",
            "Site": game.site or "?",
            "Date": (game.date or "????.??.??").replace("-", "."),
            "White": game.white,
            "Black": game.black,
            "Result": game.result,
            "ECO": game.eco or "?",
            "Opening": game.opening,
            "TimeControl": game.time_control or "-",
            "WhiteElo": str(game.white_elo or "?"),
            "BlackElo": str(game.black_elo or "?"),
        }.items():
            rebuilt.headers[key] = value
        if game.source_game_id:
            rebuilt.headers["GameId"] = game.source_game_id
        node = rebuilt
        for uci in game.moves_uci:
            node = node.add_main_variation(chess.Move.from_uci(uci))
        exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
        updates["pgn"] = rebuilt.accept(exporter)

    return game.model_copy(update=updates)


def variant_label(value: str) -> str:
    cleaned = clean_untrusted_text(value, max_length=80)
    return VARIANT_LABELS.get(cleaned.casefold().replace("_", ""), cleaned or "Variante desconocida")


def variant_exclusion_warning(counts: Counter[str]) -> str:
    total = sum(counts.values())
    details = ", ".join(
        f"{label}: {count}" if count > 1 else label
        for label, count in sorted(counts.items())
    )
    if total == 1:
        return f"Se omitió 1 partida de variante no estándar ({details})."
    return f"Se omitieron {total} partidas de variantes no estándar ({details})."


def _non_standard_variant(headers: chess.pgn.Headers) -> str | None:
    raw_variant = clean_untrusted_text(headers.get("Variant"), max_length=80)
    if raw_variant and raw_variant.casefold() not in STANDARD_VARIANTS:
        return variant_label(raw_variant)

    fen = clean_untrusted_text(headers.get("FEN"), max_length=120)
    custom_setup = headers.get("SetUp") == "1" or bool(fen)
    if custom_setup and " ".join(fen.split()[:4]) != STANDARD_START_POSITION:
        return "Posición inicial no estándar"
    return None


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
    explicit = clean_untrusted_text(headers.get("Opening"), max_length=180)
    variation = clean_untrusted_text(headers.get("Variation"), max_length=120)
    if explicit and explicit not in {"?", "Unknown"}:
        opening = f"{explicit} · {variation}" if variation and variation != "?" else explicit
        return clean_untrusted_text(opening, max_length=240)
    return ECO_NAMES.get(eco or "", "Apertura sin clasificar")


def _fide_id(value: str | None) -> str | None:
    clean = clean_untrusted_text(value, max_length=10)
    return clean if re.fullmatch(r"\d{5,10}", clean) else None


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
    excluded_variants: Counter[str] = Counter()
    duplicates = 0
    game_number = 0

    while True:
        if game_number >= MAX_GAMES_PER_IMPORT:
            errors.append(
                f"El PGN supera el límite de {MAX_GAMES_PER_IMPORT} partidas por importación."
            )
            break
        try:
            game = chess.pgn.read_game(stream)
        except Exception as exc:  # python-chess reports malformed tokens here.
            detail = clean_untrusted_text(exc, max_length=300)
            errors.append(f"Partida {game_number + 1}: PGN no válido ({detail}).")
            break
        if game is None:
            break
        game_number += 1
        headers = game.headers
        non_standard_variant = _non_standard_variant(headers)
        if non_standard_variant:
            excluded_variants[non_standard_variant] += 1
            continue
        if game.errors:
            detail = clean_untrusted_text(game.errors[0], max_length=300)
            errors.append(f"Partida {game_number}: se ignoraron jugadas no válidas ({detail}).")

        white = clean_untrusted_text(headers.get("White"), max_length=160) or "Blancas"
        black = clean_untrusted_text(headers.get("Black"), max_length=160) or "Negras"
        result = headers.get("Result", "*")
        if result not in {"1-0", "0-1", "1/2-1/2", "*"}:
            result = "*"

        board = game.board()
        san_moves: list[str] = []
        uci_moves: list[str] = []
        try:
            # Defer FEN/PGN materialization until a game is opened in the viewer.
            # Building every ply's FEN and re-exporting PGN dominated parse CPU.
            for move in game.mainline_moves():
                san_moves.append(board.san(move))
                uci_moves.append(move.uci())
                board.push(move)
        except (ValueError, AssertionError) as exc:
            detail = clean_untrusted_text(exc, max_length=300)
            errors.append(f"Partida {game_number}: secuencia de jugadas incompleta ({detail}).")

        if not san_moves:
            errors.append(f"Partida {game_number}: no contiene jugadas y fue omitida.")
            continue

        date = _normalise_date(headers.get("UTCDate") or headers.get("Date"))
        raw_eco = clean_untrusted_text(headers.get("ECO"), max_length=8).upper()
        eco = raw_eco if re.fullmatch(r"[A-E]\d{2}", raw_eco) else None
        color, resolved_target = _target_color(white, black, target_player)
        fingerprint = "|".join(
            [white.casefold(), black.casefold(), date or "", result, " ".join(uci_moves[:24])]
        )
        dedupe_hash = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
        if dedupe_hash in seen:
            duplicates += 1
            continue
        seen.add(dedupe_hash)

        source_id = clean_identifier(headers.get("GameId"))
        site_header = clean_untrusted_text(headers.get("Site"), max_length=500)
        if not source_id and site_header.startswith(("http://", "https://")):
            source_id = clean_identifier(site_header.rstrip("/").split("/")[-1])
        if source_id in {None, "", "?", "-", "Chess.com", "lichess.org"}:
            source_id = None
        short_hash = dedupe_hash[:12]
        game_id = f"{source}-{source_id or short_hash}"
        if game_id in seen_game_ids:
            game_id = f"{source}-{short_hash}"
        seen_game_ids.add(game_id)

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
                white_fide_id=_fide_id(headers.get("WhiteFideId") or headers.get("WhiteFideID")),
                black_fide_id=_fide_id(headers.get("BlackFideId") or headers.get("BlackFideID")),
                result=result,
                date=date,
                event=(
                    clean_untrusted_text(headers.get("Event"), max_length=240)
                    if headers.get("Event") != "?"
                    else None
                ),
                site=site_header if site_header and site_header != "?" else None,
                eco=eco,
                opening=_opening_name(headers, eco),
                time_control=(
                    clean_untrusted_text(headers.get("TimeControl"), max_length=64)
                    if headers.get("TimeControl") not in {None, "?", "-"}
                    else None
                ),
                time_class=_time_class(headers.get("TimeControl")),
                player_color=color,
                target_player=resolved_target,
                ply_count=len(san_moves),
                moves=san_moves,
                moves_uci=uci_moves,
                fens=[],
                pgn="",
                dedupe_hash=dedupe_hash,
            )
        )

    if game_number == 0:
        errors.append("No se encontró ninguna partida PGN.")
    if excluded_variants:
        errors.append(variant_exclusion_warning(excluded_variants))
    return ParseResult(games=games, errors=errors, duplicates=duplicates)
