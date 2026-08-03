from __future__ import annotations

from fastapi import APIRouter

from api.app.models import EloHeadToHeadRequest, EloInitialRequest
from api.app.services.elo_calculator import EloCalculatorService


def create_elo_router(service: EloCalculatorService) -> APIRouter:
    router = APIRouter(prefix="/api/v1/elo")

    @router.post("/head-to-head")
    def elo_head_to_head(payload: EloHeadToHeadRequest):
        return service.head_to_head(payload)

    @router.post("/initial")
    def elo_initial(payload: EloInitialRequest):
        return service.initial_rating(payload)

    return router
