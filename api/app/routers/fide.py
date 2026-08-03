from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from api.app.models import Info64ResultsResponse
from api.app.services.otb import OtbLookupService


def create_fide_router(service: OtbLookupService) -> APIRouter:
    router = APIRouter(prefix="/api/v1/fide")

    @router.get("/players/{fide_id}")
    def fide_player_detail(fide_id: str):
        return service.player(fide_id)

    @router.get(
        "/players/{fide_id}/info64-results",
        response_model=Info64ResultsResponse,
    )
    def fide_player_info64_results(
        fide_id: str,
        date_from: date | None = Query(default=None, alias="from"),
        date_to: date | None = Query(default=None, alias="to"),
    ):
        return service.info64_results(fide_id, date_from, date_to)

    return router
