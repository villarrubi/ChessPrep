from __future__ import annotations

from pathlib import Path

from api.app.models import GameType, PlayerRef, TemporaryDataset
from api.app.services.pgn import parse_pgn
from api.app.services.store import DatasetStore


DEMO_PLAYER = PlayerRef(
    source="demo",
    external_id="jugador-muestra",
    username="Jugador de muestra",
    display_name="Jugador de muestra",
    game_type=GameType.ONLINE,
)


class DemoDatasetService:
    """Creates the deterministic sample dataset only when it is requested."""

    def __init__(self, store: DatasetStore, data_dir: Path) -> None:
        self._store = store
        self._data_dir = data_dir

    @property
    def player(self) -> PlayerRef:
        return DEMO_PLAYER

    def ensure(self) -> TemporaryDataset:
        existing = self._store.get_for_player(
            DEMO_PLAYER.source,
            DEMO_PLAYER.external_id,
        )
        if existing:
            return existing

        online = parse_pgn(
            (self._data_dir / "demo_online.pgn").read_text(encoding="utf-8"),
            source="demo",
            game_type=GameType.ONLINE,
            target_player=DEMO_PLAYER.display_name,
            confidence="synthetic",
        )
        otb = parse_pgn(
            (self._data_dir / "demo_otb.pgn").read_text(encoding="utf-8"),
            source="demo",
            game_type=GameType.OTB,
            target_player=DEMO_PLAYER.display_name,
            confidence="synthetic",
        )
        return self._store.create(
            DEMO_PLAYER,
            [*online.games, *otb.games],
            dataset_id="demo-jugador-muestra",
        )
