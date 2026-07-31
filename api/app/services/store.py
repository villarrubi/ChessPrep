from __future__ import annotations

import os
import threading
import uuid
from datetime import UTC, datetime, timedelta

from api.app.models import PlayerRef, TemporaryDataset


class DatasetStore:
    def __init__(self) -> None:
        self._datasets: dict[str, TemporaryDataset] = {}
        self._player_index: dict[tuple[str, str], str] = {}
        self._lock = threading.RLock()

    @property
    def ttl(self) -> timedelta:
        try:
            minutes = max(5, int(os.getenv("CHESSPREP_DATASET_TTL_MINUTES", "30")))
        except ValueError:
            minutes = 30
        return timedelta(minutes=minutes)

    def cleanup(self) -> int:
        now = datetime.now(UTC)
        with self._lock:
            expired = [key for key, value in self._datasets.items() if value.expires_at <= now]
            for key in expired:
                dataset = self._datasets.pop(key)
                indexed = self._player_index.get((dataset.player.source, dataset.player.external_id))
                if indexed == key:
                    self._player_index.pop((dataset.player.source, dataset.player.external_id), None)
            return len(expired)

    def create(self, player: PlayerRef, games: list, dataset_id: str | None = None) -> TemporaryDataset:
        self.cleanup()
        now = datetime.now(UTC)
        dataset = TemporaryDataset(
            dataset_id=dataset_id or uuid.uuid4().hex[:16],
            player=player,
            games=games,
            sources=sorted({game.source for game in games}),
            created_at=now,
            expires_at=now + self.ttl,
        )
        with self._lock:
            self._datasets[dataset.dataset_id] = dataset
            self._player_index[(player.source, player.external_id)] = dataset.dataset_id
        return dataset

    def get(self, dataset_id: str) -> TemporaryDataset | None:
        self.cleanup()
        return self._datasets.get(dataset_id)

    def get_for_player(self, source: str, external_id: str) -> TemporaryDataset | None:
        self.cleanup()
        dataset_id = self._player_index.get((source, external_id))
        return self._datasets.get(dataset_id) if dataset_id else None

    def find_game(self, source: str, game_id: str):
        self.cleanup()
        for dataset in self._datasets.values():
            for game in dataset.games:
                if game.source == source and game.id == game_id:
                    return game
        return None


store = DatasetStore()

