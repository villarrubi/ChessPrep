from __future__ import annotations

from fastapi import APIRouter, Request

from api.app.services.demo import DemoDatasetService


def create_system_router(demo: DemoDatasetService) -> APIRouter:
    router = APIRouter(prefix="/api/v1")

    @router.get("/health")
    def health(request: Request):
        return {
            "status": "ok",
            "service": "chessprep-api",
            "version": request.app.version,
        }

    @router.get("/demo")
    def get_demo():
        dataset = demo.ensure()
        return {
            "player": dataset.player,
            "dataset_id": dataset.dataset_id,
            "games": len(dataset.games),
            "expires_at": dataset.expires_at,
        }

    return router
