from __future__ import annotations

from fastapi import APIRouter

from api.app.models import DatasetCreate, Mode, Pace
from api.app.services.datasets import DatasetService


def create_datasets_router(service: DatasetService) -> APIRouter:
    router = APIRouter(prefix="/api/v1/datasets")

    @router.post("", status_code=201)
    def create_dataset(payload: DatasetCreate):
        return service.import_pgn(payload)

    @router.get("/{dataset_id}/games")
    def dataset_games(
        dataset_id: str,
        mode: Mode = Mode.COMBINED,
        pace: Pace = Pace.GLOBAL,
    ):
        return service.games(dataset_id, mode, pace)

    @router.get("/{dataset_id}/stats")
    def dataset_stats(
        dataset_id: str,
        mode: Mode = Mode.COMBINED,
        pace: Pace = Pace.GLOBAL,
    ):
        return service.stats(dataset_id, mode, pace)

    return router
