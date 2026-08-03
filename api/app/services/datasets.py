from __future__ import annotations

import hashlib

from api.app.errors import NotFoundError, ValidationError
from api.app.models import (
    DatasetCreate,
    GameType,
    Mode,
    NormalizedGame,
    Pace,
    PlayerRef,
    TemporaryDataset,
)
from api.app.services.pgn import parse_pgn
from api.app.services.stats import calculate_stats, filter_games
from api.app.services.store import DatasetStore


class DatasetService:
    """Owns user PGN imports and read-only dataset projections."""

    def __init__(self, store: DatasetStore) -> None:
        self._store = store

    def import_pgn(self, payload: DatasetCreate) -> dict[str, object]:
        if payload.merge_with_dataset_id:
            raise ValidationError(
                "La importación PGN es independiente y no se fusiona con otro dossier."
            )
        if payload.game_type != GameType.OTB:
            raise ValidationError("Este importador solo admite partidas OTB.")

        preliminary = parse_pgn(
            payload.pgn,
            source="pgn_import",
            game_type=payload.game_type,
            confidence="user_upload",
        )
        self._require_games(preliminary.games, preliminary.errors)
        target_name = self._most_frequent_player(preliminary.games)

        parsed = parse_pgn(
            payload.pgn,
            source="pgn_import",
            game_type=payload.game_type,
            target_player=target_name,
            confidence="user_upload",
        )
        self._require_games(parsed.games, parsed.errors)

        identity = "|".join(game.dedupe_hash for game in parsed.games)
        external_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
        ratings = [
            game.white_elo if game.player_color == "white" else game.black_elo
            for game in parsed.games
        ]
        player = PlayerRef(
            source="pgn_import",
            external_id=external_id,
            username=target_name,
            display_name=target_name,
            rating=next((rating for rating in ratings if rating), None),
            game_type=payload.game_type,
        )
        dataset = self._store.create(player, parsed.games)
        return {
            "dataset": dataset,
            "fide_player": None,
            "warnings": parsed.errors,
            "duplicates": parsed.duplicates,
            "rejected_games": 0,
            "merged_games": len(parsed.games),
        }

    def games(
        self,
        dataset_id: str,
        mode: Mode,
        pace: Pace,
    ) -> dict[str, object]:
        dataset = self._require_dataset(dataset_id)
        games = self.filter(dataset, mode=mode, pace=pace)
        return {
            "items": games,
            "total": len(games),
            "trace": self.trace(dataset, games, mode, pace),
        }

    def stats(self, dataset_id: str, mode: Mode, pace: Pace) -> dict[str, object]:
        dataset = self._require_dataset(dataset_id)
        return self.statistics(dataset, mode, pace)

    def game(self, source: str, game_id: str) -> NormalizedGame:
        game = self._store.find_game(source, game_id)
        if not game:
            raise NotFoundError("Partida no encontrada o conjunto caducado.")
        return game

    @staticmethod
    def filter(
        dataset: TemporaryDataset,
        *,
        mode: Mode,
        pace: Pace,
        color: str | None = None,
        eco: str | None = None,
        result: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> list[NormalizedGame]:
        """Apply the common game filters to any temporary dataset."""

        return filter_games(
            dataset.games,
            mode=mode,
            pace=pace,
            color=color,
            eco=eco,
            result=result,
            date_from=date_from,
            date_to=date_to,
        )

    @staticmethod
    def statistics(
        dataset: TemporaryDataset,
        mode: Mode,
        pace: Pace,
    ) -> dict[str, object]:
        """Calculate the deterministic projections shared by every source."""

        return calculate_stats(dataset.games, mode, pace)

    @staticmethod
    def trace(
        dataset: TemporaryDataset,
        games: list[NormalizedGame],
        mode: Mode,
        pace: Pace,
    ) -> dict[str, object]:
        dates = sorted(game.date for game in games if game.date)
        return {
            "sample_size": len(games),
            "sources": sorted({game.source for game in games}),
            "mode": mode.value,
            "pace": pace.value,
            "date_range": {
                "from": dates[0] if dates else None,
                "to": dates[-1] if dates else None,
            },
            "dataset_id": dataset.dataset_id,
            "expires_at": dataset.expires_at,
        }

    def _require_dataset(self, dataset_id: str) -> TemporaryDataset:
        dataset = self._store.get(dataset_id)
        if not dataset:
            raise NotFoundError("Dataset no encontrado o caducado.")
        return dataset

    @staticmethod
    def _require_games(games: list[NormalizedGame], errors: list[str]) -> None:
        if games:
            return
        detail = errors[0] if errors else "No se pudo procesar el PGN."
        raise ValidationError(detail)

    @staticmethod
    def _most_frequent_player(games: list[NormalizedGame]) -> str:
        player_counts: dict[str, int] = {}
        player_names: dict[str, str] = {}
        for game in games:
            for name in (game.white, game.black):
                key = name.casefold().strip()
                if not key:
                    continue
                player_counts[key] = player_counts.get(key, 0) + 1
                player_names.setdefault(key, name)
        target_key = max(player_counts, key=player_counts.get)
        return player_names[target_key]
