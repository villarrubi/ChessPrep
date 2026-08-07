from __future__ import annotations

import hashlib
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from api.app.errors import (
    BadRequestError,
    NotFoundError,
    ProviderUnavailableError,
    ValidationError,
)
from api.app.models import (
    CombinedPlayerCreate,
    GameType,
    PlayerRef,
    TemporaryDataset,
)
from api.app.services.demo import DemoDatasetService
from api.app.services.pgn import ParseResult
from api.app.services.store import DatasetStore


@dataclass(frozen=True, slots=True)
class OnlineProvider:
    """Adapter that gives every online platform the same application contract."""

    source: str
    label: str
    get_player: Callable[[str], PlayerRef]
    fetch_games: Callable[[str, int | None], ParseResult]
    unavailable_error: type[Exception]


class OnlinePlayerService:
    """Coordinates online providers and the temporary dataset store."""

    def __init__(
        self,
        store: DatasetStore,
        demo: DemoDatasetService,
        providers: tuple[OnlineProvider, ...],
    ) -> None:
        self._store = store
        self._demo = demo
        self._providers = {provider.source: provider for provider in providers}

    def search(self, query: str, source: str) -> dict[str, object]:
        clean_query = query.strip()
        demo_match = clean_query.casefold() in {
            "jugador de muestra",
            "demo",
            "muestra",
        }
        results = [self._demo.player] if demo_match else []
        messages: list[str] = []
        provider_available = False

        for provider in self._selected_providers(source):
            try:
                results.append(provider.get_player(clean_query))
                provider_available = True
            except LookupError:
                messages.append(
                    f"No se encontró una cuenta exacta en {provider.label}."
                )
                provider_available = True
            except provider.unavailable_error as exc:
                messages.append(str(exc))

        return {
            "results": results,
            "provider_available": provider_available,
            "message": " ".join(messages) or None,
        }

    def detail(self, source: str, external_id: str) -> PlayerRef:
        if source == "demo" and external_id == self._demo.player.external_id:
            return self._demo.ensure().player
        existing = self._store.get_for_player(source, external_id)
        if existing:
            return existing.player

        provider = self._providers.get(source)
        if provider is None:
            raise NotFoundError("Jugador no encontrado.")
        try:
            return provider.get_player(external_id)
        except LookupError as exc:
            raise NotFoundError(str(exc)) from exc
        except provider.unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc

    def get_dataset(self, source: str, external_id: str) -> TemporaryDataset:
        if source == "demo" and external_id == self._demo.player.external_id:
            return self._demo.ensure()
        existing = self._store.get_for_player(source, external_id)
        if existing:
            return existing

        provider = self._providers.get(source)
        if provider is None:
            raise NotFoundError("No se encontró el conjunto temporal.")
        try:
            player = provider.get_player(external_id)
            parsed = provider.fetch_games(player.username, None)
        except LookupError as exc:
            raise NotFoundError(str(exc)) from exc
        except provider.unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc
        if not parsed.games:
            # This message is kept for API compatibility with existing clients.
            raise ValidationError("Lichess no devolvió partidas públicas utilizables.")
        return self._store.create(player, parsed.games)

    def refresh(
        self,
        source: str,
        external_id: str,
        max_games: int,
    ) -> dict[str, object]:
        if source == "demo":
            return {
                "dataset": self._demo.ensure(),
                "warnings": [],
                "duplicates": 0,
            }
        provider = self._providers.get(source)
        if provider is None:
            raise BadRequestError("El proveedor indicado no admite actualización.")
        try:
            player = provider.get_player(external_id)
            parsed = provider.fetch_games(player.username, max_games)
        except LookupError as exc:
            raise NotFoundError(str(exc)) from exc
        except provider.unavailable_error as exc:
            raise ProviderUnavailableError(str(exc)) from exc
        if not parsed.games:
            raise ValidationError("No se encontraron partidas públicas válidas.")
        return {
            "dataset": self._store.create(player, parsed.games),
            "warnings": parsed.errors,
            "duplicates": parsed.duplicates,
        }

    def combine(
        self,
        payload: CombinedPlayerCreate,
        max_games: int,
    ) -> tuple[TemporaryDataset, list[str], int]:
        handles = {
            "lichess": payload.lichess_username,
            "chess.com": payload.chesscom_username,
        }
        if not any(value and value.strip() for value in handles.values()):
            raise ValidationError(
                "Indica al menos un usuario de Lichess o Chess.com."
            )

        jobs = [
            (source, raw_handle.strip())
            for source, raw_handle in handles.items()
            if raw_handle and raw_handle.strip()
        ]
        requested = len(jobs)
        players: list[PlayerRef] = []
        games = []
        warnings: list[str] = []

        def _load_source(source: str, handle: str) -> tuple[str, PlayerRef | None, ParseResult | None, str | None]:
            provider = self._providers[source]
            try:
                player = provider.get_player(handle)
                parsed = provider.fetch_games(player.username, max_games)
                return source, player, parsed, None
            except (LookupError, provider.unavailable_error) as exc:
                return source, None, None, f"{provider.label}: {exc}"

        # Provider HTTP calls dominate wall time; overlap Lichess and Chess.com.
        with ThreadPoolExecutor(max_workers=max(1, len(jobs))) as pool:
            futures = [pool.submit(_load_source, source, handle) for source, handle in jobs]
            results_by_source: dict[
                str, tuple[PlayerRef | None, ParseResult | None, str | None]
            ] = {}
            for future in as_completed(futures):
                source, player, parsed, warning = future.result()
                results_by_source[source] = (player, parsed, warning)

        # Keep the historical lichess-then-chess.com merge order.
        for source, _handle in jobs:
            player, parsed, warning = results_by_source[source]
            if warning:
                warnings.append(warning)
                continue
            assert player is not None and parsed is not None
            players.append(player)
            games.extend(parsed.games)
            warnings.extend(parsed.errors)

        if not games:
            detail = " ".join(warnings) or "Ninguna plataforma devolvió partidas públicas."
            raise ValidationError(detail)

        unique_games = {}
        for game in games:
            unique_games.setdefault(game.dedupe_hash, game)
        duplicates = len(games) - len(unique_games)
        identifier_source = "|".join(
            value.strip().casefold()
            for value in handles.values()
            if value and value.strip()
        )
        external_id = hashlib.sha256(
            identifier_source.encode("utf-8")
        ).hexdigest()[:16]
        display_player = next(
            (player for player in players if " " in player.display_name),
            players[0],
        )
        combined_player = PlayerRef(
            source="combined",
            external_id=external_id,
            username=" + ".join(player.username for player in players),
            display_name=display_player.display_name,
            title=next((player.title for player in players if player.title), None),
            rating=max(
                (player.rating for player in players if player.rating),
                default=None,
            ),
            country=next(
                (player.country for player in players if player.country),
                None,
            ),
            avatar_url=next(
                (player.avatar_url for player in players if player.avatar_url),
                None,
            ),
            game_type=GameType.ONLINE,
        )
        dataset = self._store.create(combined_player, list(unique_games.values()))
        if len(players) < requested:
            warnings.append(
                "El dossier se creó con las plataformas que sí estaban disponibles."
            )
        return dataset, warnings, duplicates

    def _selected_providers(self, source: str) -> tuple[OnlineProvider, ...]:
        if source == "all":
            return tuple(self._providers.values())
        provider = self._providers.get(source)
        return (provider,) if provider else ()
