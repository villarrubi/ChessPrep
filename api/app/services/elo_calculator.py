from __future__ import annotations

from collections.abc import Callable
from typing import Any

from api.app.errors import NotFoundError, ProviderUnavailableError, ValidationError
from api.app.models import (
    EloDiscipline,
    EloHeadToHeadRequest,
    EloInitialGameInput,
    EloInitialRequest,
    EloPlayerInput,
    FidePlayer,
)
from api.app.services.elo import calculate_head_to_head, calculate_initial_rating


class EloCalculatorService:
    """Resolves FIDE data and delegates deterministic ELO mathematics."""

    _SCORE_BY_RESULT = {"win": 1.0, "draw": 0.5, "loss": 0.0}

    def __init__(
        self,
        *,
        get_player: Callable[..., FidePlayer],
        get_current_ratings: Callable[
            [list[str], EloDiscipline], dict[str, dict[str, int]]
        ],
        get_historical_rating: Callable[
            [str, EloDiscipline, str], dict[str, Any]
        ],
        unavailable_error: type[Exception],
    ) -> None:
        self._get_player = get_player
        self._get_current_ratings = get_current_ratings
        self._get_historical_rating = get_historical_rating
        self._unavailable_error = unavailable_error

    def head_to_head(self, payload: EloHeadToHeadRequest) -> dict[str, object]:
        players = self.resolve_current_players(payload)
        calculation = calculate_head_to_head(
            int(players[0]["rating"]),
            int(players[0]["k"]),
            int(players[1]["rating"]),
            int(players[1]["k"]),
            payload.discipline,
        )
        return {
            "discipline": payload.discipline,
            "player_a": players[0],
            "player_b": players[1],
            **calculation,
        }

    def resolve_current_players(
        self,
        payload: EloHeadToHeadRequest,
    ) -> list[dict[str, object]]:
        inputs = [payload.player_a, payload.player_b]
        fide_ids = [player.fide_id for player in inputs if player.fide_id]
        try:
            official_ratings = (
                self._get_current_ratings(fide_ids, payload.discipline)
                if fide_ids
                else {}
            )
        except LookupError as exc:
            raise ValidationError(str(exc)) from exc
        except self._unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc

        resolved: list[dict[str, object]] = []
        for index, player_input in enumerate(inputs):
            label = "A" if index == 0 else "B"
            if player_input.fide_id:
                resolved.append(
                    self._resolve_official_player(
                        player_input,
                        payload.discipline,
                        official_ratings.get(player_input.fide_id),
                    )
                )
                continue
            if player_input.rating is None or player_input.k is None:
                raise ValidationError(
                    f"Indica ID FIDE o Elo y K manuales para el jugador {label}."
                )
            resolved.append(
                {
                    "name": f"Jugador {label}",
                    "fide_id": None,
                    "rating": player_input.rating,
                    "k": player_input.k,
                    "source": "manual",
                }
            )
        return resolved

    def initial_rating(self, payload: EloInitialRequest) -> dict[str, object]:
        resolved_games = self._resolve_initial_games(payload)
        calculation = calculate_initial_rating(resolved_games)
        warnings = self._initial_rating_warnings(calculation, resolved_games)
        return {
            "discipline": payload.discipline,
            "games": resolved_games,
            "warnings": warnings,
            **calculation,
        }

    def _resolve_official_player(
        self,
        player_input: EloPlayerInput,
        discipline: EloDiscipline,
        current: dict[str, int] | None,
    ) -> dict[str, object]:
        if player_input.rating is not None or player_input.k is not None:
            raise ValidationError(
                "No mezcles un ID FIDE con Elo o K manuales en el mismo jugador."
            )
        if not current:
            raise ValidationError(
                f"El jugador {player_input.fide_id} no tiene Elo {discipline.value} "
                "en la lista mensual actual de FIDE."
            )
        try:
            profile = self._get_player(player_input.fide_id, include_history=False)
        except LookupError as exc:
            raise NotFoundError(str(exc)) from exc
        except self._unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc
        return {
            "name": profile.name,
            "fide_id": profile.fide_id,
            "rating": current["rating"],
            "k": current["k"],
            "source": "fide_current_list",
        }

    def _resolve_initial_games(
        self,
        payload: EloInitialRequest,
    ) -> list[dict[str, object]]:
        resolved_games: list[dict[str, object]] = []
        profile_cache: dict[str, FidePlayer] = {}
        history_cache: dict[
            tuple[str, EloDiscipline, str],
            dict[str, Any],
        ] = {}

        for index, game in enumerate(payload.games, start=1):
            if not game.fide_id:
                if game.rating is None:
                    raise ValidationError(
                        f"Indica el ID FIDE o el Elo manual del rival {index}."
                    )
                resolved_games.append(
                    self._manual_initial_game(payload, game, index)
                )
                continue
            if game.rating is not None:
                raise ValidationError(
                    f"No mezcles ID FIDE y Elo manual en el rival {index}."
                )
            try:
                if game.fide_id not in profile_cache:
                    profile_cache[game.fide_id] = self._get_player(
                        game.fide_id,
                        include_history=False,
                    )
                profile = profile_cache[game.fide_id]
                key = (game.fide_id, payload.discipline, game.period)
                if key not in history_cache:
                    history_cache[key] = self._get_historical_rating(*key)
                historical = history_cache[key]
            except LookupError as exc:
                raise NotFoundError(str(exc)) from exc
            except self._unavailable_error as exc:
                raise ProviderUnavailableError(str(exc)) from exc
            if historical["rating"] is None:
                raise ValidationError(
                    f"{profile.name} no tenía Elo {payload.discipline.value} "
                    f"publicado en {game.period}."
                )
            resolved_games.append(
                {
                    "name": profile.name,
                    "fide_id": game.fide_id,
                    "rating": historical["rating"],
                    "rating_source": historical["rating_source"],
                    "standard_fallback": historical["standard_fallback"],
                    "period": game.period,
                    "result": game.result.value,
                    "score": self._SCORE_BY_RESULT[game.result.value],
                    "source": "fide_history",
                }
            )
        return resolved_games

    def _manual_initial_game(
        self,
        payload: EloInitialRequest,
        game: EloInitialGameInput,
        index: int,
    ) -> dict[str, object]:
        return {
            "name": f"Rival {index}",
            "fide_id": None,
            "rating": game.rating,
            "rating_source": payload.discipline.value,
            "standard_fallback": False,
            "period": game.period,
            "result": game.result.value,
            "score": self._SCORE_BY_RESULT[game.result.value],
            "source": "manual",
        }

    @staticmethod
    def _initial_rating_warnings(
        calculation: dict[str, object],
        games: list[dict[str, object]],
    ) -> list[str]:
        warnings: list[str] = []
        if calculation["game_count"] < 5:
            warnings.append(
                "FIDE exige al menos cinco partidas reales contra rivales evaluados."
            )
        if calculation["real_score"] == 0:
            warnings.append(
                "Un resultado inicial de cero puntos no produce una valoración publicada."
            )
        if not calculation["within_26_months"]:
            warnings.append(
                "Las partidas abarcan más de 26 periodos mensuales consecutivos."
            )
        if calculation["initial_rating"] < 1400:
            warnings.append(
                "El resultado queda por debajo del suelo de publicación de 1400."
            )
        if calculation["capped_at_2200"]:
            warnings.append("FIDE limita la valoración inicial máxima a 2200.")
        if any(game["standard_fallback"] for game in games):
            warnings.append(
                "En rápido o blitz se utilizó el Elo estándar cuando el rival no "
                "tenía Elo propio en esa lista."
            )
        return warnings
