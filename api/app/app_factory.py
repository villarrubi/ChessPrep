from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api.app.config import Settings
from api.app.errors import ApplicationError
from api.app.routers.datasets import create_datasets_router
from api.app.routers.elo import create_elo_router
from api.app.routers.fide import create_fide_router
from api.app.routers.players import create_players_router
from api.app.routers.system import create_system_router
from api.app.security import configure_security
from api.app.services.container import ApplicationServices


def create_app(settings: Settings, services: ApplicationServices) -> FastAPI:
    """Build the HTTP adapter around explicitly supplied application services."""

    app = FastAPI(
        title="ChessPrep API",
        version="1.0.0",
        description="API determinista para preparar torneos con partidas PGN trazables.",
        docs_url="/api/docs" if settings.enable_api_docs else None,
        openapi_url="/api/openapi.json" if settings.enable_api_docs else None,
    )
    configure_security(app, settings)

    @app.exception_handler(ApplicationError)
    async def application_error_handler(
        _request: Request,
        error: ApplicationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"detail": error.detail},
        )

    app.include_router(create_system_router(services.demo))
    app.include_router(create_players_router(services))
    app.include_router(create_fide_router(services.otb))
    app.include_router(create_elo_router(services.elo))
    app.include_router(create_datasets_router(services.datasets))

    # Static files are mounted last so they can never shadow API routes.
    if settings.web_dir.exists():
        app.mount(
            "/",
            StaticFiles(directory=settings.web_dir, html=True),
            name="web",
        )
    return app
