from __future__ import annotations

from dataclasses import dataclass

from api.app.services.datasets import DatasetService
from api.app.services.demo import DemoDatasetService
from api.app.services.elo_calculator import EloCalculatorService
from api.app.services.online_players import OnlinePlayerService
from api.app.services.otb import OtbLookupService


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    """Explicit dependency container assembled by the composition root."""

    demo: DemoDatasetService
    online_players: OnlinePlayerService
    datasets: DatasetService
    elo: EloCalculatorService
    otb: OtbLookupService
