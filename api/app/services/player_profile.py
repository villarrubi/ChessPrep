from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from math import exp, log

import chess

from api.app.models import NormalizedGame
from api.app.services.pgn import opening_move_path


PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
}


@dataclass
class GameSignals:
    game: NormalizedGame
    valid_moves: bool = True
    player_moves: int = 0
    forcing_moves: int = 0
    captures: int = 0
    checks: int = 0
    developed_minors: set[int] = field(default_factory=set)
    player_castled: str | None = None
    opponent_castled: str | None = None
    queens_traded: bool = False
    endgame_reached: bool = False
    maximum_material_imbalance: int = 0
    book_depth: int = 0

    @property
    def opposite_castling(self) -> bool:
        return bool(
            self.player_castled
            and self.opponent_castled
            and self.player_castled != self.opponent_castled
        )


def _pct(part: float, whole: float) -> float:
    return round(part / whole * 100, 1) if whole else 0.0


def _outcome(game: NormalizedGame) -> str:
    if game.result == "1/2-1/2":
        return "draw"
    if game.result == "*":
        return "unknown"
    won = (game.player_color == "white" and game.result == "1-0") or (
        game.player_color == "black" and game.result == "0-1"
    )
    return "win" if won else "loss"


def _record(games: list[NormalizedGame]) -> dict[str, float | int]:
    outcomes = [_outcome(game) for game in games]
    wins = outcomes.count("win")
    draws = outcomes.count("draw")
    losses = outcomes.count("loss")
    decided = wins + draws + losses
    return {
        "games": len(games),
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "score_pct": round((wins + draws * 0.5) / decided * 100, 1) if decided else 0.0,
    }


def _material_balance(board: chess.Board, player_color: chess.Color) -> int:
    player = sum(
        len(board.pieces(piece_type, player_color)) * value
        for piece_type, value in PIECE_VALUES.items()
    )
    opponent = sum(
        len(board.pieces(piece_type, not player_color)) * value
        for piece_type, value in PIECE_VALUES.items()
    )
    return player - opponent


def _is_endgame(board: chess.Board) -> bool:
    if board.queens:
        return False
    non_pawn_material = sum(
        len(board.pieces(piece_type, color)) * value
        for color in chess.COLORS
        for piece_type, value in PIECE_VALUES.items()
        if piece_type != chess.PAWN
    )
    return non_pawn_material <= 20


def _analyse_game(game: NormalizedGame) -> GameSignals:
    signals = GameSignals(game=game, valid_moves=bool(game.moves_uci))
    if not game.moves_uci:
        return signals
    path = opening_move_path(game.moves_uci)
    signals.book_depth = path[-1].ply if path else 0
    board = chess.Board()
    player_color = chess.WHITE if game.player_color == "white" else chess.BLACK
    player_back_rank = 0 if player_color == chess.WHITE else 7

    try:
        for ply, uci in enumerate(game.moves_uci, start=1):
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                signals.valid_moves = False
                break
            actor = board.turn
            is_player_move = actor == player_color
            piece = board.piece_at(move.from_square)
            capture = board.is_capture(move)
            castling = board.is_castling(move)

            if is_player_move:
                signals.player_moves += 1
                signals.captures += int(capture)
                if (
                    piece
                    and piece.piece_type in {chess.KNIGHT, chess.BISHOP}
                    and ply <= 20
                    and chess.square_rank(move.from_square) == player_back_rank
                    and chess.square_rank(move.to_square) != player_back_rank
                ):
                    signals.developed_minors.add(move.from_square)
                if castling:
                    signals.player_castled = (
                        "kingside" if chess.square_file(move.to_square) == 6 else "queenside"
                    )
            elif castling:
                signals.opponent_castled = (
                    "kingside" if chess.square_file(move.to_square) == 6 else "queenside"
                )

            board.push(move)
            if is_player_move and board.is_check():
                signals.checks += 1
            if is_player_move and (capture or board.is_check()):
                signals.forcing_moves += 1
            signals.maximum_material_imbalance = max(
                signals.maximum_material_imbalance,
                abs(_material_balance(board, player_color)),
            )
            if not board.queens:
                signals.queens_traded = True
            if _is_endgame(board):
                signals.endgame_reached = True
    except (ValueError, AssertionError):
        signals.valid_moves = False
    return signals


