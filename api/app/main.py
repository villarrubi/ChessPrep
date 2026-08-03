from __future__ import annotations

from pathlib import Path

from api.app.app_factory import create_app
from api.app.config import Settings
from api.app.models import CombinedPlayerCreate, EloHeadToHeadRequest, Mode, Pace
from api.app.providers.chesscom import (
    ProviderUnavailable as ChessComUnavailable,
    fetch_games as fetch_chesscom_games,
    get_player as get_chesscom_player,
)
from api.app.providers.fide import (
    ProviderUnavailable as FideUnavailable,
    get_current_rating_data,
    get_historical_rating,
    get_player as get_fide_player,
)
from api.app.providers.info64 import (
    ProviderUnavailable as Info64Unavailable,
    fetch_results as fetch_info64_results,
)
from api.app.providers.lichess import (
    ProviderUnavailable as LichessUnavailable,
    fetch_games as fetch_lichess_games,
    get_player as get_lichess_player,
)
from api.app.security import CONTENT_SECURITY_POLICY, DOCS_CONTENT_SECURITY_POLICY
from api.app.services.container import ApplicationServices
from api.app.services.datasets import DatasetService
from api.app.services.demo import DEMO_PLAYER, DemoDatasetService
from api.app.services.elo_calculator import EloCalculatorService
from api.app.services.online_players import OnlinePlayerService, OnlineProvider
from api.app.services.otb import OtbLookupService
from api.app.services.store import store


# This module is the composition root: concrete providers are wired here and
# the rest of the application depends only on their small service contracts.
settings = Settings.from_environment()
MAX_REQUEST_BYTES = settings.max_request_bytes
ENABLE_API_DOCS = settings.enable_api_docs
DATA_DIR = Path(__file__).resolve().parent / "data"

demo_service = DemoDatasetService(store, DATA_DIR)
dataset_service = DatasetService(store)
online_player_service = OnlinePlayerService(
    store,
    demo_service,
    (
        OnlineProvider(
            source="lichess",
            label="Lichess",
            get_player=lambda username: get_lichess_player(username),
            fetch_games=lambda username, max_games: fetch_lichess_games(
                username,
                max_games=max_games,
            ),
            unavailable_error=LichessUnavailable,
        ),
        OnlineProvider(
            source="chess.com",
            label="Chess.com",
            get_player=lambda username: get_chesscom_player(username),
            fetch_games=lambda username, max_games: fetch_chesscom_games(
                username,
                max_games=max_games,
            ),
            unavailable_error=ChessComUnavailable,
        ),
    ),
)
elo_service = EloCalculatorService(
    get_player=lambda fide_id, **kwargs: get_fide_player(fide_id, **kwargs),
    get_current_ratings=lambda fide_ids, discipline: get_current_rating_data(
        fide_ids,
        discipline,
    ),
    get_historical_rating=lambda fide_id, discipline, period: get_historical_rating(
        fide_id,
        discipline,
        period,
    ),
    unavailable_error=FideUnavailable,
)
otb_service = OtbLookupService(
    get_fide_player=lambda fide_id, **kwargs: get_fide_player(fide_id, **kwargs),
    fetch_info64_results=lambda player, **kwargs: fetch_info64_results(
        player,
        **kwargs,
    ),
    fide_unavailable_error=FideUnavailable,
    info64_unavailable_error=Info64Unavailable,
)
services = ApplicationServices(
    demo=demo_service,
    online_players=online_player_service,
    datasets=dataset_service,
    elo=elo_service,
    otb=otb_service,
)
app = create_app(settings, services)


# Compatibility helpers retained for scripts and tests that imported the old
# monolithic module directly. New code should use the injected services above.
def ensure_demo():
    return demo_service.ensure()


def get_dataset_or_404(source: str, external_id: str):
    return online_player_service.get_dataset(source, external_id)


def create_combined_player_dataset(
    payload: CombinedPlayerCreate,
    max_games: int = 30,
):
    return online_player_service.combine(payload, max_games)


def trace_for(dataset, games, mode: Mode, pace: Pace):
    return dataset_service.trace(dataset, games, mode, pace)


def _resolve_current_elo_players(payload: EloHeadToHeadRequest):
    return elo_service.resolve_current_players(payload)
