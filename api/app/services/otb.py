from __future__ import annotations

from collections.abc import Callable
from datetime import date

from api.app.errors import NotFoundError, ProviderUnavailableError, ValidationError
from api.app.models import FidePlayer, Info64Result, Info64ResultsResponse, Info64Summary


class OtbLookupService:
    """Coordinates verified FIDE identities with Info64 result lookups."""

    def __init__(
        self,
        *,
        get_fide_player: Callable[..., FidePlayer],
        fetch_info64_results: Callable[..., dict[str, object]],
        fide_unavailable_error: type[Exception],
        info64_unavailable_error: type[Exception],
    ) -> None:
        self._get_fide_player = get_fide_player
        self._fetch_info64_results = fetch_info64_results
        self._fide_unavailable_error = fide_unavailable_error
        self._info64_unavailable_error = info64_unavailable_error

    def player(self, fide_id: str, *, include_history: bool = True) -> FidePlayer:
        try:
            return self._get_fide_player(fide_id, include_history=include_history)
        except LookupError as exc:
            raise NotFoundError(str(exc)) from exc
        except self._fide_unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc

    def info64_results(
        self,
        fide_id: str,
        date_from: date | None,
        date_to: date | None,
    ) -> Info64ResultsResponse:
        if date_from and date_to and date_from > date_to:
            raise ValidationError(
                "La fecha inicial no puede ser posterior a la fecha final."
            )
        player = self.player(fide_id, include_history=False)
        try:
            lookup = self._fetch_info64_results(
                player,
                date_from=date_from,
                date_to=date_to,
            )
        except LookupError as exc:
            raise NotFoundError(str(exc)) from exc
        except self._info64_unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc

        results = lookup["results"]
        return Info64ResultsResponse(
            player=player,
            results=results,
            summary=self._summarize(results),
            warnings=lookup["warnings"],
            source_url=lookup["source_url"],
            tournaments_scanned=lookup["tournaments_scanned"],
            tournaments_matched=lookup["tournaments_matched"],
        )

    @staticmethod
    def _summarize(results: list[Info64Result]) -> Info64Summary:
        wins = sum(result.outcome == "win" for result in results)
        draws = sum(result.outcome == "draw" for result in results)
        losses = sum(result.outcome == "loss" for result in results)
        result_dates = sorted(result.date for result in results if result.date)
        return Info64Summary(
            games=len(results),
            wins=wins,
            draws=draws,
            losses=losses,
            score_percentage=(
                round(100 * sum(result.score for result in results) / len(results), 1)
                if results
                else 0.0
            ),
            opponents=len(
                {
                    result.opponent_fide_id or result.opponent_name.casefold()
                    for result in results
                }
            ),
            tournaments=len({result.tournament_url for result in results}),
            walkovers=sum(result.walkover for result in results),
            date_range={
                "from": result_dates[0] if result_dates else None,
                "to": result_dates[-1] if result_dates else None,
            },
        )