def _opening_cards(games: list[NormalizedGame], signals: list[GameSignals]) -> list[dict[str, object]]:
    cards: list[dict[str, object]] = []
    signal_by_id = {signal.game.id: signal for signal in signals}
    for color in ("white", "black"):
        selected = [game for game in games if game.player_color == color]
        groups = Counter((game.eco or "—", game.opening) for game in selected)
        top = groups.most_common(3)
        depths = [
            signal_by_id[game.id].book_depth
            for game in selected
            if len(game.moves_uci) >= 8 and signal_by_id[game.id].valid_moves
        ]
        average_depth = round(sum(depths) / len(depths), 1) if depths else 0.0
        early_departures = sum(depth < 8 for depth in depths)
        top_share = _pct(top[0][1], len(selected)) if top else 0.0
        cards.append(
            {
                "color": color,
                **_record(selected),
                "unique_openings": len(groups),
                "top_share_pct": top_share,
                "average_book_ply": average_depth,
                "early_departure_pct": _pct(early_departures, len(depths)),
                "line_tendency": (
                    "coincidencia ECO prolongada" if average_depth >= 18
                    else "clasificación ECO de recorrido corto" if average_depth < 10
                    else "coincidencia ECO intermedia"
                ),
                "top_openings": [
                    {
                        "eco": eco,
                        "opening": opening,
                        "games": count,
                        "share_pct": _pct(count, len(selected)),
                    }
                    for (eco, opening), count in top
                ],
            }
        )
    return cards


def _confidence(sample_size: int, valid_games: int) -> dict[str, object]:
    move_coverage = _pct(valid_games, sample_size)
    level = "alta" if sample_size >= 25 and move_coverage >= 90 else (
        "media" if sample_size >= 10 and move_coverage >= 75 else "baja"
    )
    return {
        "level": level,
        "usable_games": valid_games,
        "sample_games": sample_size,
        "move_coverage_pct": move_coverage,
        "text": (
            f"Cobertura {level}: {sample_size} partidas y jugadas válidas en "
            f"el {move_coverage:.1f}% de la muestra."
        ),
    }


def _observation(
    observation_id: str,
    name: str,
    value: float | int,
    unit: str,
    summary: str,
    evidence: list[str],
    *,
    numerator: float | int | None = None,
    denominator: float | int | None = None,
) -> dict[str, object]:
    return {
        "id": observation_id,
        "name": name,
        "value": value,
        "unit": unit,
        "summary": summary,
        "evidence": evidence,
        "numerator": numerator,
        "denominator": denominator,
    }


def _effective_repertoire_size(groups: Counter[tuple[str, str, str]], total: int) -> float:
    """Return the Shannon effective count, a sample descriptor rather than a score."""

    if not groups or not total:
        return 0.0
    entropy = -sum((count / total) * log(count / total) for count in groups.values())
    return round(exp(entropy), 1)


def _game_ids(games: list[NormalizedGame], limit: int = 5) -> list[str]:
    """Return a small, stable set of examples without duplicating game data."""

    return [game.id for game in games[:limit]]


def _finding(
    title: str,
    text: str,
    games: list[NormalizedGame],
    *,
    confidence: str = "media",
) -> dict[str, object]:
    return {
        "title": title,
        "text": text,
        "confidence": confidence,
        "evidence_game_ids": _game_ids(games),
    }


def calculate_player_profile(games: list[NormalizedGame]) -> dict[str, object]:
    """Describe only facts that can be read directly from the PGN sample.

    Style preferences are intentionally absent here. They are calculated in the
    browser by comparing the played move with similarly strong Stockfish lines.
    """

    signals = [_analyse_game(game) for game in games]
    valid = [signal for signal in signals if signal.valid_moves]
    player_moves = sum(signal.player_moves for signal in valid)
    forcing_moves = sum(signal.forcing_moves for signal in valid)
    captures = sum(signal.captures for signal in valid)
    checks = sum(signal.checks for signal in valid)

    development_candidates = [signal for signal in valid if signal.game.ply_count >= 16]
    castling_candidates = [signal for signal in valid if signal.game.ply_count >= 16]
    queen_trade_candidates = [signal for signal in valid if signal.game.ply_count >= 30]
    developed_minors = sum(len(signal.developed_minors) for signal in development_candidates)
    development_slots = len(development_candidates) * 4
    castled_games = sum(bool(signal.player_castled) for signal in castling_candidates)
    long_castles = sum(signal.player_castled == "queenside" for signal in castling_candidates)
    opposite_castles = sum(signal.opposite_castling for signal in castling_candidates)
    queen_trade_games = sum(signal.queens_traded for signal in queen_trade_candidates)
    imbalance_games = sum(signal.maximum_material_imbalance >= 3 for signal in valid)

    development_rate = developed_minors / development_slots if development_slots else 0.0
    castling_rate = castled_games / len(castling_candidates) if castling_candidates else 0.0
    long_castling_rate = long_castles / len(castling_candidates) if castling_candidates else 0.0
    opposite_castling_rate = opposite_castles / len(castling_candidates) if castling_candidates else 0.0
    queen_trade_rate = queen_trade_games / len(queen_trade_candidates) if queen_trade_candidates else 0.0
    imbalance_rate = imbalance_games / len(valid) if valid else 0.0

    opening_cards = _opening_cards(games, signals)
    book_depths = [signal.book_depth for signal in valid if len(signal.game.moves_uci) >= 8]
    average_book_depth = sum(book_depths) / len(book_depths) if book_depths else 0.0
    opening_groups = Counter((game.player_color, game.eco or "—", game.opening) for game in games)
    top_opening_count = max(opening_groups.values(), default=0)
    top_opening_share = top_opening_count / len(games) if games else 0.0
    effective_openings = _effective_repertoire_size(opening_groups, len(games))

    overall = _record(games)
    loss_rate = overall["losses"] / max(1, overall["games"])
    observed_patterns = [
        _observation(
            "forcing_moves",
            "Jaques y capturas",
            _pct(forcing_moves, player_moves),
            "% de jugadas",
            "Frecuencia bruta de jugadas forzantes; no mide agresividad ni calidad.",
            [
                f"{forcing_moves} de {player_moves} jugadas propias fueron jaques o capturas.",
                f"Desglose: {captures} capturas y {checks} jaques.",
                "Un cambio hacia un final y un ataque al rey cuentan igual aquí; Stockfish los separa después.",
            ],
            numerator=forcing_moves,
            denominator=player_moves,
        ),
        _observation(
            "development",
            "Desarrollo hasta la jugada 10",
            _pct(developed_minors, development_slots),
            "% de piezas menores",
            "Caballos y alfiles que abandonaron su casilla inicial durante las diez primeras jugadas.",
            [
                f"{developed_minors} desarrollos observados sobre {development_slots} posibles.",
                "Es una secuencia de hechos, no una nota de juego posicional.",
            ],
            numerator=developed_minors,
            denominator=development_slots,
        ),
        _observation(
            "castling",
            "Enroque",
            _pct(castled_games, len(castling_candidates)),
            "% de partidas",
            "Partidas de al menos ocho jugadas en las que el jugador llegó a enrocar.",
            [
                f"{castled_games} de {len(castling_candidates)} partidas elegibles.",
                f"{long_castles} enroques largos y {opposite_castles} partidas con enroques opuestos.",
                "Enrocar con frecuencia no demuestra por sí solo solidez ni juego defensivo.",
            ],
            numerator=castled_games,
            denominator=len(castling_candidates),
        ),
        _observation(
            "queen_trades",
            "Finales sin damas",
            _pct(queen_trade_games, len(queen_trade_candidates)),
            "% de partidas largas",
            "La partida llegó a una posición sin damas; no indica quién propició el cambio.",
            [
                f"{queen_trade_games} de {len(queen_trade_candidates)} partidas de al menos quince jugadas.",
                "Para hablar de preferencia por simplificar hay que comprobar que existían alternativas equivalentes.",
            ],
            numerator=queen_trade_games,
            denominator=len(queen_trade_candidates),
        ),
        _observation(
            "material_imbalance",
            "Desequilibrio material",
            _pct(imbalance_games, len(valid)),
            "% de partidas",
            "Partidas que alcanzaron una diferencia material absoluta de tres puntos o más.",
            [
                f"{imbalance_games} de {len(valid)} partidas con jugadas válidas.",
                "No distingue sacrificios voluntarios, errores ni material ganado; el motor sí deberá hacerlo.",
            ],
            numerator=imbalance_games,
            denominator=len(valid),
        ),
        _observation(
            "eco_depth",
            "Recorrido ECO",
            round(average_book_depth / 2, 1),
            "jugadas de media",
            "Última posición que coincide con la clasificación ECO incluida en la aplicación.",
            [
                f"Media de {average_book_depth:.1f} plies en {len(book_depths)} partidas comparables.",
                "No es profundidad teórica: salir de ECO puede ser una transposición o una limitación de la base.",
            ],
            denominator=len(book_depths),
        ),
        _observation(
            "repertoire",
            "Concentración del repertorio",
            round(top_opening_share * 100, 1),
            "% en la opción más repetida",
            "Peso de la combinación color + apertura más frecuente dentro de esta muestra.",
            [
                f"{top_opening_count} de {len(games)} partidas pertenecen al grupo más repetido.",
                f"Hay {len(opening_groups)} grupos distintos y una diversidad efectiva de {effective_openings:.1f}.",
                "La cifra depende del tamaño y del filtro de la muestra; no mide conocimiento teórico.",
            ],
            numerator=top_opening_count,
            denominator=len(games),
        ),
    ]

    if not games:
        descriptors = ["sin partidas en este filtro"]
        headline = "Sin muestra para describir"
        sample_paragraph = "No hay partidas en el ritmo seleccionado. Cambia el filtro para obtener datos observables."
        opening_paragraph = "Sin jugadas no se calculan coincidencias ECO ni decisiones de estilo."
    elif not valid:
        descriptors = ["jugadas no disponibles"]
        headline = "Hay resultados, pero faltan las jugadas"
        sample_paragraph = (
            f"La muestra contiene {len(games)} resultados, pero ninguna secuencia de jugadas válida. "
            "Un resultado aislado no permite describir el estilo del jugador."
        )
        opening_paragraph = "Tampoco se puede separar preparación, improvisación, simplificación o ataque sin posiciones."
    else:
        descriptors = [f"{len(valid)} partidas con jugadas", f"{player_moves} decisiones observadas"]
        if len(castling_candidates) >= 8 and castling_rate >= 0.7:
            descriptors.append("enroque recurrente")
        if len(queen_trade_candidates) >= 8 and queen_trade_rate >= 0.6:
            descriptors.append("muchos finales sin damas")
        if len(games) >= 8 and top_opening_share >= 0.35:
            descriptors.append("repertorio concentrado en la muestra")
        if len(games) >= 8 and effective_openings >= 5:
            descriptors.append("varias familias de apertura")

        if len(games) >= 8 and top_opening_share >= 0.4:
            headline = "Un núcleo de apertura domina la muestra"
        elif len(queen_trade_candidates) >= 8 and queen_trade_rate >= 0.65:
            headline = "Los finales sin damas aparecen con frecuencia"
        elif len(castling_candidates) >= 8 and castling_rate >= 0.75:
            headline = "El enroque es un patrón recurrente"
        else:
            headline = "Qué ocurre realmente en sus partidas"

        sample_paragraph = (
            f"Se han leído {player_moves} decisiones propias en {len(valid)} partidas. Hubo {checks} jaques y "
            f"{captures} capturas ({_pct(forcing_moves, player_moves):.1f}% en conjunto), pero el informe no "
            "los traduce a «agresividad»: la misma cifra puede venir de ataques, recapturas, cambios o errores."
        )
        opening_paragraph = (
            f"La coincidencia con la clasificación ECO llega hasta la jugada {average_book_depth / 2:.1f} de media. "
            f"La opción más repetida ocupa el {top_opening_share * 100:.1f}% y la muestra contiene "
            f"{len(opening_groups)} grupos de color y apertura. Esto describe repertorio observado, no memoria, "
            "invención ni calidad objetiva."
        )

    patterns: list[dict[str, object]] = []
    questions: list[dict[str, object]] = []
    white_games = [game for game in games if game.player_color == "white"]
    black_games = [game for game in games if game.player_color == "black"]
    white_record = _record(white_games)
    black_record = _record(black_games)
    if min(len(white_games), len(black_games)) >= 3:
        difference = float(white_record["score_pct"]) - float(black_record["score_pct"])
        if abs(difference) >= 12:
            better_color = "blancas" if difference > 0 else "negras"
            weaker_color = "negras" if difference > 0 else "blancas"
            better = white_record if difference > 0 else black_record
            weaker = black_record if difference > 0 else white_record
            patterns.append(_finding(
                f"Mejor resultado con {better_color}",
                f"Score del {better['score_pct']:.1f}% en {better['games']} partidas.",
                white_games if difference > 0 else black_games,
            ))
            questions.append(_finding(
                f"Diferencia de resultados con {weaker_color}",
                f"Score del {weaker['score_pct']:.1f}%, {abs(difference):.1f} puntos por debajo del otro color.",
                black_games if difference > 0 else white_games,
            ))
    if len(castling_candidates) >= 8 and castling_rate >= 0.7:
        castled_examples = [signal.game for signal in castling_candidates if signal.player_castled]
        patterns.append(_finding(
            "Enroque recurrente",
            f"Enroca en el {castling_rate * 100:.1f}% de las partidas con suficiente recorrido.",
            castled_examples,
        ))
    elif len(castling_candidates) >= 8 and castling_rate < 0.45:
        uncastled_games = [signal.game for signal in castling_candidates if not signal.player_castled]
        questions.append(_finding(
            "Muchas partidas sin enroque",
            f"Enroca en el {castling_rate * 100:.1f}% de las partidas elegibles; hay que revisar si fue elección, necesidad o final temprano.",
            uncastled_games,
        ))
    if average_book_depth >= 18:
        deep_book_games = [signal.game for signal in valid if signal.book_depth >= average_book_depth]
        patterns.append(_finding(
            "Coincidencia ECO prolongada",
            f"Permanece una media de {average_book_depth / 2:.1f} jugadas en posiciones clasificadas.",
            deep_book_games,
        ))
    elif book_depths and average_book_depth < 10:
        early_book_games = [signal.game for signal in valid if signal.book_depth < 10]
        questions.append(_finding(
            "Clasificación ECO corta",
            f"La clasificación termina de media en la jugada {average_book_depth / 2:.1f}; puede ser repertorio lateral, improvisación o cobertura limitada de la base.",
            early_book_games,
            confidence="baja",
        ))
    if top_opening_share >= 0.35 and len(games) >= 8:
        top_key = opening_groups.most_common(1)[0][0]
        top_games = [
            game for game in games
            if (game.player_color, game.eco or "—", game.opening) == top_key
        ]
        questions.append(_finding(
            "Núcleo de repertorio predecible",
            f"Una misma combinación de color y apertura aparece en el {top_opening_share * 100:.1f}% de la muestra.",
            top_games,
        ))
    if overall["games"] >= 8 and loss_rate <= 0.2:
        patterns.append(_finding(
            "Baja frecuencia de derrotas",
            f"Pierde el {loss_rate * 100:.1f}% de las partidas de esta selección.",
            [game for game in games if _outcome(game) != "loss"],
        ))
    elif overall["games"] >= 8 and loss_rate >= 0.4:
        questions.append(_finding(
            "Resultados volátiles",
            f"El {loss_rate * 100:.1f}% de la muestra termina en derrota.",
            [game for game in games if _outcome(game) == "loss"],
        ))
    patterns = patterns[:3]
    questions = questions[:3]
    if not valid:
        patterns = [_finding(
            "Sin evidencia de jugadas",
            "No se asignan rasgos de estilo sin partidas observables.",
            [],
            confidence="baja",
        )]
        questions = [_finding(
            "Muestra insuficiente",
            "Selecciona otro ritmo o incorpora partidas con PGN al dossier.",
            [],
            confidence="baja",
        )]
    elif not patterns:
        patterns.append(_finding(
            "Sin patrón dominante",
            "Ningún hecho observable se repite todavía con una muestra suficiente.",
            [signal.game for signal in valid],
            confidence="baja",
        ))
    if games and not questions:
        questions.append(_finding(
            "Falta contraste posicional",
            "Los recuentos directos no muestran una pregunta dominante; Stockfish buscará elecciones y errores repetidos.",
            [signal.game for signal in valid],
            confidence="baja",
        ))

    preparation_plan: list[dict[str, object]] = []
    if games:
        top_key = opening_groups.most_common(1)[0][0] if opening_groups else None
        top_games = [
            game for game in games
            if top_key and (game.player_color, game.eco or "—", game.opening) == top_key
        ]
        if top_key:
            preparation_plan.append({
                "priority": 1,
                "title": f"Preparar el núcleo: {top_key[2]}",
                "text": (
                    "Es la combinación de color y apertura más repetida de la muestra. Estudia sus decisiones "
                    "recurrentes y una alternativa que cambie la estructura, no solo una secuencia de memoria."
                ),
                "evidence_game_ids": _game_ids(top_games),
            })
        if top_opening_share >= 0.35:
            preparation_plan.append({
                "priority": 2,
                "title": "Preparar una segunda rama contra su núcleo",
                "text": (
                    "Busca una alternativa sana que cambie pronto la estructura o el tipo de posición. "
                    "La frecuencia del repertorio sí es evidencia; una supuesta agresividad todavía no."
                ),
                "evidence_game_ids": _game_ids(top_games),
            })
        else:
            preparation_plan.append({
                "priority": 2,
                "title": "Separar la preparación por color y estructura",
                "text": (
                    "El repertorio está repartido: prepara las familias más repetidas y sus decisiones "
                    "estructurales, sin intentar resumirlas en una sola etiqueta."
                ),
                "evidence_game_ids": _game_ids([signal.game for signal in valid]),
            })
        preparation_plan.append({
            "priority": 3,
            "title": "Contrastar la fase más vulnerable con Stockfish",
            "text": (
                "Inicia el análisis local de la muestra: el plan se actualizará con errores por apertura, "
                "medio juego y final, además de preferencias entre alternativas equivalentes."
            ),
            "evidence_game_ids": [],
        })

    middlegames = [game for game in games if game.ply_count >= 30]
    endgames = [signal.game for signal in valid if signal.endgame_reached]
    phases = [
        {
            "id": "opening",
            "name": "Apertura",
            "games": len(book_depths),
            "score_pct": None,
            "text": f"Cobertura ECO media hasta la jugada {average_book_depth / 2:.1f}.",
            "confidence": "media" if len(book_depths) >= 8 else "baja",
        },
        {
            "id": "middlegame",
            "name": "Medio juego",
            **_record(middlegames),
            "text": f"{len(middlegames)} partidas alcanzan al menos 15 jugadas; el score refleja resultados, no calidad de decisión.",
            "confidence": "media" if len(middlegames) >= 8 else "baja",
        },
        {
            "id": "endgame",
            "name": "Final",
            **_record(endgames),
            "text": f"{len(endgames)} partidas alcanzan un final sin damas y con material reducido.",
            "confidence": "media" if len(endgames) >= 8 else "baja",
        },
    ]

    return {
        "version": "observable-patterns-v3",
        "methodology": "Hechos de la muestra · sin puntuaciones de personalidad",
        "sample_size": len(games),
        "analysed_games": len(valid),
        "confidence": _confidence(len(games), len(valid)),
        "headline": headline,
        "descriptors": descriptors,
        "narrative": [sample_paragraph, opening_paragraph],
        "observed_patterns": observed_patterns,
        "patterns": patterns,
        "questions": questions,
        "preparation_plan": preparation_plan,
        "openings": opening_cards,
        "phases": phases,
        "observations": {
            "forcing_move_pct": _pct(forcing_moves, player_moves),
            "capture_pct": _pct(captures, player_moves),
            "check_pct": _pct(checks, player_moves),
            "castling_pct": round(castling_rate * 100, 1),
            "long_castling_pct": round(long_castling_rate * 100, 1),
            "opposite_castling_pct": round(opposite_castling_rate * 100, 1),
            "queen_trade_pct": round(queen_trade_rate * 100, 1),
        },
        "limitations": [
            "Jaques, capturas, avances de peón o enroques opuestos no se convierten en agresividad: pueden ser forzados, simplificadores o errores.",
            "Las preferencias de iniciativa, juego forzante, simplificación y riesgo solo se muestran cuando Stockfish encuentra alternativas de calidad similar.",
            "La salida del libro se compara con la base ECO local; no demuestra por sí sola preparación, invención ni una novedad teórica.",
            "Sin tiempos de reloj por jugada no se infieren apuros de tiempo, impulsividad ni gestión temporal.",
        ],
    }
